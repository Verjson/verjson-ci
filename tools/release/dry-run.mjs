#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { FileReleaseStore } from '../../packages/release/src/file-store.mjs';
import { ReleaseOrchestrator, ReleaseQuarantinedError } from '../../packages/release/src/index.mjs';
import { canonicalBytes, manifestDigest, REQUIRED_ENDPOINT_IDS } from './manifest.mjs';

const execFileAsync = promisify(execFile);
const [version, commit, output = '.release-dry-run'] = process.argv.slice(2);
if (!version || !commit) throw new Error('usage: dry-run.mjs VERSION COMMIT [OUTPUT]');
const work = await mkdtemp(path.join(tmpdir(), 'verjson-ci-release-'));
const sourceRoot = path.join(work, 'sources');
const endpointRoot = path.join(work, 'endpoints');
await mkdir(sourceRoot); await mkdir(endpointRoot);

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const signerIdentity = `ed25519:${createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')}`;
const signed = (value) => sign(null, Buffer.from(canonicalBytes(value)), privateKey).toString('base64');
const signer = () => ({
  identity: signerIdentity,
  signRecord: async (record) => signed(record),
  verifyRecord: async (record) => { const { signature, ...unsigned } = record; if (!verify(null, Buffer.from(canonicalBytes(unsigned)), publicKey, Buffer.from(signature, 'base64'))) throw new Error('invalid dry-run ledger signature'); },
});

async function prepareArtifacts() {
  const cliDirectory = path.join(work, 'cli');
  const { stdout } = await execFileAsync(process.execPath, ['tools/release/package-cli.mjs', version, cliDirectory]);
  const packagedCli = JSON.parse(stdout);
  const cli = { version: packagedCli.version, path: packagedCli.path, sha256: packagedCli.sha256 };
  await execFileAsync('docker', ['build', '--file', 'container/Dockerfile', '--tag', `verjson-ci-disposable:${version}`, '.']);
  const { stdout: imageDigest } = await execFileAsync('docker', ['image', 'inspect', '--format={{.Id}}', `verjson-ci-disposable:${version}`]);
  const ociTar = path.join(sourceRoot, 'oci.tar');
  await execFileAsync('docker', ['save', '--output', ociTar, `verjson-ci-disposable:${version}`]);
  const requestId = `dry-run-${version}-${commit}`;
  const resultDigest = await digestTree('test/fixtures/success');
  const receipts = Object.fromEntries(['github', 'gitlab'].map((forge) => { const receipt = { forge, requestId, commit, imageDigest: imageDigest.trim(), resultDigest }; return [forge, { receipt, signature: signed(receipt) }]; }));
  const sources = {
    cli: cli.path, oci: ociTar,
    'github-action': await materialize('github-action', await treeBytes('adapters/github')),
    'gitlab-component': await materialize('gitlab-component', await treeBytes('templates')),
    'gitlab-mirror': await materialize('gitlab-mirror', await treeBytes('terraform/gitlab-mirror', 'tools/mirror')),
    'release-tag': await materialize('release-tag', Buffer.from(`${commit}\n`)),
    'github-consumption': await materialize('github-consumption', Buffer.from(canonicalBytes(receipts.github.receipt))),
    'gitlab-consumption': await materialize('gitlab-consumption', Buffer.from(canonicalBytes(receipts.gitlab.receipt))),
  };
  const endpointDigests = Object.fromEntries(await Promise.all(REQUIRED_ENDPOINT_IDS.map(async (id) => [id, await digestFile(sources[id])])));
  return { cli, imageReference: 'disposable://verjson-ci', imageDigest: imageDigest.trim(), endpointDigests, receipts, requestId, sources };
}

async function runRelease(artifacts, interrupt) {
  let interrupted = false;
  const publisher = {
    endpoints: async () => REQUIRED_ENDPOINT_IDS.map((id) => ({ id, digest: artifacts.endpointDigests[id], source: artifacts.sources[id] })),
    readDigest: async (endpoint) => { try { return await digestFile(path.join(endpointRoot, endpoint.id)); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } },
    create: async (endpoint) => {
      await cp(endpoint.source, path.join(endpointRoot, endpoint.id), { errorOnExist: true, force: false });
      if (interrupt && !interrupted && endpoint.id === 'gitlab-mirror') { interrupted = true; throw Object.assign(new Error('simulated process interruption'), { code: 'interrupted', retryable: true, phase: endpoint.id }); }
    },
  };
  const orchestrator = new ReleaseOrchestrator({
    license: { assertPublishable: async () => { throw new Error('dry run crossed the public-release gate'); } },
    store: new FileReleaseStore(path.join(work, 'ledger')),
    builder: { buildOnce: async () => artifacts }, conformance: { run: async () => artifacts.receipts },
    receiptVerifier: { verify: async (forge, envelope, expected) => {
      if (!verify(null, Buffer.from(canonicalBytes(envelope.receipt)), publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error(`${forge} receipt signature invalid`);
      if (envelope.receipt.commit !== expected.commit || envelope.receipt.imageDigest !== expected.imageDigest || envelope.receipt.requestId !== expected.requestId) throw new Error(`${forge} receipt identity invalid`);
      return { ...envelope.receipt, verification: { issuer: 'https://dry-run.invalid', certificateIdentity: `${forge}:disposable-fixture`, bundleDigest: `sha256:${createHash('sha256').update(envelope.signature).digest('hex')}` } };
    } }, signer: signer(), publisher,
  });
  return orchestrator.release({ version, commit, dryRun: true, requestId: artifacts.requestId });
}

async function materialize(name, bytes) { const target = path.join(sourceRoot, name); await writeFile(target, bytes, { flag: 'wx' }); return target; }
async function digestFile(file) { return `sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`; }
async function digestTree(...roots) { return `sha256:${createHash('sha256').update(await treeBytes(...roots)).digest('hex')}`; }
async function treeBytes(...roots) {
  const entries = [];
  async function visit(current) { for (const name of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) { const file = path.join(current, name.name); if (name.isDirectory()) await visit(file); else entries.push(`${file}\0${(await readFile(file)).toString('base64')}\n`); } }
  for (const root of roots) await visit(root);
  return Buffer.from(entries.join(''));
}

try {
  const artifacts = await prepareArtifacts();
  await runRelease(artifacts, true).then(() => { throw new Error('interruption was not exercised'); }, (error) => { if (!(error instanceof ReleaseQuarantinedError)) throw error; });
  const manifest = await runRelease(artifacts, false);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await writeFile(path.join(output, 'ledger-public-key.pem'), publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
  await cp(path.join(work, 'ledger'), path.join(output, 'ledger'), { recursive: true, errorOnExist: true, force: false });
  await cp(endpointRoot, path.join(output, 'disposable-endpoints'), { recursive: true, errorOnExist: true, force: false });
  process.stdout.write(`disposable release complete after restart: ${manifestDigest(manifest)}\n`);
} finally { await rm(work, { recursive: true, force: true }); }
