import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function githubAssetRemote({ repository, version, commit, run = runGh }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !version || !/^[0-9a-f]{40}$/.test(commit || '')) throw new Error('GitHub checkpoint repository, version, and commit required');
  const prefix = `verjson-release-state-${version}-`;
  const anchorPrefix = `verjson-release-state-anchor-${version}-`;
  return {
    async load() {
      const assets = JSON.parse(await run(['release', 'view', version, '--repo', repository, '--json', 'assets', '--jq', '.assets']));
      const generations = assets.map(({ name }) => parseGeneration(name, prefix)).filter(Number.isInteger).sort((a, b) => a - b);
      const refs = JSON.parse(await run(['api', '--paginate', '--slurp', '--jq', 'add', `repos/${repository}/git/matching-refs/tags/${anchorPrefix}`]));
      const anchorGenerations = refs.map(({ ref }) => parseGeneration(ref.replace('refs/tags/', ''), anchorPrefix, ''));
      if (anchorGenerations.some((generation) => !Number.isInteger(generation))) throw new Error('GitHub release checkpoint anchor name invalid');
      anchorGenerations.sort((a, b) => a - b);
      if (!generations.length && !anchorGenerations.length) return undefined;
      if (generations.join() !== anchorGenerations.join()) throw new Error('GitHub release checkpoint assets disagree with immutable anchor set');
      for (let index = 0; index < generations.length; index += 1) if (generations[index] !== index + 1) throw new Error('GitHub release checkpoint generation gap');
      let previous = null; let latest;
      const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-state-'));
      try {
        for (const generation of generations) {
          const name = assetName(prefix, generation); await run(['release', 'download', version, '--repo', repository, '--pattern', name, '--dir', directory]);
          const snapshot = JSON.parse(await readFile(path.join(directory, name), 'utf8')); const { digest, ...unsigned } = snapshot;
          if (snapshot.generation !== generation || snapshot.previous !== previous || !snapshot.files || typeof snapshot.files !== 'object' || digest !== snapshotDigest(unsigned)) throw new Error('GitHub release checkpoint content invalid');
          const ref = refs.find((candidate) => candidate.ref === `refs/tags/${anchorName(anchorPrefix, generation)}`);
          const tag = JSON.parse(await run(['api', `repos/${repository}/git/tags/${ref.object.sha}`]));
          if (tag.tag !== anchorName(anchorPrefix, generation) || tag.message.trim() !== digest || tag.object?.type !== 'commit' || tag.object.sha !== commit) throw new Error('GitHub release checkpoint immutable anchor mismatch');
          previous = digest; latest = snapshot;
        }
        return latest;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async create(expectedGeneration, files) {
      const current = await this.load();
      if ((current?.generation ?? 0) !== expectedGeneration) throw new Error('GitHub release checkpoint CAS conflict');
      const generation = expectedGeneration + 1; const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-state-'));
      try {
        const target = path.join(directory, assetName(prefix, generation));
        const unsigned = { generation, previous: current?.digest ?? null, files }; const snapshot = { ...unsigned, digest: snapshotDigest(unsigned) };
        await writeFile(target, `${JSON.stringify(snapshot)}\n`, { flag: 'wx', mode: 0o600 });
        await run(['release', 'upload', version, target, '--repo', repository]);
        const name = anchorName(anchorPrefix, generation);
        const tagSha = (await run(['api', '--method', 'POST', `repos/${repository}/git/tags`, '-f', `tag=${name}`, '-f', `message=${snapshot.digest}`, '-f', `object=${commit}`, '-f', 'type=commit', '--jq', '.sha'])).trim();
        await run(['api', '--method', 'POST', `repos/${repository}/git/refs`, '-f', `ref=refs/tags/${name}`, '-f', `sha=${tagSha}`]);
        return generation;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

function assetName(prefix, generation) { return `${prefix}${String(generation).padStart(8, '0')}.json`; }
function anchorName(prefix, generation) { return `${prefix}${String(generation).padStart(8, '0')}`; }
function parseGeneration(name, prefix, suffix = '\\.json') { const match = name.match(new RegExp(`^${escapeRegExp(prefix)}([0-9]{8})${suffix}$`)); return match ? Number(match[1]) : undefined; }
function snapshotDigest(snapshot) { return `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function runGh(args) { const { stdout } = await execFileAsync('gh', args, { env: process.env }); return stdout; }
