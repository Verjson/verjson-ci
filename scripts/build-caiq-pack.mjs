#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONTROL_DIGEST = 'ca79a31918e0d624895d1d154b9ea2717bcc78dfea0e61c7a8f288ebb48939cb';
const QUESTION_DIGEST = 'cfe598158924e127674fe3bc67f654df1f13db682d4723a3c68ac9f2990c57e5';
const OUTPUT = resolve('packages/compliance/packs/csa-star-l1-caiq/4.0.13.json');
const LOCKFILES = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml'];

const [controlsPath, questionsPath] = process.argv.slice(2);
if (!controlsPath || !questionsPath) {
  throw new Error('usage: node scripts/build-caiq-pack.mjs CONTROL_CATALOG.json CAIQ_QUESTIONS.json');
}

const controlsBytes = await readPinned(controlsPath, CONTROL_DIGEST, 'CCM v4.0.13 control catalog');
const questionsBytes = await readPinned(questionsPath, QUESTION_DIGEST, 'CAIQ v4.0.3 question identifiers');
const sourceControls = JSON.parse(controlsBytes);
const sourceQuestions = JSON.parse(questionsBytes).questions;
if (!Array.isArray(sourceControls) || sourceControls.length !== 197 || !Array.isArray(sourceQuestions) || sourceQuestions.length !== 261) {
  throw new Error('unexpected CSA source counts');
}

const controls = sourceControls.map((entry) => {
  const id = entry['Control ID'];
  if (typeof id !== 'string') throw new Error('CSA control identifier missing');
  return { id, blocking: id === 'CCC-02', evidence: mappingFor(id) };
});
const controlIds = new Set(controls.map(({ id }) => id));
if (controlIds.size !== controls.length) throw new Error('duplicate CSA control identifier');

const questions = sourceQuestions.map(({ id, control_id: controlId }) => ({ id, controlId }));
if (new Set(questions.map(({ id }) => id)).size !== questions.length) throw new Error('duplicate CAIQ question identifier');
if (questions.some(({ controlId }) => !controlIds.has(controlId))) throw new Error('CAIQ question references an unknown CCM control');

const pack = {
  schema: 1,
  id: 'csa-star-l1-caiq',
  version: '4.0.13',
  provenance: {
    owner: 'Cloud Security Alliance (CSA)',
    controlCatalogLicense: 'CC0-1.0',
    licenseUrl: 'https://github.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/blob/74ff4b828e60531d70a3d173784231f8a882a18c/LICENSE',
    controlCatalogUrl: 'https://raw.githubusercontent.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm/4.0.13/CSV/CCMv4.0.13_Generated-at_2024-10-31_ccm_normalized_stripped.json',
    controlCatalogSha256: CONTROL_DIGEST,
    caiqUrl: 'https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4',
    caiqQuestionIdsRetrievedFrom: 'https://raw.githubusercontent.com/diegocconsolini/ClaudeSkillCollection/eab624582b720d273402cf741a44e200b6155686/docs/CCMv4.0.12%2BCAIQv4.0.3-JSON-Dataset_Generated-at_2024-06-03/CAIQ/primary-dataset.json',
    caiqQuestionIdsSha256: QUESTION_DIGEST,
  },
  controls,
  questions,
};

await writeFile(OUTPUT, `${JSON.stringify(pack)}\n`);

async function readPinned(path, expected, name) {
  const bytes = await readFile(resolve(path));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`${name} digest mismatch`);
  return bytes;
}

function mappingFor(id) {
  if (['AIS-04', 'CCC-02', 'STA-11'].includes(id)) return { kind: 'commands-all' };
  if (id === 'AIS-05') return { kind: 'capability', name: 'shadscan' };
  if (['STA-07', 'TVM-05'].includes(id)) return { kind: 'file-any', names: LOCKFILES };
  const capability = {
    'A&A-04': 'evidence-export',
    'CCC-04': 'protected-change',
    'CCC-09': 'immutable-tags',
    'CEK-09': 'artifact-signing',
    'IAM-14': 'oidc-identity',
    'LOG-02': 'signed-receipts',
    'STA-14': 'oci-digest',
  }[id];
  if (capability) return { kind: 'capability', name: capability };
  const domain = id.split('-')[0];
  const owner = {
    'A&A': 'human-audit', AIS: 'human-security', BCR: 'human-operations', CCC: 'human-engineering',
    CEK: 'human-security', DCS: 'human-operations', DSP: 'human-privacy', GRC: 'human-grc',
    HRS: 'human-hr', IAM: 'human-security', IPY: 'human-architecture', IVS: 'human-operations',
    LOG: 'human-security', SEF: 'human-security', STA: 'human-supply-chain', TVM: 'human-security', UEM: 'human-operations',
  }[domain];
  if (!owner) throw new Error(`unknown CCM domain: ${domain}`);
  return { kind: 'capability', name: owner };
}
