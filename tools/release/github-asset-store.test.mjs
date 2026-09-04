import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { githubAssetRemote } from './github-asset-store.mjs';

function fakeGh() {
  const assets = new Map(); let uploadCount = 0;
  return {
    assets,
    get uploadCount() { return uploadCount; },
    run: async (args) => {
      if (args[0] === 'release' && args[1] === 'view') return JSON.stringify([...assets].map(([name]) => ({ name })));
      if (args[1] === 'upload') { const file = args[3]; const name = path.basename(file); if (assets.has(name)) throw new Error('asset exists'); assets.set(name, await readFile(file)); uploadCount += 1; return '' ; }
      if (args[1] === 'download') { const name = args[args.indexOf('--pattern') + 1]; const directory = args[args.indexOf('--dir') + 1]; await writeFile(path.join(directory, name), assets.get(name)); return ''; }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
  };
}

test('stores immutable sequential GitHub release checkpoint assets with CAS', async () => {
  const fake = fakeGh(); const remote = githubAssetRemote({ repository: 'Verjson/verjson-ci', version: '1.2.3', run: fake.run });
  assert.equal(await remote.load(), undefined); assert.equal(await remote.create(0, { 'ledger/a': 'YQ==' }), 1);
  assert.deepEqual(await remote.load(), { generation: 1, files: { 'ledger/a': 'YQ==' } });
  await assert.rejects(() => remote.create(0, {}), /CAS conflict/); assert.equal(fake.uploadCount, 1);
});

test('rejects truncated immutable checkpoint generation history', async () => {
  const fake = fakeGh(); fake.assets.set('verjson-release-state-1.2.3-00000002.json', Buffer.from('{"generation":2,"files":{}}'));
  await assert.rejects(() => githubAssetRemote({ repository: 'Verjson/verjson-ci', version: '1.2.3', run: fake.run }).load(), /generation gap/);
});
