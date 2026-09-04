import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileReleaseStore } from '../src/file-store.mjs';
import { ReleaseConflictError, ReleaseOrchestrator, ReleaseQuarantinedError } from '../src/index.mjs';
import { canonicalBytes } from '../../../tools/release/manifest.mjs';

const commit = 'a'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const resultDigest = `sha256:${'c'.repeat(64)}`;
const candidate = { version: '1.2.3', commit, requestId: 'request-1', dryRun: true };
const rawReceipt = (forge) => ({ forge, requestId: 'request-1', commit, imageDigest, resultDigest });
const verifiedReceipt = (forge) => ({ ...rawReceipt(forge), verification: { issuer: `https://${forge}.example`, certificateIdentity: `${forge}-main`, bundleDigest: `sha256:${'e'.repeat(64)}` } });

function memoryStore(initial) {
  let release = initial ?? { version: candidate.version, commit, transitions: [] };
  return { reserve: async () => structuredClone(release), append: async (before, transition) => { if (before.transitions.length !== release.transitions.length) return 'conflict'; release = { ...release, transitions: [...release.transitions, transition] }; return structuredClone(release); }, inspect: () => release };
}
function trustedSigner() {
  const digest = (record) => createHash('sha256').update(canonicalBytes(record)).digest('hex');
  return { signRecord: async (record) => digest(record), verifyRecord: async (record) => { const { signature, ...unsigned } = record; if (signature !== digest(unsigned)) throw new Error('invalid signed ledger record'); } };
}
function harness({ store = memoryStore(), endpoints, create } = {}) {
  const published = new Map();
  const endpointList = endpoints ?? [{ id: 'github-action', digest: `sha256:${'1'.repeat(64)}` }, { id: 'gitlab-component', digest: `sha256:${'2'.repeat(64)}` }];
  const orchestrator = new ReleaseOrchestrator({
    license: { assertPublishable: async () => { throw new Error('dry run must not require a license'); } }, store,
    builder: { buildOnce: async () => ({ imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest, cli: { version: '1.2.3', path: 'verjson-ci-1.2.3.tgz', sha256: 'd'.repeat(64) } }) },
    conformance: { run: async () => ({ github: { receipt: rawReceipt('github'), bundle: 'github.bundle' }, gitlab: { receipt: rawReceipt('gitlab'), bundle: 'gitlab.bundle' } }) },
    receiptVerifier: { verify: async (forge, envelope) => { assert.deepEqual(envelope.receipt, rawReceipt(forge)); return verifiedReceipt(forge); } },
    signer: trustedSigner(), tagger: { createImmutable: async () => { throw new Error('dry run must not tag'); } },
    publisher: { endpoints: async () => endpointList, readDigest: async (endpoint) => published.get(endpoint.id), create: async (endpoint) => { if (create) await create(endpoint, published); else published.set(endpoint.id, endpoint.digest); } },
  });
  return { orchestrator, store, published };
}

test('dry run signs verified receipts and completes an append-only endpoint ledger', async () => {
  const { orchestrator, store } = harness();
  assert.equal((await orchestrator.release(candidate)).state, 'complete');
  assert.deepEqual(store.inspect().transitions.map((item) => item.state), ['staged', 'published', 'published', 'complete']);
  assert.deepEqual(store.inspect().transitions.filter((item) => item.endpoint).map((item) => item.endpoint), ['github-action', 'gitlab-component']);
});

test('rejects forged receipt before staging a release', async () => {
  const setup = harness(); setup.orchestrator.receiptVerifier.verify = async () => { throw new Error('cosign verification failed'); };
  await assert.rejects(() => setup.orchestrator.release(candidate), /cosign verification failed/);
  assert.equal(setup.store.inspect().transitions.length, 0);
});

test('rejects tampered persisted state before returning complete', async () => {
  const first = harness(); await first.orchestrator.release(candidate);
  const tampered = structuredClone(first.store.inspect()); tampered.transitions.at(-1).manifest.commit = 'f'.repeat(40);
  await assert.rejects(() => harness({ store: memoryStore(tampered) }).orchestrator.release(candidate), /signed ledger|persisted manifest/);
});

test('restart after one publication creates only the missing endpoint', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-ledger-'));
  try {
    const store = new FileReleaseStore(directory); let crash = true; const created = [];
    const setup = harness({ store, create: async (endpoint, published) => { created.push(endpoint.id); published.set(endpoint.id, endpoint.digest); if (endpoint.id === 'gitlab-component' && crash) { crash = false; throw Object.assign(new Error('interrupted'), { code: 'network', retryable: true, phase: endpoint.id }); } } });
    await assert.rejects(() => setup.orchestrator.release(candidate), ReleaseQuarantinedError);
    assert.deepEqual(created, ['github-action', 'gitlab-component']);
    await setup.orchestrator.release(candidate);
    assert.deepEqual(created, ['github-action', 'gitlab-component']);
    const history = await store.reserve(candidate.version, commit);
    assert.deepEqual(history.transitions.map((item) => item.state), ['staged', 'published', 'quarantined', 'staged', 'published', 'complete']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refuses a conflicting reservation and published digest', async () => {
  const conflict = memoryStore({ version: candidate.version, commit: 'f'.repeat(40), transitions: [] });
  await assert.rejects(() => harness({ store: conflict }).orchestrator.release(candidate), ReleaseConflictError);
  const setup = harness(); setup.published.set('github-action', `sha256:${'9'.repeat(64)}`);
  await assert.rejects(() => setup.orchestrator.release(candidate), ReleaseQuarantinedError);
  assert.equal(setup.store.inspect().transitions.at(-1).retryable, false);
});

test('preserves publication and quarantine persistence failures', async () => {
  const base = memoryStore();
  const store = { ...base, append: async (release, transition) => {
    if (transition.state === 'quarantined') throw new Error('ledger unavailable');
    return base.append(release, transition);
  } };
  const setup = harness({ store, create: async () => { throw Object.assign(new Error('registry unavailable'), { code: 'network', retryable: true }); } });
  await assert.rejects(() => setup.orchestrator.release(candidate), (error) => {
    assert.equal(error instanceof AggregateError, true);
    assert.deepEqual(error.errors.map((item) => item.message), ['registry unavailable', 'ledger unavailable']);
    return true;
  });
});
