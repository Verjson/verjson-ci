import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DurableReleaseStore } from '../src/durable-store.mjs';

const commit = 'a'.repeat(40); const identity = 'keyless:https://github.com/Verjson/verjson-ci/.github/workflows/release.yml@refs/heads/main';
function remote() {
  const generations = []; let conflictOnCreate = false;
  return {
    generations,
    conflict() { conflictOnCreate = true; },
    load: async () => generations.at(-1),
    create: async (expected, files) => {
      if (conflictOnCreate) { conflictOnCreate = false; generations.push({ generation: generations.length + 1, files: structuredClone(generations.at(-1).files) }); }
      if (generations.length !== expected) throw new Error('remote CAS conflict');
      const snapshot = { generation: expected + 1, files: structuredClone(files) };
      generations.push(snapshot); return snapshot.generation;
    },
  };
}

test('restores append-only release state in a fresh runner workspace', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'durable-release-')); const backing = remote();
  try {
    const first = new DurableReleaseStore(path.join(root, 'first'), { remote: backing });
    let release = await first.reserve('1.2.3', commit, identity);
    release = await first.append(release, { sequence: 1, previousState: 'reserved', previousRecordDigest: release.head, state: 'staged', signature: 'signed' });
    const second = new DurableReleaseStore(path.join(root, 'second'), { remote: backing });
    const restored = await second.reserve('1.2.3', commit, identity);
    assert.equal(restored.transitions.length, 1); assert.equal(restored.transitions[0].signature, 'signed');
    assert.equal(backing.generations.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('fails closed when another writer wins the immutable generation CAS', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'durable-release-cas-')); const backing = remote();
  try {
    const store = new DurableReleaseStore(root, { remote: backing }); const release = await store.reserve('1.2.3', commit, identity);
    backing.conflict();
    await assert.rejects(() => store.append(release, { sequence: 1, previousState: 'reserved', previousRecordDigest: release.head, state: 'staged', signature: 'signed' }), /CAS conflict/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
