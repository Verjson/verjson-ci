import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { objectDigest } from '../../../tools/release/manifest.mjs';

export class FileReleaseStore {
  constructor(root) { this.root = root; }
  async reserve(version, commit, signerIdentity) {
    const directory = path.join(this.root, version); await mkdir(directory, { recursive: true });
    const reservationPath = path.join(directory, 'reservation.json');
    const nonce = randomUUID();
    const anchor = objectDigest({ version, commit, signerIdentity, nonce });
    try { const file = await open(reservationPath, 'wx'); await file.writeFile(`${JSON.stringify({ version, commit, signerIdentity, nonce, anchor })}\n`); await file.sync(); await file.close(); await writeFile(path.join(directory, 'head.json'), `${JSON.stringify({ head: anchor })}\n`, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const reservation = JSON.parse(await readFile(reservationPath, 'utf8'));
    if (reservation.version !== version || reservation.commit !== commit) return 'conflict';
    return this.#load(directory, reservation);
  }
  async append(release, transition) {
    const directory = path.join(this.root, release.version);
    const reservation = JSON.parse(await readFile(path.join(directory, 'reservation.json'), 'utf8'));
    const current = await this.#load(directory, reservation);
    if (current.transitions.length !== release.transitions.length) return 'conflict';
    const target = path.join(directory, `${String(transition.sequence).padStart(8, '0')}.json`);
    try { const file = await open(target, 'wx'); await file.writeFile(`${JSON.stringify(transition)}\n`); await file.sync(); await file.close(); }
    catch (error) { if (error.code === 'EEXIST') return 'conflict'; throw error; }
    const head = objectDigest(transition);
    const temporary = path.join(directory, `head.${process.pid}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify({ head })}\n`, { flag: 'wx' });
    await rename(temporary, path.join(directory, 'head.json'));
    try { await writeFile(path.join(directory, 'started'), '', { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    return { ...release, head, transitions: [...release.transitions, transition] };
  }
  async #load(directory, reservation) {
    const names = (await readdir(directory)).filter((name) => /^\d{8}\.json$/.test(name)).sort(); const transitions = [];
    for (const name of names) transitions.push(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
    let head;
    try { head = JSON.parse(await readFile(path.join(directory, 'head.json'), 'utf8')).head; }
    catch (error) { throw new Error('release ledger head is missing or invalid', { cause: error }); }
    const expected = transitions.length ? objectDigest(transitions.at(-1)) : reservation.anchor;
    if (head !== expected) throw new Error('release ledger suffix was truncated or head was rolled back');
    return { ...reservation, head, transitions };
  }
}
