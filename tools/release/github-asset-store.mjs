import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function githubAssetRemote({ repository, version, run = runGh }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !version) throw new Error('GitHub checkpoint repository and version required');
  const prefix = `verjson-release-state-${version}-`;
  return {
    async load() {
      const assets = JSON.parse(await run(['release', 'view', version, '--repo', repository, '--json', 'assets', '--jq', '.assets']));
      const generations = assets.map(({ name }) => parseGeneration(name, prefix)).filter(Number.isInteger).sort((a, b) => a - b);
      if (!generations.length) return undefined;
      for (let index = 0; index < generations.length; index += 1) if (generations[index] !== index + 1) throw new Error('GitHub release checkpoint generation gap');
      const generation = generations.at(-1); const name = assetName(prefix, generation); const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-state-'));
      try {
        await run(['release', 'download', version, '--repo', repository, '--pattern', name, '--dir', directory]);
        const snapshot = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
        if (snapshot.generation !== generation || !snapshot.files || typeof snapshot.files !== 'object') throw new Error('GitHub release checkpoint content invalid');
        return snapshot;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
    async create(expectedGeneration, files) {
      const current = await this.load();
      if ((current?.generation ?? 0) !== expectedGeneration) throw new Error('GitHub release checkpoint CAS conflict');
      const generation = expectedGeneration + 1; const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-state-'));
      try {
        const target = path.join(directory, assetName(prefix, generation));
        await writeFile(target, `${JSON.stringify({ generation, files })}\n`, { flag: 'wx', mode: 0o600 });
        await run(['release', 'upload', version, target, '--repo', repository]);
        return generation;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };
}

function assetName(prefix, generation) { return `${prefix}${String(generation).padStart(8, '0')}.json`; }
function parseGeneration(name, prefix) { const match = name.match(new RegExp(`^${escapeRegExp(prefix)}([0-9]{8})\\.json$`)); return match ? Number(match[1]) : undefined; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function runGh(args) { const { stdout } = await execFileAsync('gh', args, { env: process.env }); return stdout; }
