import { createHash } from 'node:crypto';
import { readFile as readFileFromDisk } from 'node:fs/promises';
import catalog from '../packs/catalog.json' with { type: 'json' };

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export class CompliancePackError extends Error {
  constructor(message, options) { super(message, options); this.name = 'CompliancePackError'; }
}

export class ComplianceBoundaryError extends Error {
  constructor(message) { super(message); this.name = 'ComplianceBoundaryError'; }
}

const PACKS = loadCatalog(catalog);

export const FRAMEWORK_PACKS = Object.freeze(Object.entries(PACKS).map(([identity, pack]) => {
  const separator = identity.lastIndexOf('@');
  return Object.freeze({ id: identity.slice(0, separator), version: identity.slice(separator + 1), digest: pack.digest });
}));

function loadCatalog(value) {
  if (value?.schema !== 1 || !Array.isArray(value.packs) || value.packs.length === 0 || Object.keys(value).sort().join() !== 'packs,schema') throw new CompliancePackError('compliance pack catalog malformed');
  const entries = value.packs.map((entry) => {
    exact(entry, ['id', 'version', 'path', 'digest'], 'pack catalog entry');
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(entry.id) || !/^\d+\.\d+\.\d+$/.test(entry.version) || entry.path !== `${entry.id}/${entry.version}.json` || !DIGEST.test(entry.digest)) throw new CompliancePackError('compliance pack catalog entry malformed');
    return [`${entry.id}@${entry.version}`, Object.freeze({ url: new URL(`../packs/${entry.path}`, import.meta.url), digest: entry.digest })];
  });
  if (new Set(entries.map(([identity]) => identity)).size !== entries.length) throw new CompliancePackError('duplicate compliance pack catalog identity');
  return Object.freeze(Object.fromEntries(entries));
}

export async function loadFrameworkPack(reference, options = {}) {
  const identity = `${reference?.id}@${reference?.version}`;
  const registered = PACKS[identity];
  if (!registered) throw new CompliancePackError(`unknown compliance framework pack: ${identity}`);
  let bytes;
  try {
    bytes = await (options.readFile ?? readFileFromDisk)(registered.url);
  } catch (error) {
    throw new CompliancePackError(`compliance framework pack unavailable: ${identity}`, { cause: error });
  }
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (buffer.byteLength > 1024 * 1024) throw new CompliancePackError(`compliance framework pack exceeds 1 MiB: ${identity}`);
  const digest = sha256(buffer);
  if (digest !== registered.digest) throw new CompliancePackError(`compliance framework pack integrity mismatch: ${identity}`);
  let pack;
  try { pack = JSON.parse(buffer); }
  catch (error) { throw new CompliancePackError(`compliance framework pack malformed: ${identity}`, { cause: error }); }
  validatePack(pack, reference);
  return { ...pack, digest, path: registered.url };
}

export async function evaluateCompliance(configuration, observations, options = {}) {
  const normalized = configuration === 'auto'
    ? { frameworks: FRAMEWORK_PACKS.map(({ id, version }) => ({ id, version })), mode: 'report' }
    : configuration;
  const frameworks = [];
  for (const reference of normalized.frameworks) {
    const pack = await loadFrameworkPack(reference, options);
    const controls = pack.controls.map((control) => evaluateControl(control, observations));
    frameworks.push({ id: pack.id, version: pack.version, packDigest: pack.digest, controls, coverage: coverage(controls) });
  }
  const artifact = { schema: 1, frameworks };
  const artifactBytes = `${canonicalBytes(artifact)}\n`;
  const artifactDigest = sha256(artifactBytes);
  const controls = frameworks.flatMap((framework) => framework.controls.map((control) => ({
    framework: framework.id, frameworkVersion: framework.version, id: control.id, blocking: control.blocking,
    status: control.status, evidenceDigest: control.evidenceDigest,
  })));
  const satisfiedPercent = controls.length === 0 ? 0 : Math.floor((controls.filter(({ status }) => status === 'satisfied').length * 100) / controls.length);
  const blockingFailure = controls.some(({ blocking, status }) => blocking && status === 'unsatisfied');
  const baselineFailure = normalized.baseline !== undefined && satisfiedPercent < normalized.baseline;
  return {
    artifactBytes,
    failed: normalized.mode === 'required' && (blockingFailure || baselineFailure),
    result: {
      mode: normalized.mode, baseline: normalized.baseline, artifactDigest, satisfiedPercent,
      frameworks: frameworks.map(({ id, version, packDigest, coverage: value }) => ({ id, version, packDigest, coverage: value })),
      controls,
    },
  };
}

