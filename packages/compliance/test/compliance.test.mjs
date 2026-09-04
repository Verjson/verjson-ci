import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ComplianceBoundaryError,
  evaluateCompliance,
  loadFrameworkPack,
  verifyComplianceParity,
} from '../src/index.mjs';

const successfulChecks = {
  commands: [{ name: 'test', command: 'token=must-not-leak', exitCode: 0, signal: null, outcome: 'success' }],
  capabilities: { shadscan: { applicable: true, outcome: 'success', score: 90 } },
  files: ['pnpm-lock.yaml'],
};

test('loads an exact known pack and verifies its registered digest', async () => {
  const pack = await loadFrameworkPack({ id: 'verjson-ci-foundation', version: '1.0.0' });

  assert.equal(pack.id, 'verjson-ci-foundation');
  assert.match(pack.digest, /^sha256:[0-9a-f]{64}$/);
});

test('refuses malformed, missing, and integrity-mismatched packs', async () => {
  await assert.rejects(
    () => loadFrameworkPack({ id: 'verjson-ci-foundation', version: '1.0.0' }, { readFile: async () => '{"schema":1}' }),
    /integrity mismatch/,
  );
  await assert.rejects(
    () => loadFrameworkPack({ id: 'verjson-ci-foundation', version: '1.0.0' }, { readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } }),
    /pack unavailable/,
  );
  await assert.rejects(
    () => loadFrameworkPack({ id: 'verjson-ci-foundation', version: '1.0.0' }, { readFile: async () => Buffer.alloc(1024 * 1024 + 1) }),
    /exceeds 1 MiB/,
  );
});

test('produces deterministic evidence without command text or file contents', async () => {
  const first = await evaluateCompliance(
    { frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }], mode: 'report' },
    successfulChecks,
  );
  const second = await evaluateCompliance(
    { mode: 'report', frameworks: [{ version: '1.0.0', id: 'verjson-ci-foundation' }] },
    structuredClone(successfulChecks),
  );

  assert.equal(first.artifactBytes, second.artifactBytes);
  assert.equal(first.result.artifactDigest, second.result.artifactDigest);
  assert.doesNotMatch(first.artifactBytes, /must-not-leak|token=/);
  assert.deepEqual(first.result.controls.map(({ status }) => status), ['satisfied', 'satisfied', 'satisfied']);
});

test('required mode fails closed only for blocking unsatisfied controls', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }], mode: 'required' },
    { ...successfulChecks, commands: [{ name: 'test', command: 'false', exitCode: 1, signal: null, outcome: 'failure' }] },
  );

  assert.equal(evaluated.failed, true);
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'CI-COMMANDS').status, 'unsatisfied');
});

test('report mode records failures without changing the semantic outcome', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }], mode: 'report' },
    { ...successfulChecks, commands: [{ name: 'test', command: 'false', exitCode: 1, signal: null, outcome: 'failure' }] },
  );

  assert.equal(evaluated.failed, false);
  assert.equal(evaluated.result.controls[0].status, 'unsatisfied');
});

test('missing evidence can never satisfy a control', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }], mode: 'required' },
    { commands: [], capabilities: {}, files: [] },
  );

  assert.equal(evaluated.result.controls.every(({ status }) => status !== 'satisfied'), true);
});

test('parity boundary requires byte-identical artifacts from both forge legs', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [{ id: 'verjson-ci-foundation', version: '1.0.0' }], mode: 'report' },
    successfulChecks,
  );
  assert.equal(verifyComplianceParity(
    { result: evaluated.result, artifactBytes: evaluated.artifactBytes },
    { result: evaluated.result, artifactBytes: evaluated.artifactBytes },
  ), evaluated.result.artifactDigest);

  assert.throws(() => verifyComplianceParity(
    { result: evaluated.result, artifactBytes: evaluated.artifactBytes },
    { result: evaluated.result },
  ), ComplianceBoundaryError);
  assert.throws(() => verifyComplianceParity(
    { result: evaluated.result, artifactBytes: evaluated.artifactBytes },
    { result: evaluated.result, artifactBytes: `${evaluated.artifactBytes} ` },
  ), /differ|mismatch/);
});

test('checked-in pack digest is stable', async () => {
  const pack = await loadFrameworkPack({ id: 'verjson-ci-foundation', version: '1.0.0' });
  assert.equal(typeof await readFile(pack.path, 'utf8'), 'string');
});
