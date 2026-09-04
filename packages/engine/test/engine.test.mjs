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

test('includes ShadScan threshold semantics in the provider-neutral result', async () => {
  const result = await executeContract({
    schema: 1,
    commands: { test: 'true' },
    checks: { shadscan: { mode: 'auto', version: '0.17.0', 'fail-under': 80, baseline: 85 } },
  }, {
    stdio: 'ignore',
    shadscan: {
      files: { access: async () => {}, readFile: async () => JSON.stringify({ dependencies: { react: '19' } }) },
      run: async () => ({ code: 0, stdout: JSON.stringify({ schemaVersion: 1, coverage: { source: 'complete' }, score: 90, findings: [] }), stderr: '' }),
    },
  });

  assert.equal(result.outcome, 'success');
  assert.deepEqual(result.capabilities.shadscan, {
    applicable: true,
    outcome: 'success',
    reason: undefined,
    version: '0.17.0',
    reportSchema: 1,
    score: 90,
    findings: 0,
    threshold: 85,
  });
});

test('projects compliance semantics and required-mode failure from existing outcomes', async () => {
  let artifact;
  const result = await executeContract({
    schema: 1,
    commands: { test: 'false' },
    checks: {
      compliance: {
        frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }],
        mode: 'required',
      },
    },
  }, { stdio: 'ignore', writeComplianceArtifact: async (bytes) => { artifact = bytes; } });

  assert.equal(result.outcome, 'failure');
  assert.match(result.capabilities.compliance.artifactDigest, /^sha256:/);
  assert.equal(result.capabilities.compliance.controls[0].status, 'unsatisfied');
  assert.equal(typeof artifact, 'string');
});

test('refuses to report compliant controls when no evidence artifact can be written', async () => {
  await assert.rejects(() => executeContract({
    schema: 1,
    commands: { test: 'true' },
    checks: { compliance: { frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }], mode: 'report' } },
  }, { stdio: 'ignore' }), /artifact writer is required/);
});
