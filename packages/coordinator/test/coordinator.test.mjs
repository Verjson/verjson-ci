import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';

import { AuthorizationError, ConformanceError, JoseOidcVerifier, OidcCoordinator, ReceiptAggregator } from '../src/index.mjs';

const now = Math.floor(Date.now() / 1000) * 1000;
const digest = (character) => `sha256:${character.repeat(64)}`;
const dispatch = { fixtureProject: 'Verjson/conformance-fixtures', imageRepository: 'ghcr.io/verjson/ci', scenarios: ['success', 'failure'], receiptTtlMs: 60_000 };
const policies = {
  github: {
    issuer: 'https://token.actions.githubusercontent.com', audience: 'verjson-ci-conformance',
    jwks: 'https://token.actions.githubusercontent.com/.well-known/jwks', capabilityTtlMs: 60_000, dispatch,
    claims: { sub: 'repo:Verjson/verjson-ci:ref:refs/heads/main', repository: 'Verjson/verjson-ci', ref: 'refs/heads/main', ref_protected: 'true', job_workflow_ref: 'Verjson/verjson-ci/.github/workflows/remote-parity.yml@refs/heads/main' },
  },
  gitlab: {
    issuer: 'https://gitlab.example.com', audience: 'verjson-ci-conformance',
    jwks: 'https://gitlab.example.com/oauth/discovery/keys', capabilityTtlMs: 60_000, dispatch,
    claims: { sub: 'project_path:Verjson/verjson-ci:ref_type:branch:ref:main', project_path: 'Verjson/verjson-ci', ref: 'main', ref_protected: 'true', ci_config_ref_uri: 'gitlab.example.com/Verjson/verjson-ci//templates/remote-parity.yml@refs/heads/main' },
  },
};
const trustedJwks = Object.fromEntries(Object.values(policies).map((policy) => [policy.issuer, policy.jwks]));

function memoryReceiptStore() {
  const records = new Map();
  return {
    register: async (id, value) => !records.has(id) && Boolean(records.set(id, { ...value, receipts: {} })),
    get: async (id) => records.get(id),
    putIfAbsent: async (id, forge, receipt) => {
      const record = records.get(id);
      if (!record || record.receipts[forge]) return false;
      record.receipts[forge] = receipt;
      return true;
    },
    complete: async (id, result) => { const record = records.get(id); record.completed = result; },
  };
}

function coordinatorHarness(overrides = {}) {
  const capabilities = new Map(); const replay = new Set(); const dispatched = [];
  const receiptStore = memoryReceiptStore();
  const aggregator = overrides.aggregator || new ReceiptAggregator({
    verifier: { verify: async ({ signer, payload }) => ({ signer, payload }) }, receiptStore,
    signers: { github: 'github-key', gitlab: 'gitlab-key' }, clock: () => now,
  });
  const coordinator = new OidcCoordinator({
    policies, trustedJwks,
    verifier: { verify: async (_token, policy) => ({ jti: `identity-${policy.forge}`, iat: now / 1000, exp: now / 1000 + 300, sha: 'b'.repeat(40), ...policy.claims }) },
    replayStore: { reserve: async (key) => !replay.has(key) && Boolean(replay.add(key)) },
    capabilityStore: { put: async (key, value) => capabilities.set(key, value), consume: async (key) => { const value = capabilities.get(key); capabilities.delete(key); return value; } },
    dispatcher: { dispatch: async (forge, request) => dispatched.push({ forge, request }) },
    aggregator, clock: () => now, ...overrides,
  });
  return { aggregator, coordinator, dispatched };
}

test('validates complete forge policies and every exact identity claim', async () => {
  for (const forge of ['github', 'gitlab']) {
    const { coordinator } = coordinatorHarness();
    await coordinator.authorize('valid', forge);
    for (const claim of Object.keys(policies[forge].claims)) {
      const verifier = { verify: async () => ({ jti: `changed-${claim}`, iat: now / 1000, exp: now / 1000 + 60, sha: 'b'.repeat(40), ...policies[forge].claims, [claim]: 'attacker' }) };
      await assert.rejects(() => coordinatorHarness({ verifier }).coordinator.authorize('token', forge), new RegExp(claim));
    }
  }
  const incomplete = structuredClone(policies); delete incomplete.github.claims.sub;
  assert.throws(() => coordinatorHarness({ policies: incomplete }), /missing required github claim: sub/);
  const unknown = structuredClone(policies); unknown.gitlab.claims.typo = 'accepted';
  assert.throws(() => coordinatorHarness({ policies: unknown }), /unknown field: typo/);
});

