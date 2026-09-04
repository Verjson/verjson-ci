#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalBytes } from './manifest.mjs';
import { serializeCanonicalResult } from '../../packages/result-contract/src/index.mjs';

const [forge, image, imageDigest, commit, requestId, output, keyRoot, fixtureRoot = process.cwd()] = process.argv.slice(2);
if (!['github', 'gitlab'].includes(forge) || !output || !keyRoot) throw new Error('usage: disposable-forge-fixture.mjs FORGE IMAGE IMAGE_DIGEST COMMIT REQUEST_ID OUTPUT KEY_ROOT');
await mkdir(path.dirname(output), { recursive: true }); await mkdir(keyRoot, { recursive: true });
const resultPath = path.resolve(fixtureRoot, '.verjson-ci/local', forge === 'github' ? 'result.json' : 'success-gitlab.json');
if (forge === 'github') {
  await mkdir(path.dirname(resultPath), { recursive: true });
  const artifactPath = path.resolve(fixtureRoot, '.act-artifacts'); await mkdir(artifactPath);
  run(process.env.ACT_BIN || 'act', ['workflow_dispatch', '--workflows', '.github/workflows/disposable-consumption.yml', '--input', `image=${image}`, '--artifact-server-path', artifactPath, '--platform', `ubuntu-24.04=${process.env.ACT_PLATFORM_IMAGE || 'catthehacker/ubuntu:act-24.04'}`]);
} else {
  run(path.resolve(fixtureRoot, 'dev/gitlab/run-local'), ['success', image]);
}
const result = JSON.parse(await readFile(resultPath, 'utf8')); delete result.commit; delete result.provider;
const resultDigest = `sha256:${createHash('sha256').update(serializeCanonicalResult(result)).digest('hex')}`;
const receipt = { forge, requestId, commit, imageDigest, resultDigest };
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const privatePath = path.join(keyRoot, `${forge}.private.pem`); const publicPath = path.join(keyRoot, `${forge}.public.pem`);
await writeFile(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
await writeFile(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { flag: 'wx' });
const signature = sign(null, Buffer.from(canonicalBytes(receipt)), privateKey).toString('base64');
await writeFile(output, `${JSON.stringify({ receipt, result, signature, publicKey: publicPath })}\n`, { flag: 'wx' });

function run(command, args) { const result = spawnSync(command, args, { cwd: fixtureRoot, stdio: 'inherit', env: process.env }); if (result.status !== 0) throw new Error(`${forge} fixture failed with status ${result.status}`); }
