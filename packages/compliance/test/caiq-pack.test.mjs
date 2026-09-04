import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCompliance, loadFrameworkPack } from '../src/index.mjs';

const reference = { id: 'csa-star-l1-caiq', version: '4.0.13' };

test('CAIQ v4.0.13 pack binds the complete control and question identifier sets', async () => {
  const pack = await loadFrameworkPack(reference);

  assert.equal(pack.controls.length, 197);
  assert.equal(pack.questions.length, 261);
  assert.equal(new Set(pack.controls.map(({ id }) => id)).size, 197);
  assert.equal(new Set(pack.questions.map(({ id }) => id)).size, 261);
  assert.equal(pack.questions.every(({ controlId }) => pack.controls.some(({ id }) => id === controlId)), true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(Object.groupBy(pack.controls, ({ id }) => id.split('-')[0])).map(([domain, controls]) => [domain, controls.length])),
    { AIS: 7, 'A&A': 6, BCR: 11, CCC: 9, CEK: 21, DSP: 19, DCS: 15, GRC: 8, HRS: 13, IAM: 16, IVS: 9, IPY: 4, LOG: 13, SEF: 8, STA: 14, TVM: 10, UEM: 14 },
  );
  assert.deepEqual(pack.provenance, {
    owner: 'Cloud Security Alliance (CSA)',
    controlCatalogLicense: 'CC0-1.0',
    licenseUrl: 'https://github.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/blob/74ff4b828e60531d70a3d173784231f8a882a18c/LICENSE',
    controlCatalogUrl: 'https://raw.githubusercontent.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm/4.0.13/CSV/CCMv4.0.13_Generated-at_2024-10-31_ccm_normalized_stripped.json',
    controlCatalogSha256: 'ca79a31918e0d624895d1d154b9ea2717bcc78dfea0e61c7a8f288ebb48939cb',
    caiqUrl: 'https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4',
    caiqQuestionIdsRetrievedFrom: 'https://raw.githubusercontent.com/diegocconsolini/ClaudeSkillCollection/eab624582b720d273402cf741a44e200b6155686/docs/CCMv4.0.12%2BCAIQv4.0.3-JSON-Dataset_Generated-at_2024-06-03/CAIQ/primary-dataset.json',
    caiqQuestionIdsSha256: 'cfe598158924e127674fe3bc67f654df1f13db682d4723a3c68ac9f2990c57e5',
  });
});

test('CAIQ pack automates bounded CI evidence and leaves human controls explicit', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [reference], mode: 'report' },
    {
      commands: [{ name: 'test', exitCode: 0, signal: null, outcome: 'success' }],
      capabilities: { shadscan: { applicable: true, outcome: 'success' } },
      files: ['pnpm-lock.yaml'],
    },
  );

  assert.equal(evaluated.result.frameworks[0].coverage.total, 197);
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'CCC-02').status, 'satisfied');
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'AIS-05').status, 'satisfied');
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'STA-07').status, 'satisfied');
  assert.deepEqual(evaluated.result.controls.find(({ id }) => id === 'HRS-01').evidence, {
    kind: 'capability',
    ref: 'human-hr',
    status: 'not-automated',
    facts: { applicable: null, outcome: null },
  });
});

test('CAIQ required mode fails closed on a blocking quality-control regression', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [reference], mode: 'required' },
    { commands: [{ name: 'test', exitCode: 1, signal: null, outcome: 'failure' }], capabilities: {}, files: [] },
  );

  assert.equal(evaluated.failed, true);
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'CCC-02').status, 'unsatisfied');
});

test('rejects malformed CAIQ provenance and orphan question identifiers', async () => {
  const pack = await loadFrameworkPack(reference);
  const malformed = { ...pack, questions: [...pack.questions, { id: 'AIS-99.1', controlId: 'AIS-99' }] };
  delete malformed.digest;
  delete malformed.path;

  await assert.rejects(
    () => loadFrameworkPack(reference, { readFile: async () => JSON.stringify(malformed) }),
    /integrity mismatch|question/,
  );
});
