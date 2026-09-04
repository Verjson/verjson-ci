import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { objectDigest } from '../../../tools/release/manifest.mjs';

export class FileReleaseStore {
  constructor(root, { checkpointRoot, crashHook = async () => {} } = {}) {
    if (!checkpointRoot || path.resolve(checkpointRoot).startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error('independent checkpoint root is required');
    this.root = root; this.checkpointRoot = checkpointRoot; this.crashHook = crashHook;
  }

  async reserve(version, commit, signerIdentity) {
    const directory = path.join(this.root, version); const checkpoints = path.join(this.checkpointRoot, version);
    await mkdir(directory, { recursive: true }); await mkdir(checkpoints, { recursive: true });
    const reservationPath = path.join(directory, 'reservation.json');
    const nonce = randomUUID(); const anchor = objectDigest({ version, commit, signerIdentity, nonce });
    try {
      const file = await open(reservationPath, 'wx'); await file.writeFile(`${JSON.stringify({ version, commit, signerIdentity, nonce, anchor })}\n`); await file.sync(); await file.close();
      await writeFile(path.join(directory, 'head.json'), `${JSON.stringify({ sequence: 0, head: anchor })}\n`, { flag: 'wx' });
      await writeFile(path.join(checkpoints, '00000000.json'), `${JSON.stringify({ sequence: 0, head: anchor })}\n`, { flag: 'wx' });
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const reservation = JSON.parse(await readFile(reservationPath, 'utf8'));
    if (reservation.version !== version || reservation.commit !== commit || reservation.signerIdentity !== signerIdentity) return 'conflict';
    return this.#load(directory, checkpoints, reservation);
  }

  async append(release, transition) {
    const directory = path.join(this.root, release.version); const checkpoints = path.join(this.checkpointRoot, release.version);
    const reservation = JSON.parse(await readFile(path.join(directory, 'reservation.json'), 'utf8'));
    const current = await this.#load(directory, checkpoints, reservation);
    if (current.transitions.length !== release.transitions.length || current.recoveryNeeded) return 'conflict';
    const sequence = transition.sequence; const target = path.join(directory, `${String(sequence).padStart(8, '0')}.json`);
    try { const file = await open(target, 'wx'); await file.writeFile(`${JSON.stringify(transition)}\n`); await file.sync(); await file.close(); }
    catch (error) { if (error.code === 'EEXIST') return 'conflict'; throw error; }
    const head = objectDigest(transition);
    await this.crashHook('after-record', { sequence, head });
    await this.#writeHead(directory, sequence, head);
    await this.crashHook('after-head', { sequence, head });
    await writeFile(path.join(checkpoints, `${String(sequence).padStart(8, '0')}.json`), `${JSON.stringify({ sequence, head })}\n`, { flag: 'wx' });
    return { ...release, head, transitions: [...release.transitions, transition] };
  }

  async recover(release) {
    const directory = path.join(this.root, release.version); const checkpoints = path.join(this.checkpointRoot, release.version);
    const sequence = release.transitions.length; const head = objectDigest(release.transitions.at(-1));
    if (release.recoveryNeeded === 'head') await this.#writeHead(directory, sequence, head);
    if (release.recoveryNeeded) {
      try { await writeFile(path.join(checkpoints, `${String(sequence).padStart(8, '0')}.json`), `${JSON.stringify({ sequence, head })}\n`, { flag: 'wx' }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    return { ...release, head, recoveryNeeded: undefined };
  }

  async #writeHead(directory, sequence, head) {
    const temporary = path.join(directory, `head.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify({ sequence, head })}\n`, { flag: 'wx' });
    await rename(temporary, path.join(directory, 'head.json'));
  }

  async #load(directory, checkpoints, reservation) {
    const names = (await readdir(directory)).filter((name) => /^\d{8}\.json$/.test(name)).sort(); const transitions = [];
    for (const name of names) transitions.push(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
    const local = JSON.parse(await readFile(path.join(directory, 'head.json'), 'utf8'));
    const checkpointNames = (await readdir(checkpoints)).filter((name) => /^\d{8}\.json$/.test(name)).sort();
    const checkpoint = JSON.parse(await readFile(path.join(checkpoints, checkpointNames.at(-1)), 'utf8'));
    const sequence = transitions.length; const expected = sequence ? objectDigest(transitions.at(-1)) : reservation.anchor;
    const prior = sequence > 1 ? objectDigest(transitions.at(-2)) : reservation.anchor;
    let recoveryNeeded;
    if (local.sequence === sequence && local.head === expected && checkpoint.sequence === sequence && checkpoint.head === expected) recoveryNeeded = undefined;
    else if (sequence > 0 && local.sequence === sequence - 1 && local.head === prior && checkpoint.sequence === sequence - 1 && checkpoint.head === prior) recoveryNeeded = 'head';
    else if (local.sequence === sequence && local.head === expected && checkpoint.sequence === sequence - 1 && checkpoint.head === prior) recoveryNeeded = 'checkpoint';
    else throw new Error('release history disagrees with its independent monotonic checkpoint');
    return { ...reservation, head: expected, transitions, recoveryNeeded };
  }
}
