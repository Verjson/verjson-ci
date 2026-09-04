import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { REQUIRED_ENDPOINT_IDS } from './manifest.mjs';

const execFileAsync = promisify(execFile); const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function commandPublisher(plan, run = runCommand) {
  validatePlan(plan);
  return {
    endpoints: async () => plan.map(({ id, digest }) => ({ id, digest })),
    readDigest: async ({ id }) => {
      const endpoint = plan.find((item) => item.id === id);
      const result = await run(endpoint.observe, { allowMissing: true });
      if (result.missing) return undefined;
      const digest = result.stdout.trim();
      if (!DIGEST.test(digest)) throw new Error(`public endpoint ${id} returned invalid digest`);
      return digest;
    },
    create: async ({ id }) => {
      const endpoint = plan.find((item) => item.id === id);
      await run(endpoint.create, { allowMissing: false });
    },
  };
}

export function validatePlan(plan) {
  if (!Array.isArray(plan) || plan.length !== REQUIRED_ENDPOINT_IDS.length) throw new Error('public endpoint plan must be closed and complete');
  const ids = plan.map(({ id }) => id);
  if (new Set(ids).size !== ids.length || [...ids].sort().join() !== [...REQUIRED_ENDPOINT_IDS].sort().join()) throw new Error('public endpoint plan is missing, duplicate, or unknown');
  for (const endpoint of plan) {
    if (!DIGEST.test(endpoint.digest)) throw new Error(`public endpoint ${endpoint.id} digest invalid`);
    for (const operation of ['observe', 'create']) if (!Array.isArray(endpoint[operation]) || !endpoint[operation].length || endpoint[operation].some((part) => typeof part !== 'string' || !part)) throw new Error(`public endpoint ${endpoint.id} ${operation} command invalid`);
  }
  return plan;
}

async function runCommand(command, { allowMissing }) {
  try { const { stdout } = await execFileAsync(command[0], command.slice(1), { env: process.env }); return { stdout, missing: false }; }
  catch (error) { if (allowMissing && error.code === 44) return { stdout: '', missing: true }; throw error; }
}
