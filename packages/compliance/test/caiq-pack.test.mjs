import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { evaluateCompliance, loadFrameworkPack } from '../src/index.mjs';

const reference = { id: 'csa-star-l1-caiq', version: '4.0.13' };

test('CAIQ v4.0.13 pack binds the complete control and item identifier sets', async () => {
  const pack = await loadFrameworkPack(reference);

  assert.equal(pack.controls.length, 197);
  assert.equal(pack.items.length, 261);
  assert.equal(new Set(pack.controls.map(({ id }) => id)).size, 197);
  assert.equal(new Set(pack.items.map(({ id }) => id)).size, 261);
  assert.equal(pack.items.every(({ controlId }) => pack.controls.some(({ id }) => id === controlId)), true);
  assert.equal(pack.controls.some(({ evidence }) => ['commands-all', 'file-any'].includes(evidence.kind)), false);
  assert.deepEqual(
    Object.fromEntries(Object.entries(Object.groupBy(pack.controls, ({ id }) => id.split('-')[0])).map(([domain, controls]) => [domain, controls.length])),
    { AIS: 7, 'A&A': 6, BCR: 11, CCC: 9, CEK: 21, DSP: 19, DCS: 15, GRC: 8, HRS: 13, IAM: 16, IVS: 9, IPY: 4, LOG: 13, SEF: 8, STA: 14, TVM: 10, UEM: 14 },
  );
  assert.deepEqual(pack.provenance, {
    owner: 'Cloud Security Alliance (CSA)',
    datasetLicense: 'CC0-1.0',
    licenseUrl: 'https://github.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/blob/74ff4b828e60531d70a3d173784231f8a882a18c/LICENSE',
    controlCatalogUrl: 'https://raw.githubusercontent.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm/4.0.13/CSV/CCMv4.0.13_Generated-at_2024-10-31_ccm_normalized_stripped.json',
    controlCatalogSha256: 'ca79a31918e0d624895d1d154b9ea2717bcc78dfea0e61c7a8f288ebb48939cb',
    itemCatalogUrl: 'https://raw.githubusercontent.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm-caiq/4.0.3/ccm-caiq-4.0.3-generated-2024-10-31-normalized.csv',
    itemCatalogSha256: '56b0f8b35e444ac3fa7fdb9ba83c4a0ed8b428cffd8a1324773538db807779ea',
  });
});

test('CAIQ pack projects one deterministic evidence record per item without unrelated command assertions', async () => {
  const evaluated = await evaluateCompliance(
    { frameworks: [reference], mode: 'report' },
    {
      commands: [{ name: 'unrelated', exitCode: 0, signal: null, outcome: 'success' }],
      capabilities: { shadscan: { applicable: true, outcome: 'success' } },
      files: ['pnpm-lock.yaml'],
    },
  );

  assert.equal(evaluated.result.frameworks[0].coverage.total, 197);
  assert.deepEqual(evaluated.result.frameworks[0].itemCoverage, { total: 261, automated: 2, satisfied: 2 });
  assert.equal(evaluated.result.items.length, 261);
  assert.equal(new Set(evaluated.result.items.map(({ id }) => id)).size, 261);
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'CCC-02').status, 'not-automated');
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'AIS-05').status, 'satisfied');
  assert.equal(evaluated.result.controls.find(({ id }) => id === 'STA-07').status, 'not-automated');
  assert.deepEqual(evaluated.result.controls.find(({ id }) => id === 'HRS-01').evidence, {
    kind: 'manual',
    ref: 'human-hr',
    status: 'not-automated',
    facts: { reason: 'requires accountable human assessment outside CI observations' },
  });
  const aisEvidence = evaluated.result.controls.find(({ id }) => id === 'AIS-05').evidence;
  for (const item of evaluated.result.items.filter(({ controlId }) => controlId === 'AIS-05')) assert.deepEqual(item.evidence, aisEvidence);
  assert.doesNotMatch(evaluated.artifactBytes, /unrelated|pnpm-lock/);
});

test('CAIQ required mode fails closed when required-check evidence fails or is unavailable', async () => {
  for (const capabilities of [{ 'required-checks': { applicable: true, outcome: 'failure' } }, {}]) {
    const evaluated = await evaluateCompliance(
      { frameworks: [reference], mode: 'required' },
      { commands: [{ name: 'unrelated', exitCode: 0, signal: null, outcome: 'success' }], capabilities, files: [] },
    );

    assert.equal(evaluated.failed, true);
    assert.notEqual(evaluated.result.controls.find(({ id }) => id === 'CCC-02').status, 'satisfied');
  }
});

test('semantic validation rejects an orphan item after its catalog digest is recomputed', async () => {
  await assert.rejects(
    () => loadMutatedPack((pack) => pack.items.push({ id: 'AIS-99.1', controlId: 'AIS-99' }), 'orphan'),
    /compliance framework item malformed/,
  );
});

test('semantic validation rejects credential-bearing and oversized provenance URLs', async () => {
  for (const [name, url] of [
    ['credentials', 'https://user:secret@example.test/catalog.csv'],
    ['oversized', `https://example.test/${'a'.repeat(2049)}`],
  ]) {
    await assert.rejects(
      () => loadMutatedPack((pack) => { pack.provenance.itemCatalogUrl = url; }, name),
      /compliance framework pack provenance malformed/,
    );
  }
});

async function loadMutatedPack(mutate, caseName) {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-caiq-malformed-'));
  const compliance = join(directory, 'compliance');
  try {
    await cp(resolve('packages/compliance'), compliance, { recursive: true });
    const packPath = join(compliance, 'packs/csa-star-l1-caiq/4.0.13.json');
    const catalogPath = join(compliance, 'packs/catalog.json');
    const pack = JSON.parse(await readFile(packPath, 'utf8'));
    mutate(pack);
    const bytes = `${JSON.stringify(pack)}\n`;
    await writeFile(packPath, bytes);
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    catalog.packs.find(({ id }) => id === reference.id).digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    await writeFile(catalogPath, `${JSON.stringify(catalog)}\n`);
    const module = await import(`${pathToFileURL(join(compliance, 'src/index.mjs')).href}?case=${caseName}`);
    return await module.loadFrameworkPack(reference);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
