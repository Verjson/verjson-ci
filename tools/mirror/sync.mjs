#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SEMVER_TAG = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function parseTags(output) {
  const tags = new Map();
  for (const line of output.trim().split('\n')) {
    if (!line) continue;
    const [oid, ref] = line.split(/\s+/);
    const name = ref?.replace('refs/tags/', '');
    if (name && !name.endsWith('^{}') && SEMVER_TAG.test(name)) tags.set(name, oid);
  }
  return tags;
}

export function planSync(source, destination) {
  const plan = [];
  for (const [tag, oid] of source) {
    const existing = destination.get(tag);
    if (existing && existing !== oid) throw new Error(`destination tag ${tag} is immutable and differs from source`);
    if (!existing) plan.push({ tag, oid });
  }
  return plan.sort((left, right) => left.tag.localeCompare(right.tag, 'en', { numeric: true }));
}

export async function syncMirrors({ source, destination, dryRun = false }, run = runGit) {
  assertCredentialSafeRemote(source);
  assertCredentialSafeRemote(destination);
  const sourceTags = parseTags(await run(['ls-remote', '--tags', source]));
  const destinationTags = parseTags(await run(['ls-remote', '--tags', destination]));
  const plan = planSync(sourceTags, destinationTags);
  if (dryRun || plan.length === 0) return plan;

  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-mirror-'));
  try {
    await run(['init', '--bare', directory]);
    for (const { tag } of plan) {
      const ref = `refs/tags/${tag}`;
      await run(['-C', directory, 'fetch', '--no-tags', source, `${ref}:${ref}`]);
      await run(['-C', directory, 'push', destination, `${ref}:${ref}`]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return plan;
}

function assertCredentialSafeRemote(remote) {
  if (!remote || /:\/\/[^/]*@/.test(remote)) throw new Error('remote URLs must not contain credentials');
}

async function runGit(args) {
  const { stdout } = await execFileAsync('git', args, { env: process.env });
  return stdout;
}

function parseArgs(argv) {
  const options = { dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dry-run') options.dryRun = true;
    else if (argv[index] === '--source' || argv[index] === '--destination') options[argv[index].slice(2)] = argv[++index];
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  if (!options.source || !options.destination) throw new Error('usage: sync.mjs --source URL --destination URL [--dry-run]');
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = await syncMirrors(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ synchronized: plan.map(({ tag }) => tag) })}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
