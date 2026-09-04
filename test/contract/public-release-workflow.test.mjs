import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

test('public workflow delegates all endpoints to durable orchestrator and signs only complete manifest', async () => {
  const source = await readFile('.github/workflows/release.yml', 'utf8'); const workflow = YAML.parse(source);
  const publish = workflow.jobs['publish-public']; assert.ok(publish);
  const commands = publish.steps.filter((step) => step.run).map((step) => step.run).join('\n');
  assert.match(commands, /public-release\.mjs/); assert.match(commands, /finalize-public\.mjs .*manifest\.complete\.json/);
  assert.doesNotMatch(commands, /docker buildx build.*--push|git push/);
  assert.match(commands, /verjson-state-/);
  assert.match(commands, /verify-anchor-ruleset\.mjs/); assert.doesNotMatch(source, /VERJSON_CI_RELEASE_ANCHORS_PROTECTED/);
  assert.doesNotMatch(source, /Issue #4|test -f LICENSE/);
  assert.equal(workflow.jobs['publish-github'], undefined); assert.equal(workflow.jobs['publish-gitlab'], undefined);
});
