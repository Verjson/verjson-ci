import assert from 'node:assert/strict';
import test from 'node:test';
import { detectSupportedProject, executeShadscan, SHADSCAN_VERSION } from '../src/index.mjs';

const report = (score = 90) => JSON.stringify({ schemaVersion: 1, coverage: { source: 'complete' }, score, findings: [{ rule: 'example' }] });
const supportedFiles = { access: async () => {}, readFile: async () => JSON.stringify({ dependencies: { react: '19' } }) };

test('auto detection requires React and shadcn configuration', async () => {
  assert.equal(await detectSupportedProject('/project', supportedFiles), true);
  assert.equal(await detectSupportedProject('/project', { ...supportedFiles, access: async () => { throw new Error('missing'); } }), false);
});

test('auto mode reports unsupported projects without invoking ShadScan', async () => {
  const result = await executeShadscan('auto', { files: { ...supportedFiles, access: async () => { throw new Error('missing'); } }, run: async () => { throw new Error('must not run'); } });
  assert.deepEqual(result, { applicable: false, outcome: 'not-applicable', reason: 'unsupported-project' });
});

test('required mode fails when project is unsupported', async () => {
  const result = await executeShadscan({ mode: 'required', version: SHADSCAN_VERSION, 'fail-under': 80 }, { files: { ...supportedFiles, access: async () => { throw new Error('missing'); } } });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.reason, 'required-project-not-detected');
});

test('baseline ratchet raises the effective score floor', async () => {
  const result = await executeShadscan({ mode: 'auto', version: SHADSCAN_VERSION, 'fail-under': 70, baseline: 85 }, {
    files: supportedFiles,
    run: async ({ version, floor }) => {
      assert.equal(version, SHADSCAN_VERSION);
      assert.equal(floor, 85);
      return { code: 1, stdout: report(84), stderr: '' };
    },
  });
  assert.deepEqual({ outcome: result.outcome, score: result.score, threshold: result.threshold, findings: result.findings }, { outcome: 'failure', score: 84, threshold: 85, findings: 1 });
});

test('complete report passes at the effective floor', async () => {
  const result = await executeShadscan({ mode: 'auto', version: SHADSCAN_VERSION, 'fail-under': 80 }, { files: supportedFiles, run: async () => ({ code: 0, stdout: report(80), stderr: '' }) });
  assert.equal(result.outcome, 'success');
  assert.equal(result.reportSchema, 1);
});
