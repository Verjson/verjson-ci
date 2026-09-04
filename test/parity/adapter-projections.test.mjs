import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';

import { executeContract } from '../../packages/engine/src/index.mjs';
import { verifyComplianceParity } from '../../packages/compliance/src/index.mjs';
import { serializeCanonicalResult } from '../../packages/result-contract/src/index.mjs';
import { loadContract } from '../../packages/schema/src/index.mjs';

test('adapter entrypoints are valid YAML documents', async () => {
  for (const path of [
    'adapters/github/action/action.yml',
    '.github/workflows/reusable-ci.yml',
    '.github/workflows/remote-parity.yml',
    '.github/workflows/shadscan-rendered.yml',
    'templates/ci.yml',
    'templates/remote-parity.yml',
    'templates/shadscan-rendered.yml',
  ]) {
    const documents = parseAllDocuments(await readFile(path, 'utf8'));
    assert.equal(documents.some((document) => document.errors.length > 0), false, path);
  }
});

test('rendered ShadScan lanes pin the same CLI and stay separate from static CI', async () => {
  const github = await readFile('.github/workflows/shadscan-rendered.yml', 'utf8');
  const gitlab = await readFile('templates/shadscan-rendered.yml', 'utf8');

  for (const adapter of [github, gitlab]) {
    assert.match(adapter, /@shadscan\/cli@0\.17\.0/);
    assert.match(adapter, /--check-ui/);
    assert.match(adapter, /shadscan-rendered\.json/);
  }
  assert.doesNotMatch(await readFile('templates/ci.yml', 'utf8'), /--check-ui/);
});

test('both adapters invoke the same result path and provider-neutral CLI command', async () => {
  const github = await readFile('.github/workflows/reusable-ci.yml', 'utf8');
  const gitlab = await readFile('templates/ci.yml', 'utf8');

  for (const adapter of [github, gitlab]) {
    assert.match(adapter, /verjson-ci run|run --config/);
    assert.match(adapter, /\.verjson-ci\/result\.json/);
  }
  assert.match(github, /VERJSON_CI_PROVIDER=github/);
  assert.match(gitlab, /VERJSON_CI_PROVIDER: gitlab/);
});

test('both adapters require an externally pinned image identity', async () => {
  const github = await readFile('.github/workflows/reusable-ci.yml', 'utf8');
  const gitlab = await readFile('templates/ci.yml', 'utf8');

  assert.match(github, /image:[\s\S]*required: true/);
  assert.match(gitlab, /inputs:[\s\S]*image:/);
  assert.match(github, /@sha256:\[0-9a-f\]\{64\}/);
  assert.match(gitlab, /@sha256:\[0-9a-f\]\{64\}/);
  assert.doesNotMatch(github, /:latest|:main|:edge/);
  assert.doesNotMatch(gitlab, /:latest|:main|:edge/);
});

test('remote parity adapters use a protected fixed origin and await both receipts', async () => {
  const github = await readFile('.github/workflows/remote-parity.yml', 'utf8');
  const gitlab = await readFile('templates/remote-parity.yml', 'utf8');

  for (const adapter of [github, gitlab]) {
    assert.doesNotMatch(adapter, /coordinator-url:/);
    assert.match(adapter, /requestId/);
    assert.match(adapter, /status/);
    assert.match(adapter, /evidence unavailable/);
  }
  assert.match(github, /environment: cross-forge-conformance/);
  assert.match(github, /VERJSON_CI_COORDINATOR_ORIGIN/);
  assert.match(github, /--max-redirs 0/);
  assert.match(gitlab, /const base="https:\/\/coordinator\.verjson\.org"/);
  assert.doesNotMatch(gitlab, /process\.env\.(?:VERJSON_CI_)?COORDINATOR/);
  assert.match(gitlab, /redirect:\s*"error"/);
});

