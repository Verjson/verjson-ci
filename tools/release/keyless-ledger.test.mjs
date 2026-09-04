import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { keylessLedgerSigner } from './keyless-ledger.mjs';
import { RELEASE_SIGNING_POLICY } from './cosign.mjs';

test('uses exact release workflow identity for restart-stable keyless ledger bundles', async () => {
  const calls = []; const run = async (args) => {
    calls.push(args);
    if (args[0] === 'sign-blob') await writeFile(args[args.indexOf('--bundle') + 1], '{"bundle":true}');
    else assert.equal((await readFile(args[args.indexOf('--bundle') + 1], 'utf8')), '{"bundle":true}');
  };
  const first = keylessLedgerSigner(run); const signature = await first.signRecord({ sequence: 1 });
  await keylessLedgerSigner(run).verifyRecord({ sequence: 1, signature });
  assert.equal(first.identity, `sigstore:${RELEASE_SIGNING_POLICY.issuer}#${RELEASE_SIGNING_POLICY.identity}`);
  assert.deepEqual(calls[1].slice(3, 7), ['--certificate-identity', RELEASE_SIGNING_POLICY.identity, '--certificate-oidc-issuer', RELEASE_SIGNING_POLICY.issuer]);
});
