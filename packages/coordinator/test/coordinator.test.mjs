import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthorizationError, ConformanceError, OidcCoordinator, ReceiptAggregator } from '../src/index.mjs';

const now = Date.UTC(2026, 8, 3);
const policy = {
  issuer: 'https://token.actions.githubusercontent.com',
  audience: 'verjson-ci-conformance',
  jwks: 'https://token.actions.githubusercontent.com/.well-known/jwks',
  capabilityTtlMs: 60_000,
  dispatchForge: 'gitlab',
  claims: {
    repository: 'Verjson/verjson-ci',
    ref_protected: 'true',
    job_workflow_ref: 'Verjson/verjson-ci/.github/workflows/remote-parity.yml@refs/heads/main',
  },
};

function harness(overrides = {}) {
  const consumed = new Set();
  const capabilities = new Map();
  return new OidcCoordinator({
    policies: { github: policy },
    verifier: { verify: async () => ({ jti: 'once', iat: now / 1000, exp: now / 1000 + 300, ...policy.claims }) },
    replayStore: { reserve: async (key) => !consumed.has(key) && Boolean(consumed.add(key)) },
    capabilityStore: {
      put: async (key, value) => capabilities.set(key, value),
      consume: async (key) => { const value = capabilities.get(key); capabilities.delete(key); return value; },
    },
    dispatcher: { dispatch: async (forge, request) => ({ forge, request }) },
    clock: () => now,
    ...overrides,
  });
}

test('authorizes exact protected workflow claims and dispatches once', async () => {
  const coordinator = harness();
  const grant = await coordinator.authorize('token', 'github');

  assert.deepEqual(await coordinator.dispatch(grant.capability, { scenario: 'success' }), {
    forge: 'gitlab', request: { scenario: 'success' },
  });
  await assert.rejects(() => coordinator.dispatch(grant.capability, {}), AuthorizationError);
});

test('rejects claim drift and token replay', async () => {
  const coordinator = harness();
  await coordinator.authorize('token', 'github');
  await assert.rejects(() => coordinator.authorize('token', 'github'), /replayed/);

  const wrongRepository = harness({
    verifier: { verify: async () => ({ jti: 'other', exp: now / 1000 + 60, ...policy.claims, repository: 'attacker/fork' }) },
  });
  await assert.rejects(() => wrongRepository.authorize('token', 'github'), /repository/);
});

test('rejects expired tokens and verifier failures', async () => {
  const expired = harness({ verifier: { verify: async () => ({ jti: 'old', exp: now / 1000, ...policy.claims }) } });
  await assert.rejects(() => expired.authorize('token', 'github'), /expired/);

  const invalid = harness({ verifier: { verify: async () => { throw new Error('bad signature'); } } });
  await assert.rejects(() => invalid.authorize('token', 'github'), /verification failed/);
});

test('fails closed until both signed receipts match', async () => {
  const receipts = new Map();
  const aggregator = new ReceiptAggregator({
    verifier: { verify: async (receipt) => receipt },
    receiptStore: {
      put: async (id, forge, receipt) => receipts.set(id, { ...receipts.get(id), [forge]: receipt }),
      get: async (id) => receipts.get(id) || {},
    },
  });

  assert.deepEqual(await aggregator.accept({ requestId: 'r1', forge: 'github', resultDigest: 'abc' }), { status: 'pending' });
  assert.deepEqual(await aggregator.accept({ requestId: 'r1', forge: 'gitlab', resultDigest: 'abc' }), {
    status: 'passed', resultDigest: 'abc',
  });
  await aggregator.accept({ requestId: 'r2', forge: 'github', resultDigest: 'abc' });
  assert.deepEqual(await aggregator.accept({ requestId: 'r2', forge: 'gitlab', resultDigest: 'def' }), {
    status: 'failed', reason: 'result-digest-mismatch',
  });
  await assert.rejects(() => aggregator.accept({ requestId: 'r3', forge: 'other', resultDigest: 'abc' }), ConformanceError);
});
