import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

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
