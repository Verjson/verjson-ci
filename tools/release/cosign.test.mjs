import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { signManifest, verifyManifest } from './cosign.mjs';

async function manifestFixture(state = 'staged') {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-signing-'));
  const path = join(directory, 'manifest.json');
  await writeFile(path, JSON.stringify({ schemaVersion: 1, state }));
  return path;
}

test('keyless signing emits a Sigstore bundle without a key argument', async () => {
  const calls = [];
  const manifest = await manifestFixture();
  await signManifest({ manifest, bundle: 'manifest.sigstore.json' }, async (args) => calls.push(args));
  assert.deepEqual(calls, [['sign-blob', '--yes', '--bundle', 'manifest.sigstore.json', manifest]]);
  assert.equal(calls[0].includes('--key'), false);
});

test('verification pins both workflow identity and OIDC issuer', async () => {
  const calls = [];
  const manifest = await manifestFixture('complete');
  await verifyManifest({ manifest, bundle: 'bundle.json', identity: 'release-workflow@main', issuer: 'https://token.actions.githubusercontent.com' }, async (args) => calls.push(args));
  assert.deepEqual(calls[0].slice(0, -1), [
    'verify-blob', '--bundle', 'bundle.json',
    '--certificate-identity', 'release-workflow@main',
    '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com',
  ]);
});

test('rejects unsupported manifests before invoking cosign', async () => {
  const manifest = await manifestFixture('draft');
  await assert.rejects(() => signManifest({ manifest, bundle: 'bundle.json' }, async () => { throw new Error('must not run'); }), /unsupported/);
});
