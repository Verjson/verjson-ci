import assert from 'node:assert/strict';
import test from 'node:test';

import { serializeCanonicalResult } from '../src/index.mjs';

test('canonical result removes only declared provider metadata', () => {
  const github = { outcome: 'success', provider: 'github', runId: '1', commands: [{ name: 'test', exitCode: 0 }] };
  const gitlab = { commands: [{ exitCode: 0, name: 'test' }], runUrl: 'https://gitlab/run/1', outcome: 'success', provider: 'gitlab' };

  assert.equal(serializeCanonicalResult(github), serializeCanonicalResult(gitlab));
});

test('canonical result retains semantic differences', () => {
  const success = { outcome: 'success', commands: [{ name: 'test', exitCode: 0 }] };
  const failure = { outcome: 'failure', commands: [{ name: 'test', exitCode: 1 }] };

  assert.notEqual(serializeCanonicalResult(success), serializeCanonicalResult(failure));
});

test('canonical result preserves compliance semantics while removing forge metadata', () => {
  const compliance = { artifactDigest: `sha256:${'a'.repeat(64)}`, controls: [{ id: 'CI-COMMANDS', status: 'satisfied' }] };
  const github = { provider: 'github', runUrl: 'https://github/runs/1', capabilities: { compliance } };
  const gitlab = { provider: 'gitlab', runId: '2', capabilities: { compliance: structuredClone(compliance) } };

  assert.equal(serializeCanonicalResult(github), serializeCanonicalResult(gitlab));
});
