#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SEMVER_TAG = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

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
  assertSafeRemote(source, 'source');
  assertSafeRemote(destination, 'destination');
  const sourceTags = parseTags(await run(['ls-remote', '--tags', '--', source]));
  const destinationTags = parseTags(await run(['ls-remote', '--tags', '--', destination]));
  const plan = planSync(sourceTags, destinationTags);
  if (dryRun || plan.length === 0) return plan;

  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-mirror-'));
  try {
    await run(['init', '--bare', directory]);
    for (const { tag, oid } of plan) {
      const ref = `refs/tags/${tag}`;
      await run(['-C', directory, 'fetch', '--no-tags', source, `${ref}:${ref}`]);
      const fetchedOid = (await run(['-C', directory, 'rev-parse', '--verify', ref])).trim();
      if (fetchedOid !== oid) {
        throw new Error(`source tag ${tag} changed during synchronization; refusing to push`);
      }
    }
    await run([
      '-C',
      directory,
      'push',
      '--atomic',
      '--',
      destination,
      ...plan.map(({ tag }) => `refs/tags/${tag}:refs/tags/${tag}`),
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return plan;
}

function assertSafeRemote(remote, role) {
  if (!remote || /[\s\u0000-\u001f\u007f]/u.test(remote) || remote.includes('\\')) {
    throw new Error(`${role} remote must be a canonical HTTPS or SSH URL without whitespace or control characters`);
  }

  let parsed;
  try {
    parsed = new URL(remote);
  } catch {
    throw new Error(`${role} remote must be a canonical HTTPS or SSH URL`);
  }

  if (!parsed.hostname || parsed.pathname === '/' || parsed.search || parsed.hash) {
    throw new Error(`${role} remote must identify a repository without query parameters or fragments`);
  }
  if (parsed.protocol === 'https:') {
    if (parsed.username || parsed.password) throw new Error(`${role} remote must not contain credentials`);
    return;
  }
  if (parsed.protocol === 'ssh:') {
    const authority = remote.slice('ssh://'.length, remote.indexOf('/', 'ssh://'.length));
    if (parsed.username !== 'git' || parsed.password || !authority.startsWith('git@') || authority.includes('%')) {
      throw new Error(`${role} SSH remote must use the literal git user and must not contain credentials`);
    }
    return;
  }
  throw new Error(`${role} remote protocol must be HTTPS or SSH`);
}

async function runGit(args) {
  const env = { ...process.env, GIT_ALLOW_PROTOCOL: 'https:ssh', GIT_CONFIG_NOSYSTEM: '1' };
  for (const name of Object.keys(env)) {
    if (/^GIT_CONFIG_(?:COUNT|KEY_\d+|PARAMETERS|VALUE_\d+)$/.test(name)) delete env[name];
  }
  const { stdout } = await execFileAsync(
    'git',
    [
      '-c',
      'protocol.allow=never',
      '-c',
      'protocol.ext.allow=never',
      '-c',
      'protocol.file.allow=never',
      '-c',
      'protocol.https.allow=always',
      '-c',
      'protocol.ssh.allow=always',
      ...args,
    ],
    { env },
  );
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
