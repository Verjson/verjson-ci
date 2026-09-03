import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
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
