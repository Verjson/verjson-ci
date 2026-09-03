import { spawn } from 'node:child_process';

import { executeShadscan } from '../../shadscan/src/index.mjs';

export async function executeContract(contract, options = {}) {
  const commands = [];
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;

  for (const [name, command] of Object.entries(contract.commands)) {
    const result = await executeCommand(name, command, { ...options, timeoutMs });
    commands.push(result);
    if (result.outcome !== 'success') {
      return buildResult(contract, commands, result.outcome, options);
    }
  }

  const shadscan = await executeShadscan(contract.checks?.shadscan, {
    cwd: options.cwd,
    reportPath: options.shadscanReportPath,
    ...options.shadscan,
  });
  const outcome = shadscan.outcome === 'failure' ? 'failure' : 'success';
  return buildResult(contract, commands, outcome, options, { shadscan });
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
