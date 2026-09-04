import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLicenseInventory } from './artifact-licenses.mjs';
import { buildManifest, completeManifest, LICENSE_INVENTORY_DIGEST, manifestDigest, quarantineManifest, REQUIRED_ENDPOINT_IDS, validateManifest } from './manifest.mjs';
const commit = 'a'.repeat(40); const imageDigest = `sha256:${'b'.repeat(64)}`; const resultDigest = `sha256:${'c'.repeat(64)}`;
const receipt = (forge) => ({ forge, requestId: 'request-1', commit, imageDigest, resultDigest, verification: { certificateIdentity: `${forge}-main`, issuer: `https://${forge}.example`, bundleDigest: `sha256:${'e'.repeat(64)}` } });
const endpointDigests = Object.fromEntries(REQUIRED_ENDPOINT_IDS.map((id, index) => [id, `sha256:${String(index + 1).repeat(64)}`]));
const input = { version: '1.2.3', commit, imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest, cli: { version: '1.2.3', path: 'cli.tgz', sha256: 'd'.repeat(64) }, receipts: { github: receipt('github'), gitlab: receipt('gitlab') }, endpointDigests };
test('strict manifest binds every artifact and verified receipt to one version', () => { const manifest = buildManifest(input); assert.equal(validateManifest(manifest), manifest); assert.equal(manifest.artifacts.github.ref, manifest.artifacts.gitlab.ref); assert.match(manifestDigest(manifest), /^sha256:[0-9a-f]{64}$/); });
test('rejects unknown properties, altered receipts, replay IDs, and unverified receipts', () => {
  const manifest = buildManifest(input); assert.throws(() => validateManifest({ ...manifest, surprise: true }), /properties/);
  assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, gitlab: { ...receipt('gitlab'), resultDigest: `sha256:${'f'.repeat(64)}` } } }), /parity/);
  assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, gitlab: { ...receipt('gitlab'), requestId: 'replay' } } }), /parity/);
  const { verification: _, ...unsigned } = receipt('github'); assert.throws(() => buildManifest({ ...input, receipts: { ...input.receipts, github: unsigned } }), /properties/);
});
test('enforces endpoint completion and state-conditional quarantine fields', () => { const staged = buildManifest(input); assert.throws(() => completeManifest(staged, REQUIRED_ENDPOINT_IDS.slice(1)), /required endpoints/); assert.equal(completeManifest(staged, REQUIRED_ENDPOINT_IDS).state, 'complete'); assert.equal(quarantineManifest(staged, 'network').quarantineReason, 'network'); assert.throws(() => validateManifest({ ...staged, quarantineReason: 'invalid' }), /schema invalid/); });
test('binds the exact compliance pack catalog into the signed manifest', () => {
  const manifest = buildManifest(input);
  assert.equal(manifest.artifacts.compliance.path, 'packages/compliance/packs');
  assert.deepEqual(manifest.artifacts.compliance.packs.map(({ id, version }) => ({ id, version })), [
    { id: 'csa-star-l1-caiq', version: '4.0.13' },
    { id: 'verjson-ci-foundation', version: '1.0.0' },
  ]);
  const tampered = structuredClone(manifest); tampered.artifacts.compliance.packs[0].digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => validateManifest(tampered), /catalog differs/);
});
test('binds the Apache distribution license inventory into the signed manifest', async () => {
  const manifest = buildManifest(input);
  const { digest } = await loadLicenseInventory();
  assert.deepEqual(manifest.artifacts.licensing, {
    path: 'release/artifact-licenses.json',
    distributionLicense: 'Apache-2.0',
    digest,
  });
  assert.equal(LICENSE_INVENTORY_DIGEST, digest);
  const tampered = structuredClone(manifest); tampered.artifacts.licensing.digest = `sha256:${'0'.repeat(64)}`;
  assert.throws(() => validateManifest(tampered), /license inventory differs/);
});
test('emits v2 while retaining read and resume compatibility for durable v1 manifests', () => {
  const current = buildManifest(input);
  assert.equal(current.schemaVersion, 2);
  const { compliance: _, licensing: __, ...legacyArtifacts } = current.artifacts;
  const legacy = { ...current, schemaVersion: 1, artifacts: legacyArtifacts };
  assert.equal(validateManifest(legacy), legacy);
  const completed = completeManifest(legacy, REQUIRED_ENDPOINT_IDS);
  assert.equal(completed.schemaVersion, 1);
  assert.equal(completed.state, 'complete');
});
test('prevents v1 from claiming v2 artifacts and v2 from omitting them', () => {
  const current = buildManifest(input);
  assert.throws(() => validateManifest({ ...current, schemaVersion: 1 }), /schema invalid/);
  const { compliance: _, ...withoutCompliance } = current.artifacts;
  assert.throws(() => validateManifest({ ...current, artifacts: withoutCompliance }), /schema invalid/);
  const { licensing: __, ...withoutLicensing } = current.artifacts;
  assert.throws(() => validateManifest({ ...current, artifacts: withoutLicensing }), /schema invalid/);
  assert.throws(() => validateManifest({ ...current, schemaVersion: 3 }), /unsupported schemaVersion/);
});
