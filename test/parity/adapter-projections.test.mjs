import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseAllDocuments } from 'yaml';

test('adapter entrypoints are valid YAML documents', async () => {
  for (const path of [
    'adapters/github/action/action.yml',
    '.github/workflows/reusable-ci.yml',
    'templates/ci.yml',
  ]) {
    const documents = parseAllDocuments(await readFile(path, 'utf8'));
    assert.equal(documents.some((document) => document.errors.length > 0), false, path);
  }
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
