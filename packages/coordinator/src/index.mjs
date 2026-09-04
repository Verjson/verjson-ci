import { createHash, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthorizationError extends Error {}
export class ConformanceError extends Error {}

const FORGE_CLAIMS = {
  github: ['sub', 'repository', 'ref', 'ref_protected', 'job_workflow_ref'],
  gitlab: ['sub', 'project_path', 'ref', 'ref_protected', 'ci_config_ref_uri'],
};
const RECEIPT_KEYS = ['adapter', 'adapterVersion', 'candidateDigest', 'commit', 'exp', 'iat', 'nonce', 'requestDigest', 'requestId', 'resultDigest', 'scenario'];
const ADAPTERS = { github: 'github-action', gitlab: 'gitlab-component' };
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

export class JoseOidcVerifier {
  #keySets = new Map();
  constructor({ keySetFactory = (url) => createRemoteJWKSet(url) } = {}) { this.keySetFactory = keySetFactory; }
  async verify(token, { issuer, audience, jwks }) {
    const normalized = normalizeHttpsUrl(jwks, 'JWKS URL', true).href;
    const cacheKey = `${issuer}\0${normalized}`;
    let keySet = this.#keySets.get(cacheKey);
    if (!keySet) {
      keySet = this.keySetFactory(new URL(normalized));
      this.#keySets.set(cacheKey, keySet);
    }
    return (await jwtVerify(token, keySet, { issuer, audience })).payload;
  }
}

export class OidcCoordinator {
  constructor({ policies, trustedJwks, verifier, replayStore, capabilityStore, dispatcher, aggregator, clock = () => Date.now() }) {
    this.policies = validatePolicies(policies, trustedJwks);
    Object.assign(this, { verifier, replayStore, capabilityStore, dispatcher, aggregator, clock });
  }
  async authorize(token, forge) {
    const policy = this.policies[forge];
    if (!policy) throw new AuthorizationError(`unsupported forge: ${forge}`);
    let claims;
    try { claims = await this.verifier.verify(token, policy); }
    catch (error) { throw new AuthorizationError('OIDC verification failed', { cause: error }); }
    validateClaims(claims, policy, this.clock());
    if (!await this.replayStore.reserve(`${policy.issuer}:${claims.jti}`, claims.exp * 1000)) throw new AuthorizationError('OIDC token replayed');
    const capability = randomUUID();
    const expiresAt = Math.min(claims.exp * 1000, this.clock() + policy.capabilityTtlMs);
    await this.capabilityStore.put(capability, { forge, commit: claims.sha, dispatch: policy.dispatch, expiresAt });
    return { capability, expiresAt };
  }
  async dispatch(capability, input) {
    const grant = await this.capabilityStore.consume(capability);
    if (!grant || grant.expiresAt <= this.clock()) throw new AuthorizationError('dispatch capability invalid or expired');
    const request = validateDispatch(input, grant.dispatch, grant.commit);
    const constraints = {
      requestId: randomUUID(), nonce: randomUUID(), candidateDigest: request.image,
      commit: request.commit, scenario: request.scenario, adapterVersion: request.adapterVersion,
      fixtureProject: grant.dispatch.fixtureProject,
    };
    constraints.requestDigest = digestRequest(constraints);
    await this.aggregator.register(constraints, this.clock() + grant.dispatch.receiptTtlMs);
    await Promise.all(['github', 'gitlab'].map((forge) => this.dispatcher.dispatch(forge, constraints)));
    return { requestId: constraints.requestId, status: 'pending' };
  }
}

export class ReceiptAggregator {
  constructor({ verifier, receiptStore, signers, clock = () => Date.now() }) {
    Object.assign(this, { verifier, receiptStore, clock });
    this.signers = new Map(Object.entries(signers || {}).map(([forge, signer]) => [signer, forge]));
    if (this.signers.size !== 2 || !Object.keys(ADAPTERS).every((forge) => [...this.signers.values()].includes(forge))) throw new TypeError('one independent signer is required for each forge');
  }
  async register(request, expiresAt) {
    if (!await this.receiptStore.register(request.requestId, { request, expiresAt })) throw new ConformanceError('conformance request already registered');
  }
  async accept(signedReceipt) {
    const verified = await this.verifier.verify(signedReceipt);
    const forge = this.signers.get(verified.signer);
    if (!forge) throw new ConformanceError('untrusted receipt signer');
    const receipt = validateReceipt(verified.payload, forge, this.clock());
    const record = await this.receiptStore.get(receipt.requestId);
    if (!record || record.expiresAt <= this.clock()) throw new ConformanceError('unknown or expired conformance request');
    if (record.completed) throw new ConformanceError('conformance request already completed');
    assertReceiptBound(receipt, record.request, forge);
    if (!await this.receiptStore.putIfAbsent(receipt.requestId, forge, receipt)) throw new ConformanceError('receipt already submitted');
    return this.verdict(receipt.requestId);
  }
  async verdict(requestId) {
    const record = await this.receiptStore.get(requestId);
    if (!record || record.expiresAt <= this.clock()) return { status: 'failed', reason: 'evidence-unavailable' };
    const { github, gitlab } = record.receipts || {};
    if (!github || !gitlab) return { status: 'pending' };
    const result = github.resultDigest === gitlab.resultDigest ? { status: 'passed', resultDigest: github.resultDigest } : { status: 'failed', reason: 'result-digest-mismatch' };
    await this.receiptStore.complete(requestId, result);
    return result;
  }
}

function validatePolicies(policies, trustedJwks) {
  if (!policies || !trustedJwks) throw new TypeError('policies and trusted JWKS mappings are required');
  const issuers = new Map(); const validated = {};
  rejectUnknownKeys(policies, Object.keys(FORGE_CLAIMS), 'policies');
  for (const forge of Object.keys(FORGE_CLAIMS)) {
    const policy = policies[forge];
    if (!policy) throw new TypeError(`missing ${forge} policy`);
    rejectUnknownKeys(policy, ['audience', 'capabilityTtlMs', 'claims', 'dispatch', 'issuer', 'jwks'], `${forge} policy`);
    normalizeHttpsUrl(policy.issuer, `${forge} issuer`);
    if (typeof policy.audience !== 'string' || !policy.audience) throw new TypeError(`${forge} audience is required`);
    const jwks = normalizeHttpsUrl(policy.jwks, `${forge} JWKS URL`, true).href;
    if (trustedJwks[policy.issuer] !== jwks) throw new TypeError(`${forge} issuer-to-JWKS mapping is not trusted`);
    if (issuers.has(policy.issuer) && issuers.get(policy.issuer) !== jwks) throw new TypeError('conflicting JWKS policies for issuer');
    issuers.set(policy.issuer, jwks);
    const required = FORGE_CLAIMS[forge];
    rejectUnknownKeys(policy.claims || {}, required, `${forge} claims`);
    for (const claim of required) if (!(claim in (policy.claims || {}))) throw new TypeError(`missing required ${forge} claim: ${claim}`);
    for (const claim of required) if (typeof policy.claims[claim] !== 'string' || !policy.claims[claim]) throw new TypeError(`${forge} claim ${claim} must be one exact value`);
    validateDispatchPolicy(policy.dispatch);
    if (!Number.isInteger(policy.capabilityTtlMs) || policy.capabilityTtlMs < 1 || policy.capabilityTtlMs > 60_000) throw new TypeError('capability TTL must be between 1 and 60000 ms');
    validated[forge] = { ...policy, forge, jwks };
  }
  return validated;
}

function validateDispatchPolicy(dispatch) {
  rejectUnknownKeys(dispatch || {}, ['fixtureProject', 'imageRepository', 'receiptTtlMs', 'scenarios'], 'dispatch policy');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(dispatch?.fixtureProject || '')) throw new TypeError('invalid fixture project');
  if (!/^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+$/.test(dispatch?.imageRepository || '')) throw new TypeError('invalid image repository');
  if (!Array.isArray(dispatch?.scenarios) || !dispatch.scenarios.length || dispatch.scenarios.some((item) => !/^[a-z0-9-]+$/.test(item))) throw new TypeError('invalid dispatch scenarios');
  if (!Number.isInteger(dispatch.receiptTtlMs) || dispatch.receiptTtlMs < 1_000 || dispatch.receiptTtlMs > 900_000) throw new TypeError('invalid receipt TTL');
}

