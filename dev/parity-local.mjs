import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { serializeCanonicalResult } from '../packages/result-contract/src/index.mjs';

const root = resolve(import.meta.dirname, '..');
const options = parseArgs(process.argv.slice(2));
const scenarios = selectScenarios(options);
const commands = {
  act: process.env.ACT_BIN || 'act',
  docker: process.env.DOCKER_BIN || 'docker',
};

verifyPrerequisites(commands);
await rm(resolve(root, '.verjson-ci/local'), { force: true, recursive: true });
await mkdir(resolve(root, '.verjson-ci/local'), { recursive: true });

const image = `verjson-ci:parity-${process.pid}`;
run(commands.docker, ['build', '--file', 'container/Dockerfile', '--tag', image, '.']);

for (const scenario of scenarios) {
  runExpected(commands.act, [
    'workflow_dispatch',
    '--platform',
    `ubuntu-24.04=${process.env.ACT_PLATFORM_IMAGE || 'catthehacker/ubuntu:act-24.04'}`,
    '--workflows',
    '.github/workflows/local-parity.yml',
    '--input',
    `scenario=${scenario}`,
    '--env',
    `VERJSON_CI_LOCAL_IMAGE=${image}`,
  ], scenario === 'failure' ? 1 : 0);
  run(resolve(root, 'dev/gitlab/run-local'), [scenario, image]);
  await compareScenario(scenario);
}

process.stdout.write(`local parity passed: ${scenarios.join(', ')}\n`);

function parseArgs(args) {
  const parsed = { changed: false, scenario: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--changed') {
      parsed.changed = true;
    } else if (args[index] === '--scenario' && args[index + 1]) {
      parsed.scenario = args[index + 1];
      index += 1;
    } else {
      throw new Error(`unknown local parity argument: ${args[index]}`);
    }
  }
  return parsed;
}

function selectScenarios({ changed, scenario }) {
  const supported = new Set(['success', 'failure']);
  if (scenario) {
    if (!supported.has(scenario)) {
      throw new Error(`unknown local parity scenario: ${scenario}`);
    }
    return [scenario];
  }

  if (changed) {
    const diff = spawnSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (diff.status !== 0) {
      throw new Error('could not determine changed files for local parity');
    }
    if (/verjson-ci\.schema\.json|packages\/schema\//.test(diff.stdout)) {
      return ['success', 'failure'];
    }
  }
  return ['success'];
}

function verifyPrerequisites(required) {
  const unavailable = Object.entries(required)
    .filter(([, command]) => spawnSync(command, ['--version'], { stdio: 'ignore' }).status !== 0)
    .map(([name]) => name);
  if (unavailable.length > 0) {
    process.stderr.write(`local parity prerequisites unavailable: ${unavailable.join(', ')}\n`);
    process.exit(2);
  }
  if (!existsSync(resolve(root, 'dev/gitlab/run-local'))) {
    throw new Error('GitLab local harness is missing');
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${command} exited ${result.status ?? 'without a status'}`);
  }
}

function runExpected(command, args, expectedStatus) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== expectedStatus) {
    throw new Error(`${command} exited ${result.status ?? 'without a status'}; expected ${expectedStatus}`);
  }
}

async function compareScenario(scenario) {
  const directory = resolve(root, '.verjson-ci/local');
  const github = JSON.parse(await readFile(resolve(directory, `${scenario}-github.json`), 'utf8'));
  const gitlab = JSON.parse(await readFile(resolve(directory, `${scenario}-gitlab.json`), 'utf8'));
  // GitLab runs a snapshot commit so uncommitted developer changes are testable.
  delete github.commit;
  delete gitlab.commit;
  if (serializeCanonicalResult(github) !== serializeCanonicalResult(gitlab)) {
    throw new Error(`adapter result mismatch for scenario ${scenario}`);
  }
}
