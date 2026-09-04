#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalBytes } from './manifest.mjs';
import { serializeCanonicalResult } from '../../packages/result-contract/src/index.mjs';

const [forge, image, imageDigest, commit, requestId, output, keyRoot] = process.argv.slice(2);
if (!['github', 'gitlab'].includes(forge) || !output || !keyRoot) throw new Error('usage: disposable-forge-fixture.mjs FORGE IMAGE IMAGE_DIGEST COMMIT REQUEST_ID OUTPUT KEY_ROOT');
await mkdir(path.dirname(output), { recursive: true }); await mkdir(keyRoot, { recursive: true });
const resultPath = path.resolve('.verjson-ci/local', `success-${forge}.json`);
if (forge === 'github') {
  await mkdir(path.dirname(resultPath), { recursive: true });
  run('docker', ['run', '--rm', '--volume', `${process.cwd()}:/workspace`, '--workdir', '/workspace', '--env', 'VERJSON_CI_PROVIDER=github', '--env', 'VERJSON_CI_SCENARIO=success', '--env', `VERJSON_CI_COMMIT=${commit}`, image, 'run', '--config', 'test/fixtures/success/verjson-ci.yml', '--output', '.verjson-ci/local/success-github.json']);
} else {
  run(path.resolve('dev/gitlab/run-local'), ['success', image]);
}
const result = JSON.parse(await readFile(resultPath, 'utf8')); delete result.commit; delete result.provider;
const resultDigest = `sha256:${createHash('sha256').update(serializeCanonicalResult(result)).digest('hex')}`;
const receipt = { forge, requestId, commit, imageDigest, resultDigest };
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePath = path.join(keyRoot, `${forge}.private.pem`); const publicPath = path.join(keyRoot, `${forge}.public.pem`);
await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
await writeFile(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
const signature = sign(null, Buffer.from(canonicalBytes(receipt)), privateKey).toString('base64');
await writeFile(output, `${JSON.stringify({ receipt, signature, publicKey: publicPath })}\n`, { flag: 'wx' });

function run(command, args) { const result = spawnSync(command, args, { cwd: process.cwd(), stdio: 'inherit' }); if (result.status !== 0) throw new Error(`${forge} fixture failed with status ${result.status}`); }
