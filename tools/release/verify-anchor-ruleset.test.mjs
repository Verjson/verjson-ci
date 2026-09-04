import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ANCHOR_PATTERN, verifyAnchorRuleset } from './verify-anchor-ruleset.mjs';

const valid = { id: 7, node_id: 'RRS_7', name: 'immutable release anchors', enforcement: 'active', target: 'tag', conditions: { ref_name: { include: [ANCHOR_PATTERN], exclude: [] } }, rules: [{ type: 'deletion' }, { type: 'update' }], bypass_actors: [] };
const runFor = (detail) => async (args) => args.some((item) => item.includes('rulesets?')) ? JSON.stringify([{ id: 7, enforcement: detail.enforcement, target: detail.target }]) : JSON.stringify(detail);

test('reads back exact active no-bypass anchor controls and retains receipt', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'anchor-rules-')); const output = path.join(directory, 'receipt.json');
  try { const receipt = await verifyAnchorRuleset({ repository: 'Verjson/verjson-ci', output, run: runFor(valid), now: () => '2026-09-04T00:00:00.000Z' }); assert.equal(receipt.ruleset.id, 7); assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), receipt); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test('fails closed on mutable, deletable, bypassable, excluded, or ambiguous controls', async () => {
  for (const detail of [
    { ...valid, rules: [{ type: 'deletion' }] },
    { ...valid, rules: [{ type: 'update' }] },
    { ...valid, bypass_actors: [{ actor_type: 'OrganizationAdmin' }] },
    { ...valid, conditions: { ref_name: { include: [ANCHOR_PATTERN], exclude: ['refs/tags/*'] } } },
    { ...valid, enforcement: 'evaluate' },
  ]) await assert.rejects(() => verifyAnchorRuleset({ repository: 'Verjson/verjson-ci', output: '/unused', run: runFor(detail) }), /exactly one/);
  const ambiguous = async (args) => args.some((item) => item.includes('rulesets?')) ? JSON.stringify([{ id: 7, enforcement: 'active', target: 'tag' }, { id: 8, enforcement: 'active', target: 'tag' }]) : JSON.stringify({ ...valid, id: args[1].endsWith('/8') ? 8 : 7 });
  await assert.rejects(() => verifyAnchorRuleset({ repository: 'Verjson/verjson-ci', output: '/unused', run: ambiguous }), /exactly one/);
});
