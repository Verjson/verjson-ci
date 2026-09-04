import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const SUPPORTED_SPDX_EXPRESSIONS = new Set(['Apache-2.0']);

test('the current reusable workspace declares Apache-2.0 consistently', async () => {
  const license = await readFile('LICENSE', 'utf8');
  const rootManifest = JSON.parse(await readFile('package.json', 'utf8'));
  const packageDirectories = await readdir('packages', { withFileTypes: true });

  assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
  assert.equal(rootManifest.license, 'Apache-2.0');
  for (const directory of packageDirectories.filter((entry) => entry.isDirectory())) {
    const manifestPath = `packages/${directory.name}/package.json`;
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.ok(SUPPORTED_SPDX_EXPRESSIONS.has(manifest.license), `${manifestPath} must use a reviewed SPDX expression`);
    if (manifest.license !== 'Apache-2.0') {
      await access(`packages/${directory.name}/LICENSE`);
    }
  }
});

test('the mixed-license boundary requires an explicit license before paid code lands', async () => {
  const policy = await readFile('LICENSING.md', 'utf8');
  const orchestrator = await readFile('packages/release/src/index.mjs', 'utf8');
  const publicRelease = await readFile('tools/release/public-release.mjs', 'utf8');

  assert.match(policy, /dedicated workspace package subtree/);
  assert.match(policy, /its own `LICENSE`/);
  assert.match(policy, /SPDX license metadata/);
  assert.match(policy, /does not currently\s+contain such a package/);
  assert.doesNotMatch(`${orchestrator}\n${publicRelease}`, /assertPublishable|issue #4/);
});
