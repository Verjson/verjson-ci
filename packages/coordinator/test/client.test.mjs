import assert from 'node:assert/strict';
import test from 'node:test';

import { coordinatorRequest, normalizeCoordinatorOrigin } from '../src/client.mjs';

test('rejects alternate token destinations before making a request', async () => {
  let requests = 0;
  const fetchImpl = async () => { requests += 1; return new Response(null, { status: 200 }); };
  for (const origin of ['http://coordinator.example', 'https://user@coordinator.example', 'https://coordinator.example/path', 'https://coordinator.example/?next=evil', 'not-a-url']) {
    await assert.rejects(() => coordinatorRequest(origin, '/v1/authorize/github', {}, { fetchImpl }), /coordinator origin/);
  }
  assert.equal(requests, 0);
});

test('normalizes one HTTPS origin and disables redirects with a deadline', async () => {
  let observed;
  const fetchImpl = async (url, options) => { observed = { url, options }; throw new TypeError('redirect blocked'); };
  assert.equal(normalizeCoordinatorOrigin('https://coordinator.example/'), 'https://coordinator.example');
  await assert.rejects(() => coordinatorRequest('https://coordinator.example', '/v1/authorize/github', {}, { fetchImpl, timeoutMs: 10 }), /redirect blocked/);
  assert.equal(observed.url, 'https://coordinator.example/v1/authorize/github');
  assert.equal(observed.options.redirect, 'error');
  assert.ok(observed.options.signal instanceof AbortSignal);
});

test('aborts a stalled coordinator request', async () => {
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  await assert.rejects(() => coordinatorRequest('https://coordinator.example', '/v1/verdict/request', {}, { fetchImpl, timeoutMs: 1 }), /aborted|timeout/i);
});
