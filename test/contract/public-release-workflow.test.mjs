import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import YAML from 'yaml';

test('public workflow delegates all endpoints to durable orchestrator and signs only complete manifest', async () => {
  const source = await readFile('.github/workflows/unified-release.yml', 'utf8'); const workflow = YAML.parse(source);
  const publish = workflow.jobs['publish-public']; assert.ok(publish);
  const commands = publish.steps.filter((step) => step.run).map((step) => step.run).join('\n');
  assert.match(commands, /public-release\.mjs/); assert.match(commands, /finalize-public\.mjs .*manifest\.complete\.json/);
  assert.doesNotMatch(commands, /docker buildx build.*--push|git push/);
  assert.match(commands, /verjson-state-/);
  assert.match(commands, /verify-anchor-ruleset\.mjs/); assert.doesNotMatch(source, /VERJSON_CI_RELEASE_ANCHORS_PROTECTED/);
  assert.doesNotMatch(source, /Issue #4|test -f LICENSE/);
  assert.equal(workflow.jobs['publish-github'], undefined); assert.equal(workflow.jobs['publish-gitlab'], undefined);
});

test('signed publication requires protected-head validation and exact snapshot binding', async () => {
  const workflow = YAML.parse(await readFile('.github/workflows/unified-release.yml', 'utf8'));
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  const steps = workflow.jobs.validate.steps;
  const identity = steps.find((step) => step.id === 'identity');
  assert.match(identity.run, /test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.match(identity.run, /git rev-parse refs\/remotes\/origin\/main/);
  const snapshot = steps.find((step) => step.run?.includes('snapshot.mjs candidate'));
  assert.ok(snapshot);
  assert.equal(snapshot.env.RELEASE_VERSION, '${{ inputs.version }}');
  assert.equal(snapshot.env.RELEASE_COMMIT, '${{ inputs.commit }}');
  assert.ok(steps.indexOf(identity) < steps.indexOf(snapshot));
  assert.equal(workflow.jobs.release.needs, 'validate');
  assert.deepEqual(workflow.jobs['publish-public'].needs, ['validate', 'release']);
  assert.equal(workflow.jobs['publish-public'].environment, 'verjson-ci-public-release');
});
