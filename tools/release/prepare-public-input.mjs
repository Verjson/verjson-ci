#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REQUIRED_ENDPOINT_IDS, validateManifest } from './manifest.mjs';

const [proofPath, proofBundle, outputPath, repository, version, commit] = process.argv.slice(2);
if (!proofPath || !proofBundle || !outputPath || !repository || !version || !commit) throw new Error('usage: prepare-public-input.mjs PROOF BUNDLE OUTPUT REPOSITORY VERSION COMMIT');
const proof = validateManifest(JSON.parse(await readFile(proofPath, 'utf8')));
if (proof.version !== version || proof.commit !== commit || proof.state !== 'complete') throw new Error('disposable proof differs from public release identity');
const imageReference = `ghcr.io/${repository.toLowerCase()}`;
const artifacts = {
  imageReference, imageDigest: proof.artifacts.oci.digest,
  cli: { ...proof.artifacts.cli, path: path.resolve(path.dirname(proofPath), 'disposable-endpoints/cli') },
  endpointDigests: proof.endpoints,
};
const helper = path.resolve('tools/release/public-endpoint.mjs');
const plan = REQUIRED_ENDPOINT_IDS.map((id) => ({
  id, digest: proof.endpoints[id],
  observe: [process.execPath, helper, 'observe', id, version, commit, proof.endpoints[id]],
  create: [process.execPath, helper, 'create', id, version, commit, proof.endpoints[id]],
}));
await writeFile(outputPath, `${JSON.stringify({ candidate: { version, commit, requestId: proof.receipts.github.requestId }, artifacts, verifiedReceipts: proof.receipts, proof: { manifest: path.resolve(proofPath), bundle: path.resolve(proofBundle) }, plan, repository }, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
