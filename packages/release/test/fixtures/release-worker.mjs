import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { FileReleaseStore } from '../../src/file-store.mjs';
import { ReleaseOrchestrator } from '../../src/index.mjs';
import { canonicalBytes, objectDigest, REQUIRED_ENDPOINT_IDS } from '../../../../tools/release/manifest.mjs';

const [root, mode] = process.argv.slice(2); const version = '1.2.3', commit = 'a'.repeat(40), imageDigest = `sha256:${'b'.repeat(64)}`, resultDigest = `sha256:${'c'.repeat(64)}`;
const endpointRoot = path.join(root, 'endpoints'); await mkdir(endpointRoot, { recursive: true });
const endpointDigests = Object.fromEntries(REQUIRED_ENDPOINT_IDS.map((id, index) => [id, `sha256:${String(index + 1).repeat(64)}`]));
const digest = (value) => createHash('sha256').update(canonicalBytes(value)).digest('hex');
const signer = { identity: 'stable-worker-signer', signRecord: async (record) => digest(record), verifyRecord: async (record) => { const { signature, ...unsigned } = record; if (signature !== digest(unsigned)) throw new Error('signature mismatch'); } };
const receipt = (forge) => ({ forge, requestId: 'worker-request', commit, imageDigest, resultDigest, verification: { issuer: `https://${forge}.invalid`, certificateIdentity: `${forge}-worker`, bundleDigest: `sha256:${'e'.repeat(64)}` } });
const orchestrator = new ReleaseOrchestrator({
  store: new FileReleaseStore(path.join(root, 'ledger'), { checkpointRoot: path.join(root, 'anchors') }),
  builder: { buildOnce: async () => ({ imageReference: 'localhost/worker', imageDigest, cli: { version, path: 'cli.tgz', sha256: 'd'.repeat(64) }, endpointDigests }) },
  conformance: { run: async () => ({ github: receipt('github'), gitlab: receipt('gitlab') }) }, receiptVerifier: { verify: async (forge) => receipt(forge) }, signer,
  publisher: { endpoints: async () => REQUIRED_ENDPOINT_IDS.map((id) => ({ id, digest: endpointDigests[id] })), readDigest: async ({ id }) => { try { return (await readFile(path.join(endpointRoot, id), 'utf8')).trim(); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } }, create: async ({ id, digest: expected }) => { await writeFile(path.join(endpointRoot, id), `${expected}\n`, { flag: 'wx' }); if (mode === 'crash' && id === 'cli') process.exit(92); } },
});
if (mode === 'mismatch') await writeFile(path.join(endpointRoot, 'cli'), `sha256:${'f'.repeat(64)}\n`);
const manifest = await orchestrator.release({ version, commit, requestId: 'worker-request', dryRun: true });
await writeFile(path.join(root, 'complete.json'), `${JSON.stringify({ state: manifest.state, digest: objectDigest(manifest) })}\n`);
