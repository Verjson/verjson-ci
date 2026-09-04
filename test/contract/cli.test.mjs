import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const cli = resolve('packages/cli/bin/verjson-ci.mjs');

test('CLI emits the normalized successful result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-cli-'));
  const output = join(directory, 'result.json');

  await execFileAsync(process.execPath, [cli, 'run', '--config', resolve('test/fixtures/success/verjson-ci.yml'), '--output', output]);

  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.outcome, 'success');
  assert.equal(result.resultSchema, 1);
});

test('CLI returns one for a command failure and still writes its result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-cli-'));
  const output = join(directory, 'result.json');

  await assert.rejects(
    () => execFileAsync(process.execPath, [cli, 'run', '--config', resolve('test/fixtures/failure/verjson-ci.yml'), '--output', output]),
    ({ code }) => code === 1,
  );

  const result = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(result.outcome, 'failure');
});

test('CLI writes deterministic compliance evidence beside the result', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-cli-'));
  const output = join(directory, 'result.json');
  const config = join(directory, 'verjson-ci.yml');
  await writeFile(config, `schema: 1\nstack: node\nruntime:\n  node: '24'\n  package-manager: pnpm\ncommands:\n  test: 'true'\nchecks:\n  compliance:\n    frameworks:\n      - id: verjson-ci-foundation\n        version: 1.0.0\n    mode: report\n`);

  await execFileAsync(process.execPath, [cli, 'run', '--config', config, '--output', output, '--cwd', directory]);

  const result = JSON.parse(await readFile(output, 'utf8'));
  const evidence = await readFile(join(directory, 'compliance-evidence.json'), 'utf8');
  assert.equal(result.capabilities.compliance.artifactDigest, `sha256:${createHash('sha256').update(evidence).digest('hex')}`);
});

test('CLI projects every CAIQ item into its result and evidence artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-cli-caiq-'));
  const output = join(directory, 'result.json');
  const fixture = resolve('test/fixtures/compliance-caiq-success');

  await execFileAsync(process.execPath, [cli, 'run', '--config', join(fixture, 'verjson-ci.yml'), '--output', output, '--cwd', fixture]);

  const result = JSON.parse(await readFile(output, 'utf8'));
  const evidence = JSON.parse(await readFile(join(directory, 'compliance-evidence.json'), 'utf8'));
  assert.equal(result.capabilities.compliance.items.length, 261);
  assert.equal(new Set(result.capabilities.compliance.items.map(({ id }) => id)).size, 261);
  assert.equal(result.capabilities.compliance.frameworks[0].itemCoverage.total, 261);
  assert.equal(evidence.schema, 2);
  assert.equal(evidence.frameworks[0].items.length, 261);
  assert.equal(new Set(evidence.frameworks[0].items.map(({ id }) => id)).size, 261);
});
