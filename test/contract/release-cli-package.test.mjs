import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

test('standalone CLI archive embeds and reports the unified release version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verjson-ci-release-package-'));
  const install = join(directory, 'install');
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      'tools/release/package-cli.mjs', '1.2.3', directory,
    ]);
    const metadata = JSON.parse(stdout);
    assert.equal(metadata.version, '1.2.3');
    assert.match(metadata.sha256, /^[0-9a-f]{64}$/);
    const { stdout: archiveEntries } = await execFileAsync('tar', ['-tzf', metadata.path]);
    assert.match(archiveEntries, /^package\/LICENSE$/m);
    assert.match(archiveEntries, /^package\/LICENSING\.md$/m);
    assert.match(archiveEntries, /^package\/artifact-licenses\.json$/m);
    const { stdout: packedManifestSource } = await execFileAsync('tar', ['-xOzf', metadata.path, 'package/package.json']);
    const packedManifest = JSON.parse(packedManifestSource);
    assert.equal(packedManifest.license, 'Apache-2.0');
    assert.equal(packedManifest.verjsonLicenseInventory, 'artifact-licenses.json');
    const rootManifest = JSON.parse(await readFile('package.json', 'utf8'));
    assert.deepEqual(packedManifest.dependencies, {
      ajv: rootManifest.dependencies.ajv,
      yaml: rootManifest.dependencies.yaml,
    });
    const { stdout: packedLicense } = await execFileAsync('tar', ['-xOzf', metadata.path, 'package/LICENSE']);
    assert.equal(packedLicense, await readFile('LICENSE', 'utf8'));

    await execFileAsync('npm', ['install', '--prefix', install, metadata.path]);
    const output = join(directory, 'result.json');
    const fixture = resolve('test/fixtures/compliance-caiq-success');
    await execFileAsync(join(install, 'node_modules/.bin/verjson-ci'), [
      'run', '--config', join(fixture, 'verjson-ci.yml'), '--output', output, '--cwd', fixture,
    ]);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual({ engine: result.engineVersion, adapter: result.adapterVersion, outcome: result.outcome }, {
      engine: '1.2.3', adapter: '1.2.3', outcome: 'success',
    });
    assert.match(result.capabilities.compliance.artifactDigest, /^sha256:/);
    assert.deepEqual(result.capabilities.compliance.frameworks.map(({ id, version }) => ({ id, version })), [
      { id: 'csa-star-l1-caiq', version: '4.0.13' },
    ]);
    assert.equal(result.capabilities.compliance.items.length, 261);
    assert.equal(new Set(result.capabilities.compliance.items.map(({ id }) => id)).size, 261);
    assert.equal(result.capabilities.compliance.frameworks[0].itemCoverage.total, 261);
    const evidence = JSON.parse(await readFile(join(directory, 'compliance-evidence.json'), 'utf8'));
    assert.equal(evidence.schema, 2);
    assert.equal(evidence.frameworks[0].items.length, 261);
    assert.equal(new Set(evidence.frameworks[0].items.map(({ id }) => id)).size, 261);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
