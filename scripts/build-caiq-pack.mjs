#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const CONTROL_DIGEST = 'ca79a31918e0d624895d1d154b9ea2717bcc78dfea0e61c7a8f288ebb48939cb';
const ITEM_DIGEST = '56b0f8b35e444ac3fa7fdb9ba83c4a0ed8b428cffd8a1324773538db807779ea';
const OUTPUT = resolve('packages/compliance/packs/csa-star-l1-caiq/4.0.13.json');
const [controlsPath, itemsPath] = process.argv.slice(2);
if (!controlsPath || !itemsPath) {
  throw new Error('usage: node scripts/build-caiq-pack.mjs CONTROL_CATALOG.json CAIQ_ITEMS.csv');
}

const controlsBytes = await readPinned(controlsPath, CONTROL_DIGEST, 'CCM v4.0.13 control catalog');
const itemsBytes = await readPinned(itemsPath, ITEM_DIGEST, 'CAIQ v4.0.3 item catalog');
const sourceControls = JSON.parse(controlsBytes);
const sourceItems = parseCsv(itemsBytes.toString('utf8'));
if (!Array.isArray(sourceControls) || sourceControls.length !== 197 || sourceItems.length !== 261) {
  throw new Error('unexpected CSA source counts');
}

const controls = sourceControls.map((entry) => {
  const id = entry['Control ID'];
  if (typeof id !== 'string') throw new Error('CSA control identifier missing');
  return { id, blocking: id === 'CCC-02', evidence: mappingFor(id) };
});
const controlIds = new Set(controls.map(({ id }) => id));
if (controlIds.size !== controls.length) throw new Error('duplicate CSA control identifier');

const items = sourceItems.map((row) => ({ id: row['CAIQ_Question ID'], controlId: row['Control ID'] }));
if (new Set(items.map(({ id }) => id)).size !== items.length) throw new Error('duplicate CAIQ item identifier');
if (items.some(({ id, controlId }) => typeof id !== 'string' || !controlIds.has(controlId))) throw new Error('CAIQ item references an unknown CCM control');

const pack = {
  schema: 1,
  id: 'csa-star-l1-caiq',
  version: '4.0.13',
  provenance: {
    owner: 'Cloud Security Alliance (CSA)',
    datasetLicense: 'CC0-1.0',
    licenseUrl: 'https://github.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/blob/74ff4b828e60531d70a3d173784231f8a882a18c/LICENSE',
    controlCatalogUrl: 'https://raw.githubusercontent.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm/4.0.13/CSV/CCMv4.0.13_Generated-at_2024-10-31_ccm_normalized_stripped.json',
    controlCatalogSha256: CONTROL_DIGEST,
    itemCatalogUrl: 'https://raw.githubusercontent.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm-caiq/4.0.3/ccm-caiq-4.0.3-generated-2024-10-31-normalized.csv',
    itemCatalogSha256: ITEM_DIGEST,
  },
  controls,
  items,
};

await writeFile(OUTPUT, `${JSON.stringify(pack)}\n`);

async function readPinned(path, expected, name) {
  const bytes = await readFile(resolve(path));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`${name} digest mismatch`);
  return bytes;
}

function mappingFor(id) {
  if (id === 'AIS-05') return { kind: 'capability', name: 'shadscan' };
  const capability = {
    'A&A-04': 'evidence-export',
    'CCC-02': 'required-checks',
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
  return { kind: 'manual', owner, reason: 'requires accountable human assessment outside CI observations' };
}

function parseCsv(value) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoted) {
      if (character === '"' && value[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (field.length > 0 || row.length > 0) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  if (quoted || rows.length < 2) throw new Error('malformed CAIQ CSV');
  const headers = rows.shift();
  if (headers.filter((header) => header === 'Control ID').length !== 1
    || headers.filter((header) => header === 'CAIQ_Question ID').length !== 1) {
    throw new Error('unexpected CAIQ CSV headers');
  }
  return rows.map((values) => {
    if (values.length !== headers.length) throw new Error('malformed CAIQ CSV row');
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}
