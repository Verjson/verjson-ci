import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export class FileReleaseStore {
  constructor(root) { this.root = root; }
  async reserve(version, commit) {
    const directory = path.join(this.root, version); await mkdir(directory, { recursive: true });
    const reservationPath = path.join(directory, 'reservation.json');
    try { const file = await open(reservationPath, 'wx'); await file.writeFile(`${JSON.stringify({ version, commit })}\n`); await file.sync(); await file.close(); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const reservation = JSON.parse(await readFile(reservationPath, 'utf8'));
    if (reservation.version !== version || reservation.commit !== commit) return 'conflict';
    return this.#load(directory, reservation);
  }
  async append(release, transition) {
    const directory = path.join(this.root, release.version);
    const current = await this.#load(directory, { version: release.version, commit: release.commit });
    if (current.transitions.length !== release.transitions.length) return 'conflict';
    const target = path.join(directory, `${String(transition.sequence).padStart(8, '0')}.json`);
    try { const file = await open(target, 'wx'); await file.writeFile(`${JSON.stringify(transition)}\n`); await file.sync(); await file.close(); }
    catch (error) { if (error.code === 'EEXIST') return 'conflict'; throw error; }
    return { ...release, transitions: [...release.transitions, transition] };
  }
  async #load(directory, reservation) {
    const names = (await readdir(directory)).filter((name) => /^\d{8}\.json$/.test(name)).sort(); const transitions = [];
    for (const name of names) transitions.push(JSON.parse(await readFile(path.join(directory, name), 'utf8')));
    return { ...reservation, transitions };
  }
}
