import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LEGACY_RELEASE_SIGNING_POLICY, RELEASE_SIGNING_POLICY, RECEIPT_POLICIES, signManifest, verifyManifest, verifyReceiptEnvelope } from './cosign.mjs';
import { buildManifest, REQUIRED_ENDPOINT_IDS } from './manifest.mjs';
const commit = 'a'.repeat(40), imageDigest = `sha256:${'b'.repeat(64)}`, resultDigest = `sha256:${'c'.repeat(64)}`;
const verification = (forge) => ({ issuer: `https://${forge}.example`, certificateIdentity: forge, bundleDigest: `sha256:${'e'.repeat(64)}` });
async function fixture() { const dir = await mkdtemp(path.join(tmpdir(), 'cosign-test-')); const file = path.join(dir, 'manifest.json'), bundle = path.join(dir, 'bundle.json'); const receipt = (forge) => ({ forge, requestId: 'request-1', commit, imageDigest, resultDigest, verification: verification(forge) }); const endpointDigests = Object.fromEntries(REQUIRED_ENDPOINT_IDS.map((id, index) => [id, `sha256:${String(index + 1).repeat(64)}`])); await writeFile(file, JSON.stringify(buildManifest({ version: '1.2.3', commit, imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest, cli: { version: '1.2.3', path: 'cli.tgz', sha256: 'd'.repeat(64) }, receipts: { github: receipt('github'), gitlab: receipt('gitlab') }, endpointDigests }))); await writeFile(bundle, '{}'); return { dir, file, bundle }; }
test('signs and verifies an immutable manifest snapshot under the exact release identity', async () => { const f = await fixture(); const original = await readFile(f.file); const calls = []; try { await signManifest({ manifest: f.file, bundle: f.bundle }, async (args) => { await writeFile(f.file, '{"invalid":true}'); assert.deepEqual(await readFile(args.at(-1)), original); calls.push(args); }); await writeFile(f.file, original); await verifyManifest({ manifest: f.file, bundle: f.bundle }, async (args) => { assert.deepEqual(await readFile(args.at(-1)), original); calls.push(args); }); assert.equal(calls[0].includes('--key'), false); assert.notEqual(calls[0].at(-1), f.file); assert.deepEqual(calls[1].slice(3, -1), ['--certificate-identity', RELEASE_SIGNING_POLICY.identity, '--certificate-oidc-issuer', RELEASE_SIGNING_POLICY.issuer]); } finally { await rm(f.dir, { recursive: true, force: true }); } });
test('verifies canonical receipt and the same privately copied bundle bytes that it hashes', async () => { const f = await fixture(); try { const raw = { forge: 'github', requestId: 'request-1', commit, imageDigest, resultDigest }; let bytes; const verified = await verifyReceiptEnvelope('github', { receipt: raw, bundle: f.bundle }, { requestId: 'request-1', commit, imageDigest }, async (args) => { bytes = await readFile(args.at(-1), 'utf8'); const privateBundle = args[args.indexOf('--bundle') + 1]; assert.notEqual(privateBundle, f.bundle); assert.deepEqual(await readFile(privateBundle), await readFile(f.bundle)); assert.equal(args.includes(RECEIPT_POLICIES.github.identity), true); }); assert.equal(bytes, '{"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","forge":"github","imageDigest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","requestId":"request-1","resultDigest":"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'); assert.equal(verified.verification.bundleDigest, `sha256:${'44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'}`); } finally { await rm(f.dir, { recursive: true, force: true }); } });
test('rejects replayed request identity before invoking cosign', async () => { const f = await fixture(); try { await assert.rejects(() => verifyReceiptEnvelope('github', { receipt: { forge: 'github', requestId: 'old', commit, imageDigest, resultDigest }, bundle: f.bundle }, { requestId: 'new', commit, imageDigest }, async () => assert.fail()), /replay/); } finally { await rm(f.dir, { recursive: true, force: true }); } });
test('propagates signature, issuer, identity, and altered-content verification failures', async () => { const f = await fixture(); try { const receipt = { forge: 'github', requestId: 'request-1', commit, imageDigest, resultDigest }; await assert.rejects(() => verifyReceiptEnvelope('github', { receipt, bundle: f.bundle }, { requestId: 'request-1', commit, imageDigest }, async (args) => { assert.equal(args.includes(RECEIPT_POLICIES.github.issuer), true); assert.equal(args.includes(RECEIPT_POLICIES.github.identity), true); throw new Error('signature does not match canonical bytes'); }), /signature/); } finally { await rm(f.dir, { recursive: true, force: true }); } });

test('legacy v1 manifests verify only under the historical signer and cannot be signed', async () => {
  const f = await fixture();
  try {
    const manifest = JSON.parse(await readFile(f.file, 'utf8'));
    manifest.schemaVersion = 1;
    delete manifest.artifacts.compliance;
    delete manifest.artifacts.licensing;
    await writeFile(f.file, JSON.stringify(manifest));
    await verifyManifest({ manifest: f.file, bundle: f.bundle }, async (args) => {
      assert.equal(args[args.indexOf('--certificate-identity') + 1], LEGACY_RELEASE_SIGNING_POLICY.identity);
      assert.notEqual(LEGACY_RELEASE_SIGNING_POLICY.identity, RELEASE_SIGNING_POLICY.identity);
    });
    await assert.rejects(signManifest({ manifest: f.file, bundle: f.bundle }, () => assert.fail('legacy manifests cannot be signed')), /read-only/);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});

test('v2 verification does not fall back to the historical workflow signer', async () => {
  const f = await fixture();
  try {
    let calls = 0;
    await assert.rejects(verifyManifest({ manifest: f.file, bundle: f.bundle }, async (args) => {
      calls++;
      assert.equal(args[args.indexOf('--certificate-identity') + 1], RELEASE_SIGNING_POLICY.identity);
      throw new Error('historical signer rejected');
    }), /historical signer rejected/);
    assert.equal(calls, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