export function verifyComplianceParity(github, gitlab) {
  for (const [forge, leg] of [['github', github], ['gitlab', gitlab]]) {
    if (!leg?.result || typeof leg.artifactBytes !== 'string') throw new ComplianceBoundaryError(`${forge} compliance evidence unavailable`);
    if (!DIGEST.test(leg.result.artifactDigest) || sha256(leg.artifactBytes) !== leg.result.artifactDigest) throw new ComplianceBoundaryError(`${forge} compliance evidence digest mismatch`);
  }
  if (github.artifactBytes !== gitlab.artifactBytes || canonicalBytes(github.result) !== canonicalBytes(gitlab.result)) throw new ComplianceBoundaryError('GitHub and GitLab compliance evidence differ');
  return github.result.artifactDigest;
}

function evaluateControl(control, observations) {
  const evidence = resolveEvidence(control.evidence, observations);
  return { id: control.id, blocking: control.blocking, status: evidence.status, evidenceDigest: sha256(canonicalBytes(evidence)), evidence };
}

function resolveEvidence(mapping, observations) {
  if (mapping.kind === 'commands-all') {
    const commands = observations.commands ?? [];
    if (commands.length === 0) return evidence('commands-all', 'commands', 'not-automated', { outcomes: [] });
    const outcomes = commands.map(({ name, outcome, exitCode, signal }) => ({ name, outcome, exitCode, signal })).sort((left, right) => left.name.localeCompare(right.name));
    return evidence('commands-all', 'commands', outcomes.every(({ outcome }) => outcome === 'success') ? 'satisfied' : 'unsatisfied', { outcomes });
  }
  if (mapping.kind === 'file-any') {
    const present = [...new Set(observations.files ?? [])].filter((name) => mapping.names.includes(name)).sort();
    return evidence('file-any', 'dependency-lockfile', present.length > 0 ? 'satisfied' : 'unsatisfied', { present });
  }
  const capability = observations.capabilities?.[mapping.name];
  if (!capability) return evidence('capability', mapping.name, 'not-automated', { applicable: null, outcome: null });
  if (capability.applicable === false) return evidence('capability', mapping.name, 'not-applicable', { applicable: false, outcome: capability.outcome ?? null });
  return evidence('capability', mapping.name, capability.outcome === 'success' ? 'satisfied' : 'unsatisfied', { applicable: capability.applicable ?? true, outcome: capability.outcome ?? null });
}

function evidence(kind, ref, status, facts) { return { kind, ref, status, facts }; }
function coverage(controls) {
  return { total: controls.length, automated: controls.filter(({ status }) => !['not-automated', 'not-applicable'].includes(status)).length, satisfied: controls.filter(({ status }) => status === 'satisfied').length };
}

function validatePack(pack, reference) {
  exact(pack, ['schema', 'id', 'version', 'controls'], 'pack');
  if (pack.schema !== 1 || pack.id !== reference.id || pack.version !== reference.version || !Array.isArray(pack.controls) || pack.controls.length === 0 || pack.controls.length > 2048) throw new CompliancePackError('compliance framework pack identity malformed');
  const ids = new Set();
  for (const control of pack.controls) {
    exact(control, ['id', 'blocking', 'evidence'], 'control');
    if (!/^[A-Z][A-Z0-9-]{1,63}$/.test(control.id) || ids.has(control.id) || typeof control.blocking !== 'boolean') throw new CompliancePackError('compliance framework control malformed');
    ids.add(control.id);
    validateMapping(control.evidence);
  }
}

function validateMapping(mapping) {
  if (mapping?.kind === 'commands-all') return exact(mapping, ['kind'], 'command evidence mapping');
  if (mapping?.kind === 'file-any') {
    exact(mapping, ['kind', 'names'], 'file evidence mapping');
    if (!Array.isArray(mapping.names) || mapping.names.length === 0 || mapping.names.length > 32 || new Set(mapping.names).size !== mapping.names.length || mapping.names.some((name) => !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(name))) throw new CompliancePackError('file evidence mapping malformed');
    return;
  }
  if (mapping?.kind === 'capability') {
    exact(mapping, ['kind', 'name'], 'capability evidence mapping');
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(mapping.name)) throw new CompliancePackError('capability evidence mapping malformed');
    return;
  }
  throw new CompliancePackError('unknown compliance evidence mapping');
}

function exact(value, keys, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new CompliancePackError(`${name} has invalid properties`);
}
function canonicalBytes(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalBytes).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalBytes(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sha256(value) { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
