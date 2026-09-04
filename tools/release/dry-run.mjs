#!/usr/bin/env node
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileReleaseStore } from '../../packages/release/src/file-store.mjs';
import { ReleaseOrchestrator } from '../../packages/release/src/index.mjs';
import { canonicalBytes, manifestDigest } from './manifest.mjs';

const [version, commit, output = '.release-dry-run'] = process.argv.slice(2);
if (!version || !commit) throw new Error('usage: dry-run.mjs VERSION COMMIT [OUTPUT]');
const work = await mkdtemp(path.join(tmpdir(), 'verjson-ci-release-'));
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signed = (value) => sign(null, Buffer.from(canonicalBytes(value)), privateKey).toString('base64');
const signer = {
  signRecord: async (record) => signed(record),
  verifyRecord: async (record) => { const { signature, ...unsigned } = record; if (!verify(null, Buffer.from(canonicalBytes(unsigned)), publicKey, Buffer.from(signature, 'base64'))) throw new Error('invalid dry-run ledger signature'); },
};
const imageDigest = `sha256:${createHash('sha256').update(commit).digest('hex')}`;
const resultDigest = `sha256:${createHash('sha256').update(`${version}:${commit}`).digest('hex')}`;
const requestId = `dry-run-${version}-${commit}`;
const envelopes = Object.fromEntries(['github', 'gitlab'].map((forge) => { const receipt = { forge, requestId, commit, imageDigest, resultDigest }; return [forge, { receipt, signature: signed(receipt) }]; }));
const endpointRoot = path.join(work, 'endpoints'); await mkdir(endpointRoot);
const orchestrator = new ReleaseOrchestrator({
  license: { assertPublishable: async () => { throw new Error('dry run crossed the public-release gate'); } },
  store: new FileReleaseStore(path.join(work, 'ledger')),
  builder: { buildOnce: async () => ({ imageReference: 'ghcr.io/verjson/verjson-ci', imageDigest, cli: { version, path: `verjson-ci-${version}.tgz`, sha256: createHash('sha256').update(`cli:${commit}`).digest('hex') } }) },
  conformance: { run: async () => envelopes },
  receiptVerifier: { verify: async (forge, envelope, expected) => {
    if (!verify(null, Buffer.from(canonicalBytes(envelope.receipt)), publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error(`${forge} dry-run receipt signature invalid`);
    if (envelope.receipt.commit !== expected.commit || envelope.receipt.imageDigest !== expected.imageDigest) throw new Error(`${forge} dry-run receipt identity invalid`);
    return { ...envelope.receipt, verification: { issuer: 'https://dry-run.invalid', certificateIdentity: `${forge}:local-fixture`, bundleDigest: `sha256:${createHash('sha256').update(envelope.signature).digest('hex')}` } };
  } }, signer,
  tagger: { createImmutable: async () => { throw new Error('dry run attempted to create a tag'); } },
  publisher: {
    endpoints: async (manifest) => ['github-action', 'gitlab-component', 'cli', 'oci'].map((id) => ({ id, digest: `sha256:${createHash('sha256').update(`${id}:${manifestDigest(manifest)}`).digest('hex')}` })),
    readDigest: async (endpoint) => { try { return (await readFile(path.join(endpointRoot, endpoint.id), 'utf8')).trim(); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } },
    create: async (endpoint) => writeFile(path.join(endpointRoot, endpoint.id), `${endpoint.digest}\n`, { flag: 'wx' }),
  },
});
try {
  const manifest = await orchestrator.release({ version, commit, dryRun: true, requestId });
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(output, 'ledger-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  await cp(path.join(work, 'ledger'), path.join(output, 'ledger'), { recursive: true, errorOnExist: true, force: false });
  process.stdout.write(`dry-run release complete: ${manifestDigest(manifest)}\n`);
} finally { await rm(work, { recursive: true, force: true }); }
