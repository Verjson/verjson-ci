import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const SHADSCAN_VERSION = '0.17.0';

export async function executeShadscan(setting = 'off', options = {}) {
  if (setting === 'off') return notApplicable('disabled');
  const cwd = options.cwd ?? process.cwd();
  const detected = await detectSupportedProject(cwd, options.files);
  const config = normalizeSetting(setting);
  if (!detected) {
    return config.required
      ? { ...notApplicable('required-project-not-detected'), outcome: 'failure' }
      : notApplicable('unsupported-project');
  }

  const floor = Math.max(config.failUnder, config.baseline ?? 0);
  const execution = await (options.run ?? runCli)({ cwd, version: config.version, floor });
  let report;
  try {
    report = JSON.parse(execution.stdout);
  } catch (error) {
    return { applicable: true, outcome: 'failure', reason: 'invalid-json-report', version: config.version, threshold: floor, error: error.message };
  }
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  const assessed = report.coverage?.source === 'complete' && Number.isFinite(report.score);
  return {
    applicable: true,
    outcome: execution.code === 0 && assessed && report.score >= floor ? 'success' : 'failure',
    reason: assessed ? undefined : 'incomplete-assessment',
    version: config.version,
    reportSchema: report.schemaVersion,
    score: report.score ?? null,
    findings: Array.isArray(report.findings) ? report.findings.length : 0,
    threshold: floor,
  };
}

export async function detectSupportedProject(cwd, files = { access, readFile }) {
  try {
    await files.access(join(cwd, 'components.json'));
    const manifest = JSON.parse(await files.readFile(join(cwd, 'package.json'), 'utf8'));
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    return Boolean(dependencies.react || dependencies['react-dom']);
  } catch {
    return false;
  }
}

function normalizeSetting(setting) {
  if (setting === 'auto') return { required: false, version: SHADSCAN_VERSION, failUnder: 0 };
  return { required: setting.mode === 'required', version: setting.version, failUnder: setting['fail-under'], baseline: setting.baseline };
}

function notApplicable(reason) {
  return { applicable: false, outcome: 'not-applicable', reason };
}

function runCli({ cwd, version, floor }) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['dlx', `@shadscan/cli@${version}`, '.', '--json', '--no-interactive', '--no-roast', '--fail-under', String(floor)], {
      cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