test('GitLab pipeline variables cannot override the compiled token destination', async () => {
  const gitlab = await readFile('templates/remote-parity.yml', 'utf8');
  const attackerVariable = 'VERJSON_CI_COORDINATOR_ORIGIN=https://attacker.example';
  assert.equal(gitlab.includes(attackerVariable.split('=')[1]), false);
  assert.match(gitlab, /const base="https:\/\/coordinator\.verjson\.org"/);
  assert.doesNotMatch(gitlab, /\$\[\[ inputs\.(?:coordinator|origin)|process\.env\.(?:VERJSON_CI_)?COORDINATOR/);
});

test('GitHub and GitLab project byte-identical compliance evidence and control semantics', async () => {
  const cwd = 'test/fixtures/compliance-success';
  const contract = await loadContract(`${cwd}/verjson-ci.yml`);
  const legs = {};
  for (const provider of ['github', 'gitlab']) {
    let artifactBytes;
    const result = await executeContract(contract, {
      cwd,
      provider,
      stdio: 'ignore',
      writeComplianceArtifact: async (bytes) => { artifactBytes = bytes; },
    });
    legs[provider] = { result, artifactBytes };
  }

  assert.equal(legs.github.artifactBytes, legs.gitlab.artifactBytes);
  assert.equal(serializeCanonicalResult(legs.github.result), serializeCanonicalResult(legs.gitlab.result));
});

test('both adapters project byte-identical CAIQ success and required-failure evidence', async () => {
  for (const fixture of ['compliance-caiq-success', 'compliance-caiq-required-failure']) {
    const cwd = `test/fixtures/${fixture}`;
    const contract = await loadContract(`${cwd}/verjson-ci.yml`);
    const legs = {};
    for (const provider of ['github', 'gitlab']) {
      let artifactBytes;
      const result = await executeContract(contract, { cwd, provider, stdio: 'ignore', writeComplianceArtifact: async (bytes) => { artifactBytes = bytes; } });
      legs[provider] = { result: result.capabilities.compliance, artifactBytes };
      const evidence = JSON.parse(artifactBytes);
      assert.equal(result.capabilities.compliance.items.length, 261, `${fixture}:${provider}:result-items`);
      assert.equal(new Set(result.capabilities.compliance.items.map(({ id }) => id)).size, 261, `${fixture}:${provider}:unique-result-items`);
      assert.equal(result.capabilities.compliance.frameworks[0].itemCoverage.total, 261, `${fixture}:${provider}:result-coverage`);
      assert.equal(evidence.frameworks[0].items.length, 261, `${fixture}:${provider}:artifact-items`);
      assert.equal(new Set(evidence.frameworks[0].items.map(({ id }) => id)).size, 261, `${fixture}:${provider}:unique-artifact-items`);
      assert.equal(evidence.frameworks[0].itemCoverage.total, 261, `${fixture}:${provider}:artifact-coverage`);
      assert.equal(evidence.frameworks[0].items.every(({ status, evidence: itemEvidence }) => typeof status === 'string' && typeof itemEvidence?.ref === 'string'), true, `${fixture}:${provider}:complete-item-evidence`);
    }
    assert.equal(legs.github.artifactBytes, legs.gitlab.artifactBytes, fixture);
    assert.match(verifyComplianceParity(legs.github, legs.gitlab), /^sha256:/, fixture);
  }
});

test('both adapters reject a malformed CAIQ version before execution', async () => {
  for (const provider of ['github', 'gitlab']) {
    await assert.rejects(() => loadContract('test/fixtures/compliance-caiq-malformed/verjson-ci.yml'), /invalid verjson-ci contract/, provider);
  }
});

test('both projections fail closed identically for missing evidence', async () => {
  const cwd = 'test/fixtures/compliance-missing-evidence';
  const contract = await loadContract(`${cwd}/verjson-ci.yml`);
  const legs = {};
  for (const provider of ['github', 'gitlab']) {
    let artifactBytes;
    const result = await executeContract(contract, { cwd, provider, stdio: 'ignore', writeComplianceArtifact: async (bytes) => { artifactBytes = bytes; } });
    legs[provider] = { result: result.capabilities.compliance, artifactBytes };
    assert.equal(result.outcome, 'failure');
    assert.equal(result.capabilities.compliance.controls.find(({ id }) => id === 'CI-LOCKFILE').status, 'unsatisfied');
  }
  assert.match(verifyComplianceParity(legs.github, legs.gitlab), /^sha256:/);
});

test('both projections reject malformed packs before producing a semantic result', async () => {
  for (const provider of ['github', 'gitlab']) {
    await assert.rejects(() => loadContract('test/fixtures/compliance-malformed-pack/verjson-ci.yml'), /invalid verjson-ci contract/, provider);
  }
});

test('both projections fail closed when an exact registered pack is missing', async () => {
  const contract = await loadContract('test/fixtures/compliance-success/verjson-ci.yml');
  for (const provider of ['github', 'gitlab']) {
    await assert.rejects(() => executeContract(contract, {
      provider,
      stdio: 'ignore',
      writeComplianceArtifact: async () => {},
      compliance: { readFile: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); } },
    }), /pack unavailable/, provider);
  }
});

test('parity rejects a missing forge evidence artifact even when control results match', async () => {
  const result = { artifactDigest: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', controls: [] };
  assert.throws(() => verifyComplianceParity({ result, artifactBytes: '{}' }, { result }), /evidence unavailable/);
});
