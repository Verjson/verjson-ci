#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
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
let registryContainer;

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
  const cliConsumer = path.join(work, 'cli-consumer'); await mkdir(cliConsumer);
  await execFileAsync('npm', ['install', '--prefix', cliConsumer, cli.path]);
  await execFileAsync(path.join(cliConsumer, 'node_modules/.bin/verjson-ci'), ['run', '--config', path.resolve('test/fixtures/success/verjson-ci.yml'), '--output', path.join(cliConsumer, 'result.json')], { env: { ...process.env, VERJSON_CI_PROVIDER: 'github', VERJSON_CI_SCENARIO: 'success', VERJSON_CI_COMMIT: commit } });
  await execFileAsync('docker', ['build', '--file', 'container/Dockerfile', '--tag', `verjson-ci-disposable:${version}`, '.']);
  registryContainer = `verjson-ci-release-registry-${process.pid}`;
  await execFileAsync('docker', ['run', '--detach', '--rm', '--name', registryContainer, '--publish', '127.0.0.1::5000', 'registry:2']);
  const { stdout: port } = await execFileAsync('docker', ['port', registryContainer, '5000/tcp']);
  const imageRepository = `localhost:${port.trim().split(':').at(-1)}/verjson-ci`;
  await execFileAsync('docker', ['tag', `verjson-ci-disposable:${version}`, `${imageRepository}:${version}`]);
  await execFileAsync('docker', ['push', `${imageRepository}:${version}`]);
  const { stdout: repoDigest } = await execFileAsync('docker', ['image', 'inspect', '--format={{index .RepoDigests 0}}', `${imageRepository}:${version}`]);
  const image = repoDigest.trim(); const imageDigest = image.slice(image.lastIndexOf('@') + 1);
  const ociTar = path.join(sourceRoot, 'oci.tar');
  await execFileAsync('docker', ['save', '--output', ociTar, `${imageRepository}:${version}`]);
  const tagRepository = path.join(work, 'github.git'); const mirrorRepository = path.join(work, 'gitlab.git');
  await execFileAsync('git', ['clone', '--bare', '.', tagRepository]); await execFileAsync('git', ['init', '--bare', mirrorRepository]);
  await execFileAsync('git', ['--git-dir', tagRepository, 'tag', version, commit]);
  await execFileAsync('git', ['--git-dir', tagRepository, 'push', mirrorRepository, `refs/tags/${version}:refs/tags/${version}`]);
  const githubConsumer = path.join(work, 'github-consumer'); const gitlabConsumer = path.join(work, 'gitlab-consumer');
  await execFileAsync('git', ['clone', '--branch', version, tagRepository, githubConsumer]);
  await execFileAsync('git', ['clone', '--branch', version, mirrorRepository, gitlabConsumer]);
  const requestId = `dry-run-${version}-${commit}`;
  const forgeKeyRoot = path.join(work, 'forge-keys'); const receipts = {};
  for (const forge of ['github', 'gitlab']) {
    const receiptPath = path.join(work, `${forge}-receipt.json`);
    const fixtureRoot = forge === 'github' ? githubConsumer : gitlabConsumer;
    await execFileAsync(process.execPath, [path.resolve('tools/release/disposable-forge-fixture.mjs'), forge, image, imageDigest, commit, requestId, receiptPath, forgeKeyRoot, fixtureRoot], { env: process.env });
    receipts[forge] = JSON.parse(await readFile(receiptPath, 'utf8'));
  }
  const sources = {
    cli: cli.path, oci: ociTar,
    'github-action': await materialize('github-action', await treeBytes('adapters/github')),
    'gitlab-component': await materialize('gitlab-component', await treeBytes('templates')),
    'gitlab-mirror': await materialize('gitlab-mirror', Buffer.from(`${commit}\n`)),
    'release-tag': await materialize('release-tag', Buffer.from(`${commit}\n`)),
    'github-consumption': await materialize('github-consumption', Buffer.from(canonicalBytes(receipts.github.result))),
    'gitlab-consumption': await materialize('gitlab-consumption', Buffer.from(canonicalBytes(receipts.gitlab.result))),
  };
  const endpointDigests = Object.fromEntries(await Promise.all(REQUIRED_ENDPOINT_IDS.map(async (id) => [id, await digestFile(sources[id])])));
  return { cli, imageReference: image.slice(0, image.lastIndexOf('@')), imageDigest, endpointDigests, receipts, requestId, sources, tagRepository, mirrorRepository };
}

