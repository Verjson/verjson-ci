#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { signManifest, verifyManifest } from './cosign.mjs';

const exec = promisify(execFile); const [version, manifest, repository] = process.argv.slice(2);
if (!version || !manifest || !repository) throw new Error('usage: finalize-public.mjs VERSION MANIFEST REPOSITORY');
const directory = await mkdtemp(path.join(tmpdir(), 'verjson-final-manifest-')); const name = `verjson-ci-${version}-complete-manifest.json`; const target = path.join(directory, name);
try {
  const expected = await readFile(manifest); const bundle = path.join(directory, 'bundle.json');
  try {
    await exec('gh', ['release', 'download', version, '--repo', repository, '--pattern', name, '--dir', directory]);
    const persisted = JSON.parse(await readFile(target, 'utf8'));
    if (!Buffer.from(persisted.manifest, 'base64').equals(expected)) throw new Error('published complete manifest differs');
    await writeFile(bundle, Buffer.from(persisted.bundle, 'base64'), { flag: 'wx' });
    const snapshot = path.join(directory, 'snapshot.json'); await writeFile(snapshot, expected, { flag: 'wx' }); await verifyManifest({ manifest: snapshot, bundle });
  } catch (error) {
    if (!/release not found|no assets|HTTP 404|not found/i.test(error.message)) throw error;
    await signManifest({ manifest, bundle }); await verifyManifest({ manifest, bundle });
    await writeFile(target, `${JSON.stringify({ manifest: expected.toString('base64'), bundle: (await readFile(bundle)).toString('base64') })}\n`, { flag: 'wx' });
    await exec('gh', ['release', 'upload', version, target, '--repo', repository]);
  }
} finally { await rm(directory, { recursive: true, force: true }); }
