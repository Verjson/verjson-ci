import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function githubAssetRemote({ repository, version, commit, signer, run = runGh, crashHook = async () => {} }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !version || !/^[0-9a-f]{40}$/.test(commit || '') || !signer) throw new Error('GitHub checkpoint repository, version, commit, and signer required');
  const assetPrefix = `verjson-release-state-${version}-`; const markerPrefix = `verjson-release-state-committed-${version}-`; const anchorPrefix = `verjson-release-state-anchor-${version}-`;
  const api = (suffix) => `repos/${repository}/${suffix}`;

  const remote = {
    async load() {
      const assets = JSON.parse(await run(['release', 'view', version, '--repo', repository, '--json', 'assets', '--jq', '.assets']));
      const assetGenerations = generations(assets.map(({ name }) => parseGeneration(name, assetPrefix)).filter(Number.isInteger), 'asset');
      const markerGenerations = generations(assets.map(({ name }) => parseGeneration(name, markerPrefix)).filter(Number.isInteger), 'commit marker');
      const refs = JSON.parse(await run(['api', '--paginate', '--slurp', '--jq', 'add', api(`git/matching-refs/tags/${anchorPrefix}`)]));
      const anchorGenerations = generations(refs.map(({ ref }) => parseGeneration(ref.replace('refs/tags/', ''), anchorPrefix, '')), 'anchor');
      if (!assetGenerations.length && !anchorGenerations.length && !markerGenerations.length) return undefined;
      const recoverAnchor = assetGenerations.length === anchorGenerations.length + 1
        && assetGenerations.at(-1) === anchorGenerations.length + 1
        && assetGenerations.slice(0, -1).join() === anchorGenerations.join()
        && markerGenerations.join() === anchorGenerations.join();
      const recoverMarker = assetGenerations.join() === anchorGenerations.join()
        && assetGenerations.length === markerGenerations.length + 1
        && assetGenerations.slice(0, -1).join() === markerGenerations.join();
      const complete = assetGenerations.join() === anchorGenerations.join() && assetGenerations.join() === markerGenerations.join();
      if (!complete && !recoverAnchor && !recoverMarker) throw new Error('GitHub release checkpoint assets disagree with immutable anchor set');

      const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-state-')); let previous = null; let latest;
      try {
        for (const generation of assetGenerations) {
          const name = assetName(assetPrefix, generation); await run(['release', 'download', version, '--repo', repository, '--pattern', name, '--dir', directory]);
          const snapshot = JSON.parse(await readFile(path.join(directory, name), 'utf8')); const { signature, digest, ...unsigned } = snapshot;
          if (snapshot.generation !== generation || snapshot.previous !== previous || !snapshot.files || typeof snapshot.files !== 'object' || digest !== snapshotDigest(unsigned)) throw new Error('GitHub release checkpoint content invalid');
          await signer.verifyRecord({ ...unsigned, digest, signature });
          if (generation <= anchorGenerations.length) await verifyAnchor(generation, digest, refs);
          if (generation <= markerGenerations.length) await verifyMarker(generation, digest, directory);
          previous = digest; latest = snapshot;
        }
        if (recoverAnchor) await createAnchor(latest.generation, latest.digest);
        if (recoverAnchor || recoverMarker) await createMarker(latest.generation, latest.digest);
        return latest;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },

    async create(expectedGeneration, files) {
      const current = await remote.load();
      if ((current?.generation ?? 0) !== expectedGeneration) throw new Error('GitHub release checkpoint CAS conflict');
      const generation = expectedGeneration + 1; const unsigned = { generation, previous: current?.digest ?? null, files };
      const digest = snapshotDigest(unsigned); const snapshot = { ...unsigned, digest, signature: await signer.signRecord({ ...unsigned, digest }) };
      const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-state-'));
      try {
        const target = path.join(directory, assetName(assetPrefix, generation)); await writeFile(target, `${JSON.stringify(snapshot)}\n`, { flag: 'wx', mode: 0o600 });
        await run(['release', 'upload', version, target, '--repo', repository]); await crashHook('after-asset', { generation, digest });
        await createAnchor(generation, digest);
        await createMarker(generation, digest);
        return generation;
      } finally { await rm(directory, { recursive: true, force: true }); }
    },
  };

  async function createAnchor(generation, digest) {
    const name = anchorName(anchorPrefix, generation); let tagSha;
    try {
      tagSha = (await run(['api', '--method', 'POST', api('git/tags'), '-f', `tag=${name}`, '-f', `message=${digest}`, '-f', `object=${commit}`, '-f', 'type=commit', '--jq', '.sha'])).trim();
      await crashHook('after-tag-object', { generation, digest, tagSha });
      await run(['api', '--method', 'POST', api('git/refs'), '-f', `ref=refs/tags/${name}`, '-f', `sha=${tagSha}`]);
    } catch (error) {
      try { await verifyAnchor(generation, digest); return; } catch { throw error; }
    }
    await crashHook('after-ref', { generation, digest, tagSha });
    await verifyAnchor(generation, digest);
  }

  async function verifyAnchor(generation, digest, knownRefs) {
    const name = anchorName(anchorPrefix, generation); const ref = knownRefs?.find((candidate) => candidate.ref === `refs/tags/${name}`)
      ?? JSON.parse(await run(['api', api(`git/ref/tags/${name}`)]));
    const tag = JSON.parse(await run(['api', api(`git/tags/${ref.object.sha}`)]));
    if (tag.tag !== name || tag.message.trim() !== digest || tag.object?.type !== 'commit' || tag.object.sha !== commit) throw new Error('GitHub release checkpoint immutable anchor mismatch');
  }

  async function createMarker(generation, digest) {
    const unsigned = { generation, digest, state: 'committed' }; const marker = { ...unsigned, signature: await signer.signRecord(unsigned) };
    const directory = await mkdtemp(path.join(tmpdir(), 'verjson-github-marker-'));
    try {
      const target = path.join(directory, assetName(markerPrefix, generation)); await writeFile(target, `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 });
      try { await run(['release', 'upload', version, target, '--repo', repository]); }
      catch (error) { await unlink(target); try { await verifyMarker(generation, digest, directory); return; } catch { throw error; } }
    }
    finally { await rm(directory, { recursive: true, force: true }); }
    await crashHook('after-marker', { generation, digest });
  }

  async function verifyMarker(generation, digest, directory) {
    const name = assetName(markerPrefix, generation); await run(['release', 'download', version, '--repo', repository, '--pattern', name, '--dir', directory]);
    const marker = JSON.parse(await readFile(path.join(directory, name), 'utf8'));
    if (marker.generation !== generation || marker.digest !== digest || marker.state !== 'committed') throw new Error('GitHub release checkpoint commit marker mismatch');
    await signer.verifyRecord(marker);
  }

  return remote;
}

function generations(values, kind) {
  if (values.some((value) => !Number.isInteger(value))) throw new Error(`GitHub release checkpoint ${kind} name invalid`);
  const sorted = values.sort((a, b) => a - b);
  for (let index = 0; index < sorted.length; index += 1) if (sorted[index] !== index + 1) throw new Error('GitHub release checkpoint generation gap');
  return sorted;
}
function assetName(prefix, generation) { return `${prefix}${String(generation).padStart(8, '0')}.json`; }
function anchorName(prefix, generation) { return `${prefix}${String(generation).padStart(8, '0')}`; }
function parseGeneration(name, prefix, suffix = '\\.json') { const match = name.match(new RegExp(`^${escapeRegExp(prefix)}([0-9]{8})${suffix}$`)); return match ? Number(match[1]) : undefined; }
function snapshotDigest(snapshot) { return `sha256:${createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')}`; }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
async function runGh(args) { const { stdout } = await execFileAsync('gh', args, { env: process.env }); return stdout; }
