import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ContractValidationError, loadContract } from '../src/index.mjs';

test('loads a valid portable contract', async () => {
  const path = await fixture(`schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: pnpm test\n`);

  const contract = await loadContract(path);

  assert.equal(contract.commands.test, 'pnpm test');
});

test('rejects unknown configuration at the boundary', async () => {
  const path = await fixture(`schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: pnpm test\nunknown: true\n`);

  await assert.rejects(() => loadContract(path), ContractValidationError);
});

test('accepts a pinned ShadScan baseline ratchet', async () => {
  const path = await fixture(`schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: pnpm test\nchecks:\n  shadscan:\n    mode: auto\n    version: 0.17.0\n    fail-under: 70\n    baseline: 82\n`);

  const contract = await loadContract(path);

  assert.equal(contract.checks.shadscan.baseline, 82);
});

test('rejects a ShadScan version outside the unified pin', async () => {
  const path = await fixture(`schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: pnpm test\nchecks:\n  shadscan:\n    mode: auto\n    version: 0.17.1\n    fail-under: 70\n`);

  await assert.rejects(() => loadContract(path), ContractValidationError);
});

test('accepts a pinned framework-neutral compliance contract', async () => {
  const path = await fixture(`schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: pnpm test\nchecks:\n  compliance:\n    frameworks:\n      - id: verjson-ci-foundation\n        version: 1.0.0\n    mode: required\n    baseline: 100\n`);

  const contract = await loadContract(path);

  assert.equal(contract.checks.compliance.frameworks[0].version, '1.0.0');
});

test('rejects unknown frameworks, floating versions, and unknown compliance modes', async () => {
  for (const compliance of [
    'frameworks: [{ id: unknown, version: 1.0.0 }]\n    mode: report',
    'frameworks: [{ id: verjson-ci-foundation, version: latest }]\n    mode: report',
    'frameworks: [{ id: verjson-ci-foundation, version: 1.0.0 }]\n    mode: warn',
  ]) {
    const path = await fixture(`schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: pnpm test\nchecks:\n  compliance:\n    ${compliance}\n`);
    await assert.rejects(() => loadContract(path), ContractValidationError);
  }
});

async function fixture(contents) {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-schema-'));
  const path = join(directory, 'verjson-ci.yml');
  await writeFile(path, contents);
  return path;
}
