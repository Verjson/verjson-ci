import { readFile } from 'node:fs/promises';
import { FileReleaseStore } from '../../src/file-store.mjs';

const [root, checkpointRoot, version, commit, signerIdentity, transitionPath, boundary] = process.argv.slice(2);
const store = new FileReleaseStore(root, { checkpointRoot, crashHook: async (point) => { if (point === boundary) process.exit(91); } });
const release = await store.reserve(version, commit, signerIdentity);
await store.append(release, JSON.parse(await readFile(transitionPath, 'utf8')));
