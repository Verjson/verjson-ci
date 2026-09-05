#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?$/;

export function validateSnapshotDispatch(event) {
  if (event?.inputs?.prefix !== 'snapshot-v' || !event.inputs.version?.startsWith('snapshot-v') || !SEMVER.test(event.inputs.version.slice(10))) {
    throw new Error('canonical snapshots require prefix snapshot-v and version snapshot-v<SemVer>');
  }
}

export async function verifySnapshot(version, commit, git = runGit) {
  if (!SEMVER.test(version) || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('invalid public release identity');
  const tag = `refs/tags/snapshot-v${version}`;
  if ((await git(['cat-file', '-t', tag])).trim() !== 'tag') throw new Error('snapshot requires an annotated canonical tag');
  if ((await git(['rev-parse', '--verify', `${tag}^{commit}`])).trim() !== commit) throw new Error('snapshot tag differs from publication commit');
  const notes = await git(['show', `${commit}:CHANGELOG/snapshot-v${version}.md`]);
  if (!notes.trim()) throw new Error('snapshot release notes are empty');
}

async function runGit(args) {
  return (await execFileAsync('git', args, { encoding: 'utf8' })).stdout;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [command, version, commit] = process.argv.slice(2);
    if (command === 'dispatch') validateSnapshotDispatch(JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')));
    else if (command === 'candidate') await verifySnapshot(version, commit);
    else throw new Error('usage: snapshot.mjs dispatch|candidate [VERSION COMMIT]');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
