#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { executeContract } from '../../engine/src/index.mjs';
import { serializeCanonicalResult } from '../../result-contract/src/index.mjs';
import { loadContract } from '../../schema/src/index.mjs';

const args = parseArgs(process.argv.slice(2));

try {
  const contract = await loadContract(args.config);
  const result = await executeContract(contract, {
    adapterVersion: process.env.VERJSON_CI_VERSION,
    commit: process.env.VERJSON_CI_COMMIT,
    cwd: args.cwd,
    engineVersion: process.env.VERJSON_CI_VERSION,
    imageDigest: process.env.VERJSON_CI_IMAGE_DIGEST,
    provider: process.env.VERJSON_CI_PROVIDER,
    scenario: process.env.VERJSON_CI_SCENARIO,
    shadscanReportPath: resolve(dirname(args.output), 'shadscan-report.json'),
  });
  const output = serializeCanonicalResult(result);
  await mkdir(dirname(args.output), { recursive: true });
  await writeFile(args.output, output);
  process.exitCode = result.outcome === 'success' ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}

function parseArgs(argv) {
  if (argv[0] !== 'run') {
    throw new Error('usage: verjson-ci run [--config path] [--output path] [--cwd path]');
  }

  const values = { config: 'verjson-ci.yml', output: '.verjson-ci/result.json', cwd: process.cwd() };
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !['--config', '--output', '--cwd'].includes(key)) {
      throw new Error(`invalid argument: ${key}`);
    }
    values[key.slice(2)] = key === '--cwd' ? resolve(value) : resolve(value);
  }
  return values;
}
