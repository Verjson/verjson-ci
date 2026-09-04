import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';

import { ComplianceBoundaryError, evaluateCompliance } from '../../compliance/src/index.mjs';
import { executeShadscan } from '../../shadscan/src/index.mjs';

export async function executeContract(contract, options = {}) {
  const commands = [];
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
  let commandOutcome = 'success';

  for (const [name, command] of Object.entries(contract.commands)) {
    const result = await executeCommand(name, command, { ...options, timeoutMs });
    commands.push(result);
    if (result.outcome !== 'success') {
      commandOutcome = result.outcome;
      break;
    }
  }

  const capabilities = {};
  if (commandOutcome === 'success') {
    capabilities.shadscan = await executeShadscan(contract.checks?.shadscan, {
      cwd: options.cwd,
      reportPath: options.shadscanReportPath,
      ...options.shadscan,
    });
  }
  let outcome = commandOutcome === 'success' && capabilities.shadscan?.outcome !== 'failure' ? 'success' : commandOutcome === 'success' ? 'failure' : commandOutcome;
  const complianceConfiguration = contract.checks?.compliance;
  if (complianceConfiguration && complianceConfiguration !== 'off') {
    if (typeof options.writeComplianceArtifact !== 'function') throw new ComplianceBoundaryError('compliance artifact writer is required');
    const evaluated = await evaluateCompliance(complianceConfiguration, {
      commands,
      capabilities,
      files: options.complianceFiles ?? await detectDependencyFiles(options.cwd ?? process.cwd(), {
        lstat: options.lstat ?? lstat,
        realpath: options.realpath ?? realpath,
      }),
    }, options.compliance);
    capabilities.compliance = evaluated.result;
    await options.writeComplianceArtifact(evaluated.artifactBytes);
    if (evaluated.failed) outcome = 'failure';
  }
  return buildResult(contract, commands, outcome, options, capabilities);
}

async function detectDependencyFiles(cwd, files) {
  const root = await files.realpath(cwd);
  const names = ['npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml'];
  const present = [];
  for (const name of names) {
    try {
      const metadata = await files.lstat(join(root, name));
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new ComplianceBoundaryError(`dependency evidence must be a regular file: ${name}`);
      present.push(name);
    }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return present;
}

function executeCommand(name, command, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: true,
      stdio: options.stdio ?? 'inherit',
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, options.timeoutMs);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({
        name,
        command,
        exitCode: code,
        signal,
        outcome: timedOut ? 'timeout' : code === 0 ? 'success' : 'failure',
      });
    });
  });
}

function buildResult(contract, commands, outcome, options, capabilities = {}) {
  return {
    resultSchema: 1,
    contractSchema: contract.schema,
    engineVersion: options.engineVersion ?? '0.0.0-dev',
    adapterVersion: options.adapterVersion ?? '0.0.0-dev',
    commit: options.commit ?? 'local',
    imageDigest: options.imageDigest ?? 'local',
    scenario: options.scenario ?? 'default',
    provider: options.provider ?? 'local',
    commands,
    capabilities,
    outcome,
  };
}
