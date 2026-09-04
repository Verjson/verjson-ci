import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileReleaseStore } from './file-store.mjs';

export class DurableReleaseStore {
  constructor(root, { remote, crashHook = async () => {} }) {
    if (!remote) throw new Error('durable release remote is required');
    this.root = root;
    this.remote = remote;
    this.crashHook = crashHook;
    this.ledgerRoot = path.join(root, 'ledger');
    this.checkpointRoot = path.join(root, 'anchors');
  }

  async reserve(version, commit, signerIdentity) {
    await this.#restore();
    const before = await this.#generation();
    const release = await this.#local().reserve(version, commit, signerIdentity);
    if (release !== 'conflict' && before === 0 && release.transitions.length === 0) await this.#persist(before);
    return release;
  }

  async append(release, transition) {
    const generation = await this.#generation();
    const next = await this.#local().append(release, transition);
    if (next === 'conflict') return next;
    await this.crashHook('before-remote-commit', { generation, transition });
    await this.#persist(generation);
    return next;
  }

  async recover(release) {
    const generation = await this.#generation();
    const recovered = await this.#local().recover(release);
    await this.#persist(generation);
    return recovered;
  }

  #local() { return new FileReleaseStore(this.ledgerRoot, { checkpointRoot: this.checkpointRoot }); }
  async #generation() { return (await this.remote.load())?.generation ?? 0; }

  async #restore() {
    const snapshot = await this.remote.load();
    await rm(this.root, { recursive: true, force: true });
    await mkdir(this.root, { recursive: true });
    if (!snapshot) return;
    for (const [relative, bytes] of Object.entries(snapshot.files)) {
      if (!/^(ledger|anchors)\/[A-Za-z0-9._/-]+$/.test(relative) || relative.includes('..')) throw new Error('durable release snapshot path invalid');
      const target = path.join(this.root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(bytes, 'base64'), { flag: 'wx', mode: 0o600 });
    }
  }

  async #persist(expectedGeneration) {
    const files = {};
    for (const base of ['ledger', 'anchors']) await collect(path.join(this.root, base), base, files);
    const committed = await this.remote.create(expectedGeneration, files);
    if (committed !== expectedGeneration + 1) throw new Error('durable release snapshot CAS conflict');
  }
}

async function collect(directory, relative, files) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = path.join(directory, entry.name); const name = `${relative}/${entry.name}`;
    if (entry.isDirectory()) await collect(child, name, files);
    else if (entry.isFile()) files[name] = (await readFile(child)).toString('base64');
    else throw new Error('durable release snapshot contains unsupported entry');
  }
}
