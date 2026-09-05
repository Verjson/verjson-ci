#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { canonicalBytes, validateManifest } from './manifest.mjs';

const execFileAsync = promisify(execFile);
export const RELEASE_SIGNING_POLICY = Object.freeze({
  issuer: 'https://token.actions.githubusercontent.com',
  identity: 'https://github.com/Verjson/verjson-ci/.github/workflows/unified-release.yml@refs/heads/main',
});
export const LEGACY_RELEASE_SIGNING_POLICY = Object.freeze({
  issuer: RELEASE_SIGNING_POLICY.issuer,
  identity: 'https://github.com/Verjson/verjson-ci/.github/workflows/release.yml@refs/heads/main',
});
export const RECEIPT_POLICIES = Object.freeze({
  github: { issuer: 'https://token.actions.githubusercontent.com', identity: 'https://github.com/Verjson/verjson-ci/.github/workflows/release-fixture.yml@refs/heads/main' },
  gitlab: { issuer: 'https://gitlab.com', identity: 'project_path:Verjson/verjson-ci:ref_type:branch:ref:main' },
});

export async function signManifest({ manifest, bundle }, run = runCosign) {
  await withManifestSnapshot(manifest, async (snapshot, schemaVersion) => {
    if (schemaVersion !== 2) throw new Error('legacy release manifests are read-only');
    await run(['sign-blob', '--yes', '--bundle', bundle, snapshot]);
  }); return bundle;
}
export async function verifyManifest({ manifest, bundle }, run = runCosign) {
  await withManifestSnapshot(manifest, async (snapshot, schemaVersion) => verifyBlob(snapshot, bundle, schemaVersion === 1 ? LEGACY_RELEASE_SIGNING_POLICY : RELEASE_SIGNING_POLICY, run));
}

export async function verifyReceiptEnvelope(forge, envelope, expected, run = runCosign) {
  const policy = RECEIPT_POLICIES[forge];
  if (!policy || !envelope?.receipt || !envelope.bundle) throw new Error(`${forge} signed receipt envelope missing`);
  const receipt = envelope.receipt;
  if (receipt.forge !== forge || receipt.commit !== expected.commit || receipt.imageDigest !== expected.imageDigest || receipt.requestId !== expected.requestId) throw new Error(`${forge} receipt replay or identity mismatch`);
  const directory = await mkdtemp(path.join(tmpdir(), 'verjson-ci-receipt-'));
  try {
    const receiptPath = path.join(directory, 'receipt.json');
    const bundlePath = path.join(directory, 'bundle.json');
    const bundleBytes = await readFile(envelope.bundle);
    await writeFile(receiptPath, canonicalBytes(receipt));
    await writeFile(bundlePath, bundleBytes, { flag: 'wx', mode: 0o600 });
    await verifyBlob(receiptPath, bundlePath, policy, run);
    const bundleDigest = `sha256:${createHash('sha256').update(bundleBytes).digest('hex')}`;
    return { ...receipt, verification: { issuer: policy.issuer, certificateIdentity: policy.identity, bundleDigest } };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function verifyBlob(blob, bundle, policy, run) {
  await run(['verify-blob', '--bundle', bundle, '--certificate-identity', policy.identity, '--certificate-oidc-issuer', policy.issuer, blob]);
}
async function withManifestSnapshot(file, action) {
  const directory = await mkdtemp(path.join(tmpdir(), 'verjson-ci-manifest-'));
  try {
    const bytes = await readFile(file); const manifest = validateManifest(JSON.parse(bytes));
    const snapshot = path.join(directory, 'manifest.json'); await writeFile(snapshot, bytes, { flag: 'wx', mode: 0o600 });
    await action(snapshot, manifest.schemaVersion);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
async function runCosign(args) { await execFileAsync(process.env.COSIGN_BIN || 'cosign', args, { env: process.env }); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const [command, manifest, bundle] = process.argv.slice(2); if (command === 'sign') await signManifest({ manifest, bundle }); else if (command === 'verify') await verifyManifest({ manifest, bundle }); else throw new Error('usage: cosign.mjs sign|verify MANIFEST BUNDLE'); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
