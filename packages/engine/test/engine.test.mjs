import assert from 'node:assert/strict';
import test from 'node:test';

import { executeContract } from '../src/index.mjs';

test('executes commands in declared order', async () => {
  const result = await executeContract({ schema: 1, commands: { lint: 'true', test: 'true' } }, { stdio: 'ignore' });

  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.commands.map(({ name }) => name), ['lint', 'test']);
});

test('stops after the first failed command', async () => {
  const result = await executeContract({ schema: 1, commands: { lint: 'false', test: 'true' } }, { stdio: 'ignore' });

  assert.equal(result.outcome, 'failure');
  assert.deepEqual(result.commands.map(({ name }) => name), ['lint']);
});

test('classifies command timeout', async () => {
  const result = await executeContract({ schema: 1, commands: { test: 'sleep 1' } }, { stdio: 'ignore', timeoutMs: 10 });

  assert.equal(result.outcome, 'timeout');
});
