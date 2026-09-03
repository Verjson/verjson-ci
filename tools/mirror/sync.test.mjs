import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTags, planSync, syncMirrors } from './sync.mjs';

test('discovers only unprefixed SemVer tags', () => {
  const tags = parseTags('aaa\trefs/tags/1.2.3\nbbb\trefs/tags/v1.2.3\nccc\trefs/tags/1.2.3^{}\nddd\trefs/tags/latest\n');
  assert.deepEqual([...tags], [['1.2.3', 'aaa']]);
});

test('refuses to rewrite an existing release tag', () => {
  assert.throws(() => planSync(new Map([['1.2.3', 'source']]), new Map([['1.2.3', 'destination']])), /immutable/);
});

test('fetches and pushes only missing immutable tags', async () => {
  const calls = [];
  const run = async (args) => {
    calls.push(args);
    if (args[0] === 'ls-remote') return args[2] === 'source' ? 'aaa\trefs/tags/1.2.3\nbbb\trefs/tags/2.0.0\n' : 'aaa\trefs/tags/1.2.3\n';
    return '';
  };
  const plan = await syncMirrors({ source: 'source', destination: 'destination' }, run);
  assert.deepEqual(plan, [{ tag: '2.0.0', oid: 'bbb' }]);
  assert.equal(calls.some((args) => args.includes('refs/tags/2.0.0:refs/tags/2.0.0')), true);
  assert.equal(calls.some((args) => args.join(' ').includes('1.2.3:refs/tags/1.2.3')), false);
});

test('rejects credentials embedded in remotes before invoking git', async () => {
  await assert.rejects(() => syncMirrors({ source: 'https://token@example.test/repo.git', destination: 'destination' }, async () => ''), /credentials/);
});