test('authorizes locally signed GitHub and GitLab JWTs and isolates JWKS cache by issuer and URL', async () => {
  const keySets = new Map(); const tokens = {}; let factories = 0;
  for (const forge of ['github', 'gitlab']) {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey); jwk.kid = `${forge}-fixture`; jwk.alg = 'RS256';
    keySets.set(policies[forge].jwks, createLocalJWKSet({ keys: [jwk] }));
    tokens[forge] = await new SignJWT({ ...policies[forge].claims, jti: `signed-${forge}`, sha: 'b'.repeat(40) })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setIssuer(policies[forge].issuer)
      .setAudience(policies[forge].audience).setIssuedAt(now / 1000).setExpirationTime(now / 1000 + 60).sign(privateKey);
  }
  const verifier = new JoseOidcVerifier({ keySetFactory: (url) => { factories += 1; return keySets.get(url.href); } });
  for (const forge of ['github', 'gitlab']) await coordinatorHarness({ verifier }).coordinator.authorize(tokens[forge], forge);
  await verifier.verify(tokens.github, policies.github);
  assert.equal(factories, 2);
  keySets.set('https://token.actions.githubusercontent.com/alternate-jwks', keySets.get(policies.github.jwks));
  await verifier.verify(tokens.github, { ...policies.github, jwks: 'https://token.actions.githubusercontent.com/alternate-jwks' });
  assert.equal(factories, 3);
  await assert.rejects(() => new JoseOidcVerifier().verify(tokens.github, { ...policies.github, jwks: 'http://127.0.0.1/keys' }), /credential-free HTTPS/);
});

test('rejects unsafe JWKS mappings, incomplete time claims, replay, and verifier failure', async () => {
  assert.throws(() => coordinatorHarness({ trustedJwks: { ...trustedJwks, [policies.github.issuer]: 'https://example.com/keys' } }), /not trusted/);
  const missingIat = { verify: async () => ({ jti: 'identity-missing', exp: now / 1000 + 60, sha: 'b'.repeat(40), ...policies.github.claims }) };
  await assert.rejects(() => coordinatorHarness({ verifier: missingIat }).coordinator.authorize('token', 'github'), /temporal identity/);
  const { coordinator } = coordinatorHarness(); await coordinator.authorize('token', 'github');
  await assert.rejects(() => coordinator.authorize('token', 'github'), /replayed/);
  const invalid = coordinatorHarness({ verifier: { verify: async () => { throw new Error('signature detail'); } } }).coordinator;
  await assert.rejects(() => invalid.authorize('token', 'github'), /verification failed/);
});

test('binds one capability to a closed immutable request and dispatches both forge legs', async () => {
  const { coordinator, dispatched } = coordinatorHarness(); const grant = await coordinator.authorize('token', 'github');
  const input = { image: `ghcr.io/verjson/ci@${digest('a')}`, commit: 'b'.repeat(40), scenario: 'success', adapterVersion: '1.2.3' };
  const result = await coordinator.dispatch(grant.capability, input);
  assert.equal(result.status, 'pending'); assert.deepEqual(dispatched.map(({ forge }) => forge), ['github', 'gitlab']);
  assert.equal(dispatched[0].request.requestDigest, dispatched[1].request.requestDigest);
  await assert.rejects(() => coordinator.dispatch(grant.capability, input), AuthorizationError);
  for (const bad of [
    { ...input, extra: true }, { ...input, image: 'ghcr.io/verjson/ci:latest' },
    { ...input, image: `evil.example/ci@${digest('a')}` }, { ...input, commit: 'b'.repeat(39) }, { ...input, commit: 'c'.repeat(40) },
    { ...input, scenario: 'arbitrary' }, { ...input, adapterVersion: 'latest' },
  ]) {
    const fresh = coordinatorHarness().coordinator; const next = await fresh.authorize('token', 'github');
    await assert.rejects(() => fresh.dispatch(next.capability, bad), ConformanceError);
  }
});

