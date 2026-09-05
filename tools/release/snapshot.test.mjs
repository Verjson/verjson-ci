import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSnapshotDispatch, verifySnapshot } from './snapshot.mjs';

const commit = 'a'.repeat(40);
function gitFixture(overrides = {}) {
  return async (args) => {
    if (args[0] in overrides) return overrides[args[0]];
    if (args[0] === 'cat-file') {
      assert.deepEqual(args, ['cat-file', '-t', 'refs/tags/snapshot-v1.2.3']);
      return 'tag\n';
    }
    if (args[0] === 'rev-parse') {
      assert.deepEqual(args, ['rev-parse', '--verify', 'refs/tags/snapshot-v1.2.3^{commit}']);
      return `${commit}\n`;
    }
    assert.deepEqual(args, ['show', `${commit}:CHANGELOG/snapshot-v1.2.3.md`]);
    return '# Released changes\n';
  };
}

test('snapshot dispatch reserves an internal namespace independent of public SemVer', () => {
  validateSnapshotDispatch({ inputs: { prefix: 'snapshot-v', version: 'snapshot-v1.2.3' } });
  for (const inputs of [{ prefix: 'v', version: 'v1.2.3' }, { prefix: 'snapshot-v', version: '1.2.3' }, { prefix: 'snapshot-v', version: 'snapshot-v01.2.3' }, { prefix: 'snapshot-v', version: 'snapshot-v1.2.3-01' }, {}]) {
    assert.throws(() => validateSnapshotDispatch({ inputs }), /canonical snapshots require/);
  }
});

test('publication candidate binds exact annotated snapshot tag and committed notes', async () => {
  await verifySnapshot('1.2.3', commit, gitFixture());
});

test('publication refuses a different commit or a lightweight snapshot tag', async () => {
  await assert.rejects(verifySnapshot('1.2.3', commit, gitFixture({ 'rev-parse': 'b'.repeat(40) })), /differs/);
  await assert.rejects(verifySnapshot('1.2.3', commit, gitFixture({ 'cat-file': 'commit' })), /annotated/);
});

test('publication fails closed when snapshot discovery or committed notes fail', async () => {
  await assert.rejects(verifySnapshot('1.2.3', commit, async () => { throw new Error('missing snapshot'); }), /missing snapshot/);
  await assert.rejects(verifySnapshot('1.2.3', commit, gitFixture({ show: '' })), /notes are empty/);
});

test('public identities reject internal snapshot names and malformed commits before Git access', async () => {
  for (const [version, sha] of [['snapshot-v1.2.3', commit], ['1.2.3', 'main'], ['../1.2.3', commit], ['1.2.3-01', commit]]) {
    await assert.rejects(verifySnapshot(version, sha, () => assert.fail('Git must not run')), /invalid public/);
  }
});