async function runRelease(artifacts, interrupt) {
  let interrupted = false;
  const publisher = {
    endpoints: async () => REQUIRED_ENDPOINT_IDS.map((id) => ({ id, digest: artifacts.endpointDigests[id], source: artifacts.sources[id] })),
    readDigest: async (endpoint) => {
      if (endpoint.id === 'release-tag' || endpoint.id === 'gitlab-mirror') {
        const repository = endpoint.id === 'release-tag' ? artifacts.tagRepository : artifacts.mirrorRepository;
        try { const { stdout } = await execFileAsync('git', ['--git-dir', repository, 'rev-parse', `refs/tags/${version}^{}`]); return `sha256:${createHash('sha256').update(`${stdout.trim()}\n`).digest('hex')}`; }
        catch (error) { if (error.code === 128 || error.stderr?.includes('unknown revision')) return undefined; throw error; }
      }
      try { return await digestFile(path.join(endpointRoot, endpoint.id)); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
    },
    create: async (endpoint) => {
      if (endpoint.id === 'release-tag') await execFileAsync('git', ['--git-dir', artifacts.tagRepository, 'tag', version, commit]);
      else if (endpoint.id === 'gitlab-mirror') await execFileAsync('git', ['--git-dir', artifacts.tagRepository, 'push', artifacts.mirrorRepository, `refs/tags/${version}:refs/tags/${version}`]);
      else await cp(endpoint.source, path.join(endpointRoot, endpoint.id), { errorOnExist: true, force: false });
      if (interrupt && !interrupted && endpoint.id === 'gitlab-mirror') { interrupted = true; throw Object.assign(new Error('simulated process interruption'), { code: 'interrupted', retryable: true, phase: endpoint.id }); }
    },
  };
  const orchestrator = new ReleaseOrchestrator({
    license: { assertPublishable: async () => { throw new Error('dry run crossed the public-release gate'); } },
    store: new FileReleaseStore(path.join(work, 'ledger'), { checkpointRoot: path.join(work, 'anchors') }),
    builder: { buildOnce: async () => artifacts }, conformance: { run: async () => artifacts.receipts },
    receiptVerifier: { verify: async (forge, envelope, expected) => {
      const forgePublicKey = createPublicKey(await readFile(envelope.publicKey));
      if (!verify(null, Buffer.from(canonicalBytes(envelope.receipt)), forgePublicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error(`${forge} receipt signature invalid`);
      if (envelope.receipt.commit !== expected.commit || envelope.receipt.imageDigest !== expected.imageDigest || envelope.receipt.requestId !== expected.requestId) throw new Error(`${forge} receipt identity invalid`);
      return { ...envelope.receipt, verification: { issuer: 'https://dry-run.invalid', certificateIdentity: `${forge}:disposable-fixture`, bundleDigest: `sha256:${createHash('sha256').update(envelope.signature).digest('hex')}` } };
    } }, signer: signer(), publisher,
  });
  return orchestrator.release({ version, commit, dryRun: true, requestId: artifacts.requestId });
}

async function materialize(name, bytes) { const target = path.join(sourceRoot, name); await writeFile(target, bytes, { flag: 'wx' }); return target; }
async function digestFile(file) { return `sha256:${createHash('sha256').update(await readFile(file)).digest('hex')}`; }
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
  await cp(path.join(work, 'anchors'), path.join(output, 'independent-anchors'), { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(work, 'forge-keys'), path.join(output, 'forge-public-keys'), { recursive: true, filter: (source) => !source.endsWith('.private.pem'), errorOnExist: true, force: false });
  await cp(endpointRoot, path.join(output, 'disposable-endpoints'), { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(work, 'github.git'), path.join(output, 'github.git'), { recursive: true, errorOnExist: true, force: false });
  await cp(path.join(work, 'gitlab.git'), path.join(output, 'gitlab.git'), { recursive: true, errorOnExist: true, force: false });
  process.stdout.write(`disposable release complete after restart: ${manifestDigest(manifest)}\n`);
} finally { if (registryContainer) await execFileAsync('docker', ['rm', '--force', registryContainer]).catch(() => {}); await rm(work, { recursive: true, force: true }); }
