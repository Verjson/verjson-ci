#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const STATES = new Set(['staged', 'complete', 'quarantined']);

export async function signManifest({ manifest, bundle }, run = runCosign) {
  await validateManifestFile(manifest);
  await run(['sign-blob', '--yes', '--bundle', bundle, manifest]);
  return bundle;
}

export async function verifyManifest({ manifest, bundle, identity, issuer }, run = runCosign) {
  if (!identity || !issuer) throw new Error('certificate identity and OIDC issuer are required');
  await validateManifestFile(manifest);
  await run([
    'verify-blob', '--bundle', bundle,
    '--certificate-identity', identity,
    '--certificate-oidc-issuer', issuer,
    manifest,
  ]);
}

async function validateManifestFile(path) {
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  if (manifest.schemaVersion !== 1 || !STATES.has(manifest.state)) throw new Error('unsupported release manifest');
}

async function runCosign(args) {
  await execFileAsync(process.env.COSIGN_BIN || 'cosign', args, { env: process.env });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, manifest, bundle] = process.argv.slice(2);
    if (command === 'sign') await signManifest({ manifest, bundle });
    else if (command === 'verify') {
      await verifyManifest({
        manifest, bundle,
        identity: process.env.VERJSON_CI_SIGNING_IDENTITY,
        issuer: process.env.VERJSON_CI_SIGNING_ISSUER,
      });
    } else throw new Error('usage: cosign.mjs sign|verify MANIFEST BUNDLE');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