function validateClaims(claims, policy, nowMs) {
  const now = Math.floor(nowMs / 1000);
  if (typeof claims.jti !== 'string' || claims.jti.length < 8 || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) throw new AuthorizationError('OIDC token missing temporal identity claims');
  if (claims.exp <= now || claims.iat > now + 30 || claims.iat < now - 600 || claims.exp - claims.iat > 600) throw new AuthorizationError('OIDC token outside accepted lifetime');
  if (!COMMIT.test(claims.sha || '')) throw new AuthorizationError('OIDC token missing immutable commit identity');
  for (const [claim, expected] of Object.entries(policy.claims)) {
    const actual = claims[claim];
    if (!(Array.isArray(expected) ? expected.includes(actual) : actual === expected)) throw new AuthorizationError(`OIDC claim rejected: ${claim}`);
  }
}

function validateDispatch(input, policy, authorizedCommit) {
  rejectUnknownKeys(input || {}, ['adapterVersion', 'commit', 'image', 'scenario'], 'dispatch request');
  if (typeof input?.image !== 'string' || !input.image.startsWith(`${policy.imageRepository}@`) || !SHA256.test(input.image.slice(policy.imageRepository.length + 1))) throw new ConformanceError('candidate image is not an allowed immutable digest');
  if (!COMMIT.test(input.commit || '')) throw new ConformanceError('commit must be a full lowercase SHA');
  if (input.commit !== authorizedCommit) throw new ConformanceError('commit does not match authenticated workload');
  if (!policy.scenarios.includes(input.scenario)) throw new ConformanceError('scenario is not allowed');
  if (!VERSION.test(input.adapterVersion || '')) throw new ConformanceError('adapter version must be SemVer');
  return input;
}

