import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { FileReleaseStore } from '../src/file-store.mjs';
import { DurableReleaseStore } from '../src/durable-store.mjs';
import { ReleaseConflictError, ReleaseOrchestrator, ReleaseQuarantinedError } from '../src/index.mjs';
import { canonicalBytes, objectDigest, REQUIRED_ENDPOINT_IDS } from '../../../tools/release/manifest.mjs';

const commit = 'a'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const resultDigest = `sha256:${'c'.repeat(64)}`;
const candidate = { version: '1.2.3', commit, requestId: 'request-1', dryRun: true };
const rawReceipt = (forge) => ({ forge, requestId: 'request-1', commit, imageDigest, resultDigest });
const verifiedReceipt = (forge) => ({ ...rawReceipt(forge), verification: { issuer: `https://${forge}.example`, certificateIdentity: `${forge}-main`, bundleDigest: `sha256:${'e'.repeat(64)}` } });
const endpointDigests = Object.fromEntries(REQUIRED_ENDPOINT_IDS.map((id, index) => [id, `sha256:${String(index + 1).repeat(64)}`]));
const signerIdentity = 'test-release-signer';

function memoryStore(initial) {
  let release = initial ?? { version: candidate.version, commit, signerIdentity, anchor: `sha256:${'0'.repeat(64)}`, head: `sha256:${'0'.repeat(64)}`, transitions: [] };
  return { reserve: async () => structuredClone(release), append: async (before, transition) => { if (before.transitions.length !== release.transitions.length) return 'conflict'; release = { ...release, head: objectDigest(transition), transitions: [...release.transitions, transition] }; return structuredClone(release); }, inspect: () => release };
}
function trustedSigner() {
  const digest = (record) => createHash('sha256').update(canonicalBytes(record)).digest('hex');
  return { identity: signerIdentity, signRecord: async (record) => digest(record), verifyRecord: async (record) => { const { signature, ...unsigned } = record; if (signature !== digest(unsigned)) throw new Error('invalid signed ledger record'); } };
}
function harness({ store = memoryStore(), endpoints, create, published = new Map() } = {}) {
  const endpointList = endpoints ?? REQUIRED_ENDPOINT_IDS.map((id) => ({ id, digest: endpointDigests[id] }));
  const orchestrator = new ReleaseOrchestrator({
    store,
    builder: { buildOnce: async () => ({ imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest, cli: { version: '1.2.3', path: 'verjson-ci-1.2.3.tgz', sha256: 'd'.repeat(64) }, endpointDigests }) },
    conformance: { run: async () => ({ github: { receipt: rawReceipt('github'), bundle: 'github.bundle' }, gitlab: { receipt: rawReceipt('gitlab'), bundle: 'gitlab.bundle' } }) },
    receiptVerifier: { verify: async (forge, envelope) => { assert.deepEqual(envelope.receipt, rawReceipt(forge)); return verifiedReceipt(forge); } },
    signer: trustedSigner(),
    publisher: { endpoints: async () => endpointList, readDigest: async (endpoint) => published.get(endpoint.id), create: async (endpoint) => { if (create) await create(endpoint, published); else published.set(endpoint.id, endpoint.digest); } },
  });
  return { orchestrator, store, published };
}

