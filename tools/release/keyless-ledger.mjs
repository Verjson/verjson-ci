import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { canonicalBytes } from './manifest.mjs';
import { RELEASE_SIGNING_POLICY } from './cosign.mjs';

export function keylessLedgerSigner(run) {
  const identity = `sigstore:${RELEASE_SIGNING_POLICY.issuer}#${RELEASE_SIGNING_POLICY.identity}`;
  return {
    identity,
    async signRecord(record) {
      return withRecord(record, async (recordPath, bundlePath) => {
        await run(['sign-blob', '--yes', '--bundle', bundlePath, recordPath]);
        return (await readFile(bundlePath)).toString('base64');
      });
    },
    async verifyRecord(record) {
      const { signature, ...unsigned } = record;
      if (typeof signature !== 'string' || !signature) throw new Error('signed ledger record missing keyless bundle');
      await withRecord(unsigned, async (recordPath, bundlePath) => {
        await writeFile(bundlePath, Buffer.from(signature, 'base64'), { flag: 'wx', mode: 0o600 });
        await run(['verify-blob', '--bundle', bundlePath, '--certificate-identity', RELEASE_SIGNING_POLICY.identity, '--certificate-oidc-issuer', RELEASE_SIGNING_POLICY.issuer, recordPath]);
      });
    },
  };
}

async function withRecord(record, action) {
  const directory = await mkdtemp(path.join(tmpdir(), 'verjson-ledger-record-'));
  try {
    const recordPath = path.join(directory, 'record.json'); const bundlePath = path.join(directory, 'bundle.json');
    await writeFile(recordPath, canonicalBytes(record), { flag: 'wx', mode: 0o600 });
    return await action(recordPath, bundlePath);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
