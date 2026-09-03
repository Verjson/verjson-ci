import assert from 'node:assert/strict';
import test from 'node:test';
import { ReleaseConflictError, ReleaseOrchestrator, ReleaseQuarantinedError } from '../src/index.mjs';
import { buildManifest } from '../../../tools/release/manifest.mjs';

const commit = 'a'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const resultDigest = `sha256:${'c'.repeat(64)}`;
const receipt = (forge) => ({
  forge, requestId: 'request-1', commit, imageDigest, resultDigest,
  signature: { certificateIdentity: `${forge}-fixture`, issuer: `${forge}-issuer` },
});
const candidate = { version: '1.2.3', commit };

function harness({ reservation = 'new', publishError } = {}) {
  const events = [];
  const step = (name, value) => async () => { events.push(name); return value; };
  const orchestrator = new ReleaseOrchestrator({
    license: { assertPublishable: step('license') },
    store: {
      reserve: step('reserve', reservation),
      stage: step('store:staged'),
      complete: step('store:complete'),
      quarantine: step('store:quarantined'),
    },
    builder: { buildOnce: step('build', {
      imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest,
      cli: { version: '1.2.3', path: 'verjson-ci-1.2.3.tgz', sha256: 'd'.repeat(64) },
    }) },
    conformance: { run: step('conformance', { github: receipt('github'), gitlab: receipt('gitlab') }) },
    signer: { sign: async (manifest) => { events.push(`sign:${manifest.state}`); return `${manifest.state}-signature`; } },
    tagger: { createImmutable: step('tag') },
    publisher: { publish: async () => { events.push('publish'); if (publishError) throw Object.assign(new Error('registry unavailable'), { code: 'registry-unavailable' }); } },
    verifier: { verifyEveryEndpoint: step('verify') },
  });
  return { orchestrator, events };
}

test('completes only after conformance, staged signature, publication, and endpoint verification', async () => {
  const { orchestrator, events } = harness();
  const manifest = await orchestrator.release(candidate);
  assert.equal(manifest.state, 'complete');
  assert.deepEqual(events, [
    'license', 'reserve', 'build', 'conformance', 'sign:staged', 'store:staged',
    'tag', 'publish', 'verify', 'sign:complete', 'store:complete',
  ]);
});

test('signs and records quarantine when publication partially fails', async () => {
  const { orchestrator, events } = harness({ publishError: true });
  await assert.rejects(() => orchestrator.release(candidate), (error) => {
    assert.equal(error instanceof ReleaseQuarantinedError, true);
    assert.equal(error.manifest.state, 'quarantined');
    assert.equal(error.manifest.quarantineReason, 'registry-unavailable');
    return true;
  });
  assert.deepEqual(events.slice(-2), ['sign:quarantined', 'store:quarantined']);
  assert.equal(events.includes('verify'), false);
});

test('refuses to reuse a version reserved by another commit', async () => {
  const { orchestrator, events } = harness({ reservation: 'conflict' });
  await assert.rejects(() => orchestrator.release(candidate), ReleaseConflictError);
  assert.deepEqual(events, ['license', 'reserve']);
});

test('resumes a matching staged identity without rebuilding or rerunning conformance', async () => {
  const staged = buildManifest({
    ...candidate,
    imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest,
    cli: { version: '1.2.3', path: 'verjson-ci-1.2.3.tgz', sha256: 'd'.repeat(64) },
    receipts: { github: receipt('github'), gitlab: receipt('gitlab') },
  });
  const { orchestrator, events } = harness({ reservation: { state: 'staged', manifest: staged } });
  assert.equal((await orchestrator.release(candidate)).state, 'complete');
  assert.equal(events.includes('build'), false);
  assert.equal(events.includes('conformance'), false);
  assert.deepEqual(events, ['license', 'reserve', 'tag', 'publish', 'verify', 'sign:complete', 'store:complete']);
});