test('public rerun resumes after GitLab failure without overwriting GitHub endpoints', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-public-rerun-')); const snapshots = []; const published = new Map(); const creates = [];
  const remote = { load: async () => snapshots.at(-1), create: async (expected, files) => { if (snapshots.length !== expected) throw new Error('CAS conflict'); snapshots.push({ generation: expected + 1, files: structuredClone(files) }); return expected + 1; } };
  let failGitLab = true;
  const create = async (endpoint, state) => { if (state.has(endpoint.id)) throw new Error('overwrite'); creates.push(endpoint.id); state.set(endpoint.id, endpoint.digest); if (endpoint.id === 'gitlab-component' && failGitLab) { failGitLab = false; throw Object.assign(new Error('GitLab unavailable'), { retryable: true, code: 'network', phase: endpoint.id }); } };
  try {
    const first = harness({ store: new DurableReleaseStore(path.join(directory, 'runner-1'), { remote }), create, published });
    await assert.rejects(() => first.orchestrator.release(candidate), ReleaseQuarantinedError);
    const githubCreates = [...creates];
    const second = harness({ store: new DurableReleaseStore(path.join(directory, 'runner-2'), { remote }), create, published });
    assert.equal((await second.orchestrator.release(candidate)).state, 'complete');
    assert.deepEqual(creates.slice(0, githubCreates.length), githubCreates);
    assert.equal(new Set(creates).size, creates.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('dry run signs verified receipts and completes an append-only endpoint ledger', async () => {
  const { orchestrator, store } = harness();
  assert.equal((await orchestrator.release(candidate)).state, 'complete');
  assert.equal(store.inspect().transitions.filter((item) => item.state === 'published').length, REQUIRED_ENDPOINT_IDS.length);
  assert.deepEqual(store.inspect().transitions.filter((item) => item.endpoint).map((item) => item.endpoint), REQUIRED_ENDPOINT_IDS);
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
    const store = new FileReleaseStore(path.join(directory, 'ledger'), { checkpointRoot: path.join(directory, 'anchors') }); let crash = true; const created = [];
    const setup = harness({ store, create: async (endpoint, published) => { created.push(endpoint.id); published.set(endpoint.id, endpoint.digest); if (endpoint.id === 'gitlab-component' && crash) { crash = false; throw Object.assign(new Error('interrupted'), { code: 'network', retryable: true, phase: endpoint.id }); } } });
    await assert.rejects(() => setup.orchestrator.release(candidate), ReleaseQuarantinedError);
    assert.deepEqual(created, REQUIRED_ENDPOINT_IDS.slice(0, REQUIRED_ENDPOINT_IDS.indexOf('gitlab-component') + 1));
    await setup.orchestrator.release(candidate);
    assert.deepEqual(created, REQUIRED_ENDPOINT_IDS);
    const history = await store.reserve(candidate.version, commit, signerIdentity);
    assert.equal(history.transitions.at(-1).state, 'complete');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('refuses a conflicting reservation and published digest', async () => {
  const conflict = memoryStore({ version: candidate.version, commit: 'f'.repeat(40), signerIdentity, anchor: `sha256:${'0'.repeat(64)}`, head: `sha256:${'0'.repeat(64)}`, transitions: [] });
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

test('rejects incomplete, duplicate, and unknown endpoint plans', async () => {
  const complete = REQUIRED_ENDPOINT_IDS.map((id) => ({ id, digest: endpointDigests[id] }));
  for (const endpoints of [complete.slice(1), [...complete, complete[0]], [...complete.slice(0, -1), { id: 'unknown', digest: endpointDigests.cli }]]) {
    await assert.rejects(() => harness({ endpoints }).orchestrator.release(candidate), ReleaseQuarantinedError);
  }
});

test('detects suffix truncation using the separately persisted ledger head', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-ledger-truncation-'));
  try {
    const store = new FileReleaseStore(path.join(directory, 'ledger'), { checkpointRoot: path.join(directory, 'anchors') }); const setup = harness({ store });
    await setup.orchestrator.release(candidate);
    const releaseDirectory = path.join(directory, 'ledger', candidate.version);
    const records = (await readdir(releaseDirectory)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
    await unlink(path.join(releaseDirectory, records.at(-1)));
    const prior = JSON.parse(await readFile(path.join(releaseDirectory, records.at(-2)), 'utf8'));
    await writeFile(path.join(releaseDirectory, 'head.json'), `${JSON.stringify({ sequence: records.length - 1, head: objectDigest(prior) })}\n`);
    await assert.rejects(() => store.reserve(candidate.version, commit, signerIdentity), /independent monotonic checkpoint/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('re-observes ledgered endpoints and rejects a disappeared artifact on resume', async () => {
  let interrupted = false;
  const setup = harness({ create: async (endpoint, published) => {
    published.set(endpoint.id, endpoint.digest);
    if (!interrupted && endpoint.id === 'gitlab-component') { interrupted = true; throw Object.assign(new Error('interrupted'), { retryable: true }); }
  } });
  await assert.rejects(() => setup.orchestrator.release(candidate), ReleaseQuarantinedError);
  setup.published.delete('cli');
  await assert.rejects(() => setup.orchestrator.release(candidate), (error) => error instanceof ReleaseQuarantinedError && /quarantined/.test(error.message));
  assert.equal(setup.store.inspect().transitions.at(-1).retryable, false);
});

test('re-observes every required endpoint before returning an existing complete release', async () => {
  const setup = harness(); await setup.orchestrator.release(candidate);
  setup.published.delete('gitlab-consumption');
  await assert.rejects(() => setup.orchestrator.release(candidate), /completed endpoint drifted/);
});

test('recovers a signed transition after hard crashes on either side of head advancement', async () => {
  for (const boundary of ['after-record', 'after-head']) {
    const directory = await mkdtemp(path.join(tmpdir(), `release-${boundary}-`)); let crashed = false;
    try {
      const options = { checkpointRoot: path.join(directory, 'anchors'), crashHook: async (point) => { if (!crashed && point === boundary) { crashed = true; throw new Error(`hard crash ${point}`); } } };
      const first = harness({ store: new FileReleaseStore(path.join(directory, 'ledger'), options) });
      await assert.rejects(() => first.orchestrator.release(candidate));
      const resumed = harness({ store: new FileReleaseStore(path.join(directory, 'ledger'), { checkpointRoot: path.join(directory, 'anchors') }) });
      assert.equal((await resumed.orchestrator.release(candidate)).state, 'complete');
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('retains stable signed state across hard process exits at both ledger boundaries', async () => {
  for (const boundary of ['after-record', 'after-head']) {
    const directory = await mkdtemp(path.join(tmpdir(), `release-process-${boundary}-`));
    try {
      const ledger = path.join(directory, 'ledger'), anchors = path.join(directory, 'anchors');
      const store = new FileReleaseStore(ledger, { checkpointRoot: anchors }); const release = await store.reserve(candidate.version, commit, signerIdentity);
      const unsigned = { sequence: 1, previousState: 'reserved', previousRecordDigest: release.anchor, state: 'staged' };
      const transition = { ...unsigned, signature: await trustedSigner().signRecord(unsigned) };
      const transitionPath = path.join(directory, 'transition.json'); await writeFile(transitionPath, JSON.stringify(transition));
      const worker = spawnSync(process.execPath, ['packages/release/test/fixtures/crash-worker.mjs', ledger, anchors, candidate.version, commit, signerIdentity, transitionPath, boundary]);
      assert.equal(worker.status, 91);
      const restarted = new FileReleaseStore(ledger, { checkpointRoot: anchors }); const recovered = await restarted.reserve(candidate.version, commit, signerIdentity);
      await trustedSigner().verifyRecord(recovered.transitions[0]);
      const advanced = await restarted.recover(recovered);
      assert.equal(advanced.head, objectDigest(transition));
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test('successor process reconciles a hard kill after endpoint creation without overwrite', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-endpoint-process-'));
  try {
    const workerPath = 'packages/release/test/fixtures/release-worker.mjs';
    const crashed = spawnSync(process.execPath, [workerPath, directory, 'crash']); assert.equal(crashed.status, 92);
    const endpoint = path.join(directory, 'endpoints', 'cli'); const before = await readFile(endpoint, 'utf8');
    const resumed = spawnSync(process.execPath, [workerPath, directory, 'resume'], { encoding: 'utf8' }); assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(await readFile(endpoint, 'utf8'), before); assert.equal(JSON.parse(await readFile(path.join(directory, 'complete.json'))).state, 'complete');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('successor process fails closed when the externally created endpoint mismatches', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'release-endpoint-mismatch-'));
  try {
    const worker = spawnSync(process.execPath, ['packages/release/test/fixtures/release-worker.mjs', directory, 'mismatch'], { encoding: 'utf8' });
    assert.notEqual(worker.status, 0); assert.match(worker.stderr, /release quarantined/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
