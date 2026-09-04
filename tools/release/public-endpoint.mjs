#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { REQUIRED_ENDPOINT_IDS } from './manifest.mjs';
import { canonicalBytes } from './manifest.mjs';

const exec = promisify(execFile); const [operation, id, version, commit, expected] = process.argv.slice(2);
if (!['observe', 'create'].includes(operation) || !REQUIRED_ENDPOINT_IDS.includes(id) || !version || !commit || !/^sha256:[0-9a-f]{64}$/.test(expected)) throw new Error('invalid public endpoint operation');
const repository = process.env.GITHUB_REPOSITORY; const image = `ghcr.io/${repository.toLowerCase()}:${version}`;

try {
  if (operation === 'create') await create();
  const digest = await observe();
  if (!digest) process.exit(44);
  process.stdout.write(`${digest}\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

async function observe() {
  if (id === 'oci') {
    try { const { stdout } = await exec('docker', ['buildx', 'imagetools', 'inspect', image]); const match = stdout.match(/^Digest:\s+(sha256:[0-9a-f]{64})$/m); return match?.[1]; } catch { return undefined; }
  }
  if (['release-tag', 'github-action'].includes(id)) {
    try { const { stdout } = await exec('gh', ['api', `repos/${repository}/git/ref/tags/${version}`, '--jq', '.object.sha']); return stdout.trim() === commit ? expected : `sha256:${'f'.repeat(64)}`; } catch { return undefined; }
  }
  if (['gitlab-mirror', 'gitlab-component'].includes(id)) {
    try { const { stdout } = await exec('git', ['ls-remote', '--exit-code', '--tags', process.env.VERJSON_CI_GITLAB_MIRROR_URL, `refs/tags/${version}`]); return stdout.split(/\s/)[0] === commit ? expected : `sha256:${'f'.repeat(64)}`; } catch { return undefined; }
  }
  if (id === 'github-consumption' || id === 'gitlab-consumption') return observeConsumption();
  const asset = assetName(); const directory = await mkdtemp(path.join(tmpdir(), 'verjson-public-endpoint-'));
  try {
    await exec('gh', ['release', 'download', version, '--repo', repository, '--pattern', asset, '--dir', directory]);
    return `sha256:${createHash('sha256').update(await readFile(path.join(directory, asset))).digest('hex')}`;
  } catch { return undefined; } finally { await rm(directory, { recursive: true, force: true }); }
}

async function observeConsumption() {
  const directory = await mkdtemp(path.join(tmpdir(), 'verjson-public-receipt-'));
  try {
    await exec('gh', ['release', 'download', version, '--repo', repository, '--pattern', assetName(), '--dir', directory]);
    const envelope = JSON.parse(await readFile(path.join(directory, assetName()), 'utf8')); const publicKey = createPublicKey(envelope.publicKeyPem);
    if (!verify(null, Buffer.from(canonicalBytes(envelope.receipt)), publicKey, Buffer.from(envelope.signature, 'base64'))) throw new Error(`${id} persisted receipt signature invalid`);
    const forge = id.startsWith('github') ? 'github' : 'gitlab';
    if (envelope.receipt.forge !== forge || envelope.receipt.commit !== commit || envelope.receipt.imageDigest !== process.env.VERJSON_RELEASE_IMAGE_DIGEST || envelope.receipt.requestId !== process.env.VERJSON_RELEASE_REQUEST_ID) throw new Error(`${id} persisted receipt identity differs`);
    const result = Buffer.from(canonicalBytes(envelope.result)); const digest = `sha256:${createHash('sha256').update(result).digest('hex')}`;
    if (digest !== envelope.receipt.resultDigest) throw new Error(`${id} persisted result differs from receipt`);
    return digest;
  } catch (error) { if (/release not found|no assets|HTTP 404|not found/i.test(error.message)) return undefined; throw error; }
  finally { await rm(directory, { recursive: true, force: true }); }
}

async function create() {
  if (id === 'oci') { await exec('docker', ['build', '--file', 'container/Dockerfile', '--tag', image, '.']); await exec('docker', ['push', image]); return; }
  if (id === 'release-tag' || id === 'github-action') { await exec('gh', ['api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/tags/${version}`, '-f', `sha=${commit}`]).catch(async () => { if (await observe() !== expected) throw new Error('immutable GitHub tag conflict'); }); return; }
  if (id === 'gitlab-mirror' || id === 'gitlab-component') { await exec(process.execPath, ['tools/mirror/sync.mjs', '--source', `https://github.com/${repository}.git`, '--destination', process.env.VERJSON_CI_GITLAB_MIRROR_URL]); return; }
  let source = process.env[`VERJSON_RELEASE_${id.toUpperCase().replaceAll('-', '_')}_PATH`] || (id === 'cli' ? process.env.VERJSON_RELEASE_CLI_PATH : undefined);
  let receipt;
  if (id === 'github-consumption' || id === 'gitlab-consumption') {
    const forge = id.startsWith('github') ? 'github' : 'gitlab'; const directory = await mkdtemp(path.join(tmpdir(), `verjson-${forge}-public-consumer-`));
    const checkout = path.join(directory, 'checkout'); const envelope = path.join(directory, 'envelope.json'); const keys = path.join(directory, 'keys');
    try {
      const origin = forge === 'github' ? `https://github.com/${repository}.git` : process.env.VERJSON_CI_GITLAB_MIRROR_URL;
      await exec('git', ['clone', '--depth', '1', '--branch', version, origin, checkout]); await mkdir(keys);
      const imageDigest = process.env.VERJSON_RELEASE_IMAGE_DIGEST; const requestId = process.env.VERJSON_RELEASE_REQUEST_ID;
      if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest || '') || !requestId) throw new Error('public consumption identity missing');
      await exec(process.execPath, [path.resolve('tools/release/disposable-forge-fixture.mjs'), forge, `ghcr.io/${repository.toLowerCase()}@${imageDigest}`, imageDigest, commit, requestId, envelope, keys, checkout]);
      receipt = JSON.parse(await readFile(envelope, 'utf8'));
      const publicKey = createPublicKey(await readFile(receipt.publicKey));
      if (!verify(null, Buffer.from(canonicalBytes(receipt.receipt)), publicKey, Buffer.from(receipt.signature, 'base64'))) throw new Error(`${id} public receipt signature invalid`);
      if (receipt.receipt.forge !== forge || receipt.receipt.commit !== commit || receipt.receipt.imageDigest !== imageDigest || receipt.receipt.requestId !== requestId) throw new Error(`${id} public receipt identity differs`);
      const resultBytes = Buffer.from(canonicalBytes(receipt.result)); const observed = `sha256:${createHash('sha256').update(resultBytes).digest('hex')}`; if (observed !== expected) throw new Error(`${id} public adapter result differs from staged parity`);
      source = path.join(directory, 'public-receipt.json');
      await writeFile(source, canonicalBytes({ receipt: receipt.receipt, result: receipt.result, signature: receipt.signature, publicKeyPem: await readFile(receipt.publicKey, 'utf8') }), { flag: 'wx' });
      await upload(source, assetName()); return;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  if (!source) throw new Error(`${id} independently signed public artifact path missing`);
  await exec('gh', ['release', 'view', version, '--repo', repository]).catch(() => exec('gh', ['release', 'create', version, '--repo', repository, '--target', commit, '--verify-tag', '--title', version]));
  await upload(source, assetName());
}

function assetName() { return `${id}-${expected.slice(7)}.json`; }
async function upload(source, name) {
  const directory = await mkdtemp(path.join(tmpdir(), 'verjson-public-upload-'));
  try { const target = path.join(directory, name); await copyFile(source, target); await exec('gh', ['release', 'upload', version, target, '--repo', repository]); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
