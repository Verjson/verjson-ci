#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function buildManifest(input) {
  if (!SEMVER.test(input.version)) throw new Error('version must be unprefixed SemVer');
  if (!SHA.test(input.commit)) throw new Error('commit must be a full Git SHA');
  if (!DIGEST.test(input.imageDigest)) throw new Error('image digest must be sha256');
  const receipts = Object.fromEntries(['github', 'gitlab'].map((forge) => [forge, validateReceipt(input.receipts?.[forge], forge, input)]));
  if (receipts.github.requestId !== receipts.gitlab.requestId) throw new Error('receipt request IDs differ');
  if (receipts.github.resultDigest !== receipts.gitlab.resultDigest) throw new Error('receipt result digests differ');

  return {
    schemaVersion: 1,
    version: input.version,
    commit: input.commit,
    state: input.state ?? 'staged',
    artifacts: {
      cli: input.cli,
      oci: { reference: input.imageReference, digest: input.imageDigest },
      github: { action: 'adapters/github/action', workflow: '.github/workflows/reusable-ci.yml', ref: input.version },
      gitlab: { component: 'templates/ci.yml', ref: input.version },
      schema: { path: 'verjson-ci.schema.json', version: 1 },
      mirror: { terraform: 'terraform/gitlab-mirror', sync: 'tools/mirror/sync.mjs' },
    },
    receipts,
  };
}

export function completeManifest(manifest) {
  if (manifest.state !== 'staged') throw new Error('only a staged manifest can complete');
  return { ...manifest, state: 'complete' };
}

export function quarantineManifest(manifest, reason) {
  if (!reason) throw new Error('quarantine reason required');
  return { ...manifest, state: 'quarantined', quarantineReason: reason };
}

function validateReceipt(receipt, forge, input) {
  if (!receipt || receipt.forge !== forge) throw new Error(`${forge} receipt missing or mislabeled`);
  if (receipt.commit !== input.commit || receipt.imageDigest !== input.imageDigest) throw new Error(`${forge} receipt artifact identity differs`);
  if (!receipt.signature?.certificateIdentity || !receipt.signature?.issuer) throw new Error(`${forge} receipt signature identity missing`);
  if (!DIGEST.test(receipt.resultDigest)) throw new Error(`${forge} result digest invalid`);
  return receipt;
}

export async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [inputPath, outputPath] = process.argv.slice(2);
    if (!inputPath || !outputPath) throw new Error('usage: manifest.mjs INPUT.json OUTPUT.json');
    const manifest = buildManifest(JSON.parse(await readFile(inputPath, 'utf8')));
    await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
