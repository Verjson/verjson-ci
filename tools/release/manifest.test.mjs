import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest, completeManifest, quarantineManifest } from './manifest.mjs';

const commit = 'a'.repeat(40);
const imageDigest = `sha256:${'b'.repeat(64)}`;
const resultDigest = `sha256:${'c'.repeat(64)}`;
const receipt = (forge, overrides = {}) => ({
  forge, requestId: 'request-1', commit, imageDigest, resultDigest,
  signature: { certificateIdentity: `${forge}-fixture`, issuer: `${forge}-issuer` },
  ...overrides,
});
const input = {
  version: '1.2.3', commit, imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest,
  cli: { version: '1.2.3', path: 'verjson-ci-1.2.3.tgz', sha256: 'd'.repeat(64) },
  receipts: { github: receipt('github'), gitlab: receipt('gitlab') },
};

test('binds every release surface to one unprefixed version and artifact identity', () => {
  const manifest = buildManifest(input);
  assert.equal(manifest.version, '1.2.3');
  assert.equal(manifest.artifacts.github.ref, manifest.artifacts.gitlab.ref);
  assert.equal(manifest.artifacts.oci.digest, imageDigest);
  assert.equal(manifest.state, 'staged');
});

test('rejects prefixed versions and cross-forge receipt drift', () => {
  assert.throws(() => buildManifest({ ...input, version: 'v1.2.3' }), /unprefixed/);
  assert.throws(() => buildManifest({ ...input, cli: { ...input.cli, version: '1.2.4' } }), /CLI version/);
  assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, gitlab: receipt('gitlab', { resultDigest: `sha256:${'e'.repeat(64)}` }) } }), /digests differ/);
  assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, gitlab: receipt('gitlab', { commit: 'f'.repeat(40) }) } }), /identity differs/);
});

test('completes only staged releases and records quarantined partial publication', () => {
  const staged = buildManifest(input);
  assert.equal(completeManifest(staged).state, 'complete');
  assert.deepEqual(quarantineManifest(staged, 'registry unavailable'), { ...staged, state: 'quarantined', quarantineReason: 'registry unavailable' });
  assert.throws(() => completeManifest({ ...staged, state: 'quarantined' }), /only a staged/);
});