test('accepts two independently signed bound receipts and rejects signer confusion and replay', async () => {
  const keys = {};
  for (const forge of ['github', 'gitlab']) keys[forge] = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const receiptStore = memoryReceiptStore();
  const verifier = { verify: async (token) => {
    const [signer] = token.split('.'); const forge = signer === 'github-key' ? 'github' : signer === 'gitlab-key' ? 'gitlab' : null;
    if (!forge) throw new ConformanceError('unknown key');
    return { signer, payload: (await jwtVerify(token.slice(signer.length + 1), keys[forge].publicKey)).payload };
  } };
  const aggregator = new ReceiptAggregator({ verifier, receiptStore, signers: { github: 'github-key', gitlab: 'gitlab-key' }, clock: () => now });
  const { coordinator, dispatched } = coordinatorHarness({ aggregator }); const grant = await coordinator.authorize('token', 'github');
  const input = { image: `ghcr.io/verjson/ci@${digest('a')}`, commit: 'b'.repeat(40), scenario: 'success', adapterVersion: '1.2.3' };
  const { requestId } = await coordinator.dispatch(grant.capability, input); const request = dispatched[0].request;
  const sign = async (forge, changes = {}) => {
    const payload = { requestId, nonce: request.nonce, requestDigest: request.requestDigest, candidateDigest: input.image, commit: input.commit, scenario: input.scenario, adapter: forge === 'github' ? 'github-action' : 'gitlab-component', adapterVersion: input.adapterVersion, resultDigest: digest('c'), iat: now / 1000, exp: now / 1000 + 60, ...changes };
    return `${forge}-key.${await new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA' }).sign(keys[forge].privateKey)}`;
  };
  const concurrent = await Promise.allSettled([aggregator.accept(await sign('github')), aggregator.accept(await sign('github'))]);
  assert.equal(concurrent.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.match(concurrent.find(({ status }) => status === 'rejected').reason.message, /already submitted/);
  assert.deepEqual(await aggregator.accept(await sign('gitlab')), { status: 'passed', resultDigest: digest('c') });
  await assert.rejects(async () => aggregator.accept(await sign('gitlab')), /already completed/);

  const other = coordinatorHarness({ aggregator }); const otherGrant = await other.coordinator.authorize('token', 'github');
  const second = await other.coordinator.dispatch(otherGrant.capability, input); const secondRequest = other.dispatched[0].request;
  await assert.rejects(async () => aggregator.accept(await sign('github', { requestId: second.requestId, nonce: secondRequest.nonce })), /requestDigest/);
  await assert.rejects(async () => aggregator.accept(await sign('github', { requestId: second.requestId, nonce: secondRequest.nonce, requestDigest: secondRequest.requestDigest, adapter: 'gitlab-component' })), /invalid conformance receipt/);
});

test('fails closed for missing, expired, and mismatched evidence', async () => {
  const receiptStore = memoryReceiptStore(); const aggregator = new ReceiptAggregator({ verifier: { verify: async (value) => value }, receiptStore, signers: { github: 'g', gitlab: 'l' }, clock: () => now });
  assert.deepEqual(await aggregator.verdict('missing'), { status: 'failed', reason: 'evidence-unavailable' });
  const request = { requestId: 'expired', nonce: 'n', requestDigest: digest('d'), candidateDigest: `ghcr.io/verjson/ci@${digest('a')}`, commit: 'b'.repeat(40), scenario: 'success', adapterVersion: '1.2.3' };
  await aggregator.register(request, now - 1);
  assert.deepEqual(await aggregator.verdict('expired'), { status: 'failed', reason: 'evidence-unavailable' });

  const live = { ...request, requestId: 'mismatch' };
  await aggregator.register(live, now + 60_000);
  const receipt = (signer, forge, resultDigest) => ({ signer, payload: {
    requestId: live.requestId, nonce: live.nonce, requestDigest: live.requestDigest,
    candidateDigest: live.candidateDigest, commit: live.commit, scenario: live.scenario,
    adapter: forge === 'github' ? 'github-action' : 'gitlab-component', adapterVersion: live.adapterVersion,
    resultDigest, iat: now / 1000, exp: now / 1000 + 60,
  } });
  await aggregator.accept(receipt('g', 'github', digest('a')));
  assert.deepEqual(await aggregator.accept(receipt('l', 'gitlab', digest('b'))), { status: 'failed', reason: 'result-digest-mismatch' });
});
