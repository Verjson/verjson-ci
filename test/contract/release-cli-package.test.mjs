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

    await execFileAsync('npm', ['install', '--prefix', install, metadata.path]);
    const output = join(directory, 'result.json');
    const fixture = resolve('test/fixtures/compliance-success');
    await execFileAsync(join(install, 'node_modules/.bin/verjson-ci'), [
      'run', '--config', join(fixture, 'verjson-ci.yml'), '--output', output, '--cwd', fixture,
    ]);
    const result = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual({ engine: result.engineVersion, adapter: result.adapterVersion, outcome: result.outcome }, {
      engine: '1.2.3', adapter: '1.2.3', outcome: 'success',
    });
    assert.match(result.capabilities.compliance.artifactDigest, /^sha256:/);
    assert.equal(typeof await readFile(join(directory, 'compliance-evidence.json'), 'utf8'), 'string');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
