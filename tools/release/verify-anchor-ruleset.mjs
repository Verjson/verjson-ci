#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
export const ANCHOR_PATTERN = 'refs/tags/verjson-release-state-anchor-verjson-state-*';

export async function verifyAnchorRuleset({ repository, output, run = runGh, now = () => new Date().toISOString() }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !output) throw new Error('repository and receipt output required');
  const summaries = JSON.parse(await run(['api', '--paginate', '--slurp', '--jq', 'add', `repos/${repository}/rulesets?includes_parents=true`]));
  const candidates = [];
  for (const summary of summaries) {
    if (summary.enforcement !== 'active' || summary.target !== 'tag') continue;
    const ruleset = JSON.parse(await run(['api', `repos/${repository}/rulesets/${summary.id}`])); const includes = ruleset.conditions?.ref_name?.include ?? []; const excludes = ruleset.conditions?.ref_name?.exclude ?? [];
    const types = new Set((ruleset.rules ?? []).map(({ type }) => type));
    if (ruleset.enforcement === 'active' && ruleset.target === 'tag' && includes.includes(ANCHOR_PATTERN) && excludes.length === 0 && types.has('deletion') && types.has('update') && (ruleset.bypass_actors ?? []).length === 0) candidates.push(ruleset);
  }
  if (candidates.length !== 1) throw new Error('exactly one active no-bypass tag ruleset must prohibit anchor update and deletion');
  const ruleset = candidates[0];
  const receipt = { schemaVersion: 1, repository, observedAt: now(), pattern: ANCHOR_PATTERN, ruleset: { id: ruleset.id, node_id: ruleset.node_id, name: ruleset.name, enforcement: ruleset.enforcement, target: ruleset.target, conditions: ruleset.conditions, rules: ruleset.rules, bypass_actors: ruleset.bypass_actors ?? [] } };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); return receipt;
}

async function runGh(args) { const { stdout } = await execFileAsync('gh', args, { env: process.env }); return stdout; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await verifyAnchorRuleset({ repository: process.argv[2], output: process.argv[3] }); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
