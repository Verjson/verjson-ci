import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest, completeManifest, manifestDigest, quarantineManifest, validateManifest } from './manifest.mjs';
const commit = 'a'.repeat(40); const imageDigest = `sha256:${'b'.repeat(64)}`; const resultDigest = `sha256:${'c'.repeat(64)}`;
const receipt = (forge) => ({ forge, requestId: 'request-1', commit, imageDigest, resultDigest, verification: { certificateIdentity: `${forge}-main`, issuer: `https://${forge}.example`, bundleDigest: `sha256:${'e'.repeat(64)}` } });
const input = { version: '1.2.3', commit, imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest, cli: { version: '1.2.3', path: 'cli.tgz', sha256: 'd'.repeat(64) }, receipts: { github: receipt('github'), gitlab: receipt('gitlab') } };
test('strict manifest binds every artifact and verified receipt to one version', () => { const manifest = buildManifest(input); assert.equal(validateManifest(manifest), manifest); assert.equal(manifest.artifacts.github.ref, manifest.artifacts.gitlab.ref); assert.match(manifestDigest(manifest), /^sha256:[0-9a-f]{64}$/); });
test('rejects unknown properties, altered receipts, replay IDs, and unverified receipts', () => {
  const manifest = buildManifest(input); assert.throws(() => validateManifest({ ...manifest, surprise: true }), /properties/);
  assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, gitlab: { ...receipt('gitlab'), resultDigest: `sha256:${'f'.repeat(64)}` } } }), /parity/);
  assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, gitlab: { ...receipt('gitlab'), requestId: 'replay' } } }), /parity/);
  const { verification: _, ...unsigned } = receipt('github'); assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, github: unsigned } }), /properties/);
});
test('enforces state-conditional quarantine fields', () => { const staged = buildManifest(input); assert.equal(completeManifest(staged).state, 'complete'); assert.equal(quarantineManifest(staged, 'network').quarantineReason, 'network'); assert.throws(() => validateManifest({ ...staged, quarantineReason: 'invalid' }), /schema invalid/); });
