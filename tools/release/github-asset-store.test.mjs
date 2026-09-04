import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { githubAssetRemote } from './github-asset-store.mjs';

const commit = 'a'.repeat(40);

function fakeGh() {
  const assets = new Map(); const anchors = new Map(); const tagObjects = new Map(); let uploadCount = 0; let pendingTag;
  return {
    assets, anchors, tagObjects,
    get uploadCount() { return uploadCount; },
    run: async (args) => {
      if (args[0] === 'release' && args[1] === 'view') return JSON.stringify([...assets].map(([name]) => ({ name })));
      if (args[1] === 'upload') { const file = args[3]; const name = path.basename(file); if (assets.has(name)) throw new Error('asset exists'); assets.set(name, await readFile(file)); uploadCount += 1; return ''; }
      if (args[1] === 'download') { const name = args[args.indexOf('--pattern') + 1]; const directory = args[args.indexOf('--dir') + 1]; if (!assets.has(name)) throw new Error('not found'); await writeFile(path.join(directory, name), assets.get(name)); return ''; }
      if (args[0] === 'api' && args.some((item) => item.includes('matching-refs'))) return JSON.stringify([...anchors].map(([name, sha]) => ({ ref: `refs/tags/${name}`, object: { sha } })));
      if (args[0] === 'api' && args[1]?.includes('/git/tags/')) return JSON.stringify(tagObjects.get(args[1].split('/').at(-1)));
      if (args[0] === 'api' && args.some((item) => item.endsWith('/git/tags'))) {
        const field = (name) => args.find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1);
        const sha = `tag-${tagObjects.size + 1}`; pendingTag = { sha, name: field('tag') };
        tagObjects.set(sha, { tag: pendingTag.name, message: field('message'), object: { type: field('type'), sha: field('object') } }); return `${sha}\n`;
      }
      if (args[0] === 'api' && args.some((item) => item.endsWith('/git/refs'))) { anchors.set(pendingTag.name, pendingTag.sha); pendingTag = undefined; return ''; }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
  };
}

function remote(fake) { return githubAssetRemote({ repository: 'Verjson/verjson-ci', version: '1.2.3', commit, run: fake.run }); }

test('stores immutable hash-chained checkpoint assets and separate annotated anchors with CAS', async () => {
  const fake = fakeGh(); const store = remote(fake);
  assert.equal(await store.load(), undefined); assert.equal(await store.create(0, { 'ledger/a': 'YQ==' }), 1);
  const loaded = await store.load(); assert.equal(loaded.generation, 1); assert.deepEqual(loaded.files, { 'ledger/a': 'YQ==' }); assert.match(loaded.digest, /^sha256:/);
  await assert.rejects(() => store.create(0, {}), /CAS conflict/); assert.equal(fake.uploadCount, 1);
});

test('rejects deletion of newest asset while its monotonic anchor remains', async () => {
  const fake = fakeGh(); const store = remote(fake); await store.create(0, { a: 'YQ==' }); await store.create(1, { b: 'Yg==' });
  fake.assets.delete('verjson-release-state-1.2.3-00000002.json');
  await assert.rejects(() => store.load(), /disagree/);
});

test('rejects deleted and mismatched immutable anchors', async () => {
  for (const mutation of ['delete', 'mismatch']) {
    const fake = fakeGh(); const store = remote(fake); await store.create(0, { a: 'YQ==' }); await store.create(1, { b: 'Yg==' });
    const name = 'verjson-release-state-anchor-1.2.3-00000002'; const sha = fake.anchors.get(name);
    if (mutation === 'delete') fake.anchors.delete(name); else fake.tagObjects.get(sha).message = `sha256:${'f'.repeat(64)}`;
    await assert.rejects(() => store.load(), mutation === 'delete' ? /disagree/ : /anchor mismatch/);
  }
});

test('rejects interior generation gaps on both remote histories', async () => {
  const fake = fakeGh(); const store = remote(fake); await store.create(0, { a: 'YQ==' }); await store.create(1, { b: 'Yg==' });
  fake.assets.delete('verjson-release-state-1.2.3-00000001.json'); fake.anchors.delete('verjson-release-state-anchor-1.2.3-00000001');
  await assert.rejects(() => store.load(), /generation gap/);
});
