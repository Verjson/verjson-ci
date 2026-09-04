#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { FRAMEWORK_PACKS } from '../../packages/compliance/src/index.mjs';
import schemaV1 from '../../release/manifest-v1.schema.json' with { type: 'json' };
import schemaV2 from '../../release/manifest.schema.json' with { type: 'json' };

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SHA = /^[0-9a-f]{40}$/;
const HEX = /^[0-9a-f]{64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STATES = new Set(['staged', 'complete', 'quarantined']);
export const REQUIRED_ENDPOINT_IDS = Object.freeze(['release-tag', 'cli', 'oci', 'github-action', 'gitlab-mirror', 'gitlab-component', 'github-consumption', 'gitlab-consumption']);
const ajv = new Ajv2020({ strict: true, strictRequired: false, formats: { uri: /^https:\/\/[^\s]+$/ } });
const schemaValidators = new Map([[1, ajv.compile(schemaV1)], [2, ajv.compile(schemaV2)]]);

export function canonicalBytes(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalBytes(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function manifestDigest(manifest) {
  return `sha256:${createHash('sha256').update(canonicalBytes(manifest)).digest('hex')}`;
}
export const objectDigest = manifestDigest;

export function buildManifest(input) {
  const receipts = Object.fromEntries(['github', 'gitlab'].map((forge) => [forge, validateReceipt(input.receipts?.[forge], forge, input)]));
  const manifest = {
    schemaVersion: 2, version: input.version, commit: input.commit, state: input.state ?? 'staged',
    artifacts: {
      cli: input.cli, oci: { reference: input.imageReference, digest: input.imageDigest },
      github: { path: 'adapters/github/action', ref: input.version }, gitlab: { path: 'templates/ci.yml', ref: input.version },
      schema: { path: 'verjson-ci.schema.json', version: 1 }, mirror: { terraform: 'terraform/gitlab-mirror', sync: 'tools/mirror/sync.mjs' },
      compliance: { path: 'packages/compliance/packs', packs: FRAMEWORK_PACKS },
    }, receipts, endpoints: Object.fromEntries(REQUIRED_ENDPOINT_IDS.map((id) => [id, input.endpointDigests?.[id]])),
  };
  validateManifest(manifest);
  return manifest;
}

export function validateManifest(manifest) {
  const schemaValidator = schemaValidators.get(manifest?.schemaVersion);
  if (!schemaValidator || !schemaValidator(manifest)) throw new Error(`release manifest schema invalid: ${schemaValidator?.errors?.[0]?.instancePath || '/'} ${schemaValidator?.errors?.[0]?.message ?? 'unsupported schemaVersion'}`);
  exact(manifest, ['schemaVersion', 'version', 'commit', 'state', 'artifacts', 'receipts', 'endpoints', ...(manifest?.state === 'quarantined' ? ['quarantineReason'] : [])], 'manifest');
  if (![1, 2].includes(manifest.schemaVersion) || !SEMVER.test(manifest.version) || !SHA.test(manifest.commit) || !STATES.has(manifest.state)) throw new Error('invalid release manifest identity');
  if (manifest.state === 'quarantined' ? !manifest.quarantineReason : 'quarantineReason' in manifest) throw new Error('invalid quarantine state');
  exact(manifest.artifacts, ['cli', 'oci', 'github', 'gitlab', 'schema', 'mirror', ...(manifest.schemaVersion === 2 ? ['compliance'] : [])], 'artifacts');
  const { cli, oci } = manifest.artifacts;
  exact(cli, ['version', 'path', 'sha256'], 'CLI artifact');
  if (cli.version !== manifest.version || !cli.path || !HEX.test(cli.sha256)) throw new Error('CLI version or integrity differs from release');
  exact(oci, ['reference', 'digest'], 'OCI artifact');
  if (!oci.reference || !DIGEST.test(oci.digest)) throw new Error('invalid OCI artifact');
  if (manifest.schemaVersion === 2) {
    exact(manifest.artifacts.compliance, ['path', 'packs'], 'compliance artifact');
    if (manifest.artifacts.compliance.path !== 'packages/compliance/packs' || canonicalBytes(manifest.artifacts.compliance.packs) !== canonicalBytes(FRAMEWORK_PACKS)) throw new Error('compliance pack catalog differs from release');
  }
  exact(manifest.receipts, ['github', 'gitlab'], 'receipts');
  exact(manifest.endpoints, REQUIRED_ENDPOINT_IDS, 'endpoints');
  for (const id of REQUIRED_ENDPOINT_IDS) if (!DIGEST.test(manifest.endpoints[id])) throw new Error(`endpoint ${id} digest invalid`);
  for (const forge of ['github', 'gitlab']) {
    exact(manifest.artifacts[forge], ['path', 'ref'], `${forge} artifact`);
    if (!manifest.artifacts[forge].path || manifest.artifacts[forge].ref !== manifest.version) throw new Error(`${forge} artifact version differs`);
    validateReceipt(manifest.receipts[forge], forge, { commit: manifest.commit, imageDigest: oci.digest });
  }
  if (manifest.receipts.github.requestId !== manifest.receipts.gitlab.requestId || manifest.receipts.github.resultDigest !== manifest.receipts.gitlab.resultDigest) throw new Error('receipt parity differs');
  return manifest;
}

export function completeManifest(manifest, publishedEndpoints) {
  validateManifest(manifest);
  if (manifest.state !== 'staged') throw new Error('only a staged manifest can complete');
  if (!Array.isArray(publishedEndpoints) || new Set(publishedEndpoints).size !== publishedEndpoints.length || [...publishedEndpoints].sort().join() !== [...REQUIRED_ENDPOINT_IDS].sort().join()) throw new Error('all required endpoints must be reconciled before completion');
  return validateManifest({ ...manifest, state: 'complete' });
}
export function quarantineManifest(manifest, reason) { validateManifest(manifest); if (!reason) throw new Error('quarantine reason required'); const { quarantineReason: _, ...base } = manifest; return validateManifest({ ...base, state: 'quarantined', quarantineReason: reason }); }

function validateReceipt(receipt, forge, input) {
  exact(receipt, ['forge', 'requestId', 'commit', 'imageDigest', 'resultDigest', 'verification'], `${forge} receipt`);
  if (receipt.forge !== forge || !receipt.requestId || receipt.commit !== input.commit || receipt.imageDigest !== input.imageDigest || !DIGEST.test(receipt.resultDigest)) throw new Error(`${forge} receipt identity differs`);
  exact(receipt.verification, ['issuer', 'certificateIdentity', 'bundleDigest'], `${forge} receipt verification`);
  if (!URL.canParse(receipt.verification.issuer) || !receipt.verification.certificateIdentity || !DIGEST.test(receipt.verification.bundleDigest)) throw new Error(`${forge} receipt verification invalid`);
  return receipt;
}

function exact(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error(`${name} has invalid properties`);
}

export async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { const [inputPath, outputPath] = process.argv.slice(2); if (!inputPath || !outputPath) throw new Error('usage: manifest.mjs INPUT.json OUTPUT.json'); const manifest = buildManifest(JSON.parse(await readFile(inputPath, 'utf8'))); await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' }); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
