#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DurableReleaseStore } from '../../packages/release/src/durable-store.mjs';
import { ReleaseOrchestrator } from '../../packages/release/src/index.mjs';
import { verifyManifest, verifyReceiptEnvelope } from './cosign.mjs';
import { commandPublisher } from './command-publisher.mjs';
import { githubAssetRemote } from './github-asset-store.mjs';
import { keylessLedgerSigner } from './keyless-ledger.mjs';

const execFileAsync = promisify(execFile);

export async function runPublicRelease({ candidate, artifacts, verifiedReceipts, proof, plan, repository, workspace, runCosign = cosign }) {
  if (!proof?.manifest || !proof?.bundle) throw new Error('signed pre-public conformance proof required');
  await verifyManifest(proof, runCosign);
  const signer = keylessLedgerSigner(runCosign);
  const orchestrator = new ReleaseOrchestrator({
    license: { assertPublishable: () => { if (!existsSync('LICENSE')) throw new Error('issue #4 must select a license before public publication'); } },
    store: new DurableReleaseStore(path.join(workspace, 'state'), { remote: githubAssetRemote({ repository, version: `verjson-state-${candidate.version}`, commit: candidate.commit, signer }) }),
    builder: { buildOnce: async () => artifacts },
    conformance: { run: async () => verifiedReceipts },
    receiptVerifier: { verify: async (forge, receipt, expected) => {
      if (receipt?.bundle && receipt?.receipt) return verifyReceiptEnvelope(forge, receipt, expected, runCosign);
      if (receipt?.forge !== forge || receipt.commit !== expected.commit || receipt.imageDigest !== expected.imageDigest || receipt.requestId !== expected.requestId) throw new Error(`${forge} verified receipt identity differs`);
      return receipt;
    } },
    signer,
    publisher: commandPublisher(plan),
  });
  const manifest = await orchestrator.release({ ...candidate, dryRun: false });
  const target = path.join(workspace, 'manifest.complete.json'); await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return target;
}

async function cosign(args) { await execFileAsync(process.env.COSIGN_BIN || 'cosign', args, { env: process.env }); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [inputPath, workspace = '.release-public'] = process.argv.slice(2); if (!inputPath) throw new Error('usage: public-release.mjs INPUT.json [WORKSPACE]');
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const manifest = await runPublicRelease({ ...input, workspace }); process.stdout.write(`${manifest}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