function validateReceipt(payload, forge, nowMs) {
  rejectUnknownKeys(payload || {}, RECEIPT_KEYS, 'receipt');
  for (const key of RECEIPT_KEYS) if (!(key in (payload || {}))) throw new ConformanceError(`receipt missing ${key}`);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.iat > now + 30 || payload.iat < now - 900 || payload.exp <= now || payload.exp - payload.iat > 900) throw new ConformanceError('receipt outside accepted lifetime');
  if (payload.adapter !== ADAPTERS[forge] || !SHA256.test(payload.resultDigest) || !SHA256.test(payload.requestDigest)) throw new ConformanceError('invalid conformance receipt');
  return payload;
}

function assertReceiptBound(receipt, request, forge) {
  const expected = { adapter: ADAPTERS[forge], adapterVersion: request.adapterVersion, candidateDigest: request.candidateDigest, commit: request.commit, nonce: request.nonce, requestDigest: request.requestDigest, requestId: request.requestId, scenario: request.scenario };
  for (const [key, value] of Object.entries(expected)) if (receipt[key] !== value) throw new ConformanceError(`receipt is not bound to request: ${key}`);
}

function digestRequest(request) {
  return `sha256:${createHash('sha256').update(JSON.stringify([request.requestId, request.nonce, request.candidateDigest, request.commit, request.scenario, request.adapterVersion, request.fixtureProject])).digest('hex')}`;
}
function rejectUnknownKeys(value, allowed, label) {
  const unknown = Object.keys(value || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ConformanceError(`${label} contains unknown field: ${unknown[0]}`);
}
function normalizeHttpsUrl(value, label, allowPath = false) {
  let url; try { url = new URL(value); } catch { throw new TypeError(`${label} is invalid`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (!allowPath && url.pathname !== '/')) throw new TypeError(`${label} must be a credential-free HTTPS URL`);
  return url;
}
