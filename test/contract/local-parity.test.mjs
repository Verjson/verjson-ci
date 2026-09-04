import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import { verifyMissingEvidenceBoundary } from '../../dev/parity-boundary.mjs';

const execFileAsync = promisify(execFile);

test('local parity fails explicitly when act is unavailable', async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, ['dev/parity-local.mjs'], {
      env: { ...process.env, ACT_BIN: 'definitely-not-installed-act' },
    }),
    ({ code, stderr }) => code === 2 && stderr.includes('act'),
  );
});

test('GitLab harness never uses removed runner exec command', async () => {
  const { stdout } = await execFileAsync('sh', ['-c', "! rg 'gitlab-runner[[:space:]]+exec|runner[[:space:]]+exec' dev"]);

  assert.equal(stdout, '');
});

test('missing-evidence fault injection is confined to checked-in local parity adapters', async () => {
  const githubFixture = await readFile('.github/workflows/local-parity.yml', 'utf8');
  const gitlabFixture = await readFile('.gitlab-ci.yml', 'utf8');
  const githubProduction = await readFile('.github/workflows/reusable-ci.yml', 'utf8');
  const gitlabProduction = await readFile('templates/ci.yml', 'utf8');

  for (const fixture of [githubFixture, gitlabFixture]) {
    assert.match(fixture, /compliance-missing-evidence/);
    assert.match(fixture, /86/);
  }
  for (const production of [githubProduction, gitlabProduction]) {
    assert.doesNotMatch(production, /compliance-missing-evidence|status=86|printf '86/);
  }
});

test('local parity matrix includes CAIQ success, required failure, and malformed boundaries', async () => {
  const local = await readFile('dev/parity-local.mjs', 'utf8');
  const gitlab = await readFile('dev/gitlab/run-local', 'utf8');

  for (const scenario of ['compliance-caiq-success', 'compliance-caiq-required-failure', 'compliance-caiq-malformed']) {
    assert.match(local, new RegExp(scenario));
    assert.match(gitlab, new RegExp(scenario));
  }
});

test('two absent evidence artifacts are not parity without both designated failure verdicts', () => {
  assert.throws(() => verifyMissingEvidenceBoundary({
    githubExit: '1\n',
    gitlabExit: '1\n',
    githubEvidenceExists: false,
    gitlabEvidenceExists: false,
  }), /designated boundary verdict/);
  assert.doesNotThrow(() => verifyMissingEvidenceBoundary({
    githubExit: '86\n',
    gitlabExit: '86\n',
    githubEvidenceExists: false,
    gitlabEvidenceExists: false,
  }));
});
