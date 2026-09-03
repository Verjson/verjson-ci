import assert from 'node:assert/strict';
import test from 'node:test';

import { AuthorizationError } from '../src/index.mjs';
import { createCoordinatorServer } from '../src/server.mjs';

async function withServer(callback) {
  const server = createCoordinatorServer({
    coordinator: {
      authorize: async (token, forge) => {
        if (token !== 'valid') throw new AuthorizationError('OIDC verification failed');
        return { capability: `${forge}-capability`, expiresAt: 1 };
      },
      dispatch: async (capability, request) => ({ capability, request }),
    },
    aggregator: {
      accept: async () => ({ status: 'pending' }),
      verdict: async () => ({ status: 'pending' }),
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('exchanges a verified job token for one opaque dispatch call', async () => {
  await withServer(async (url) => {
    const authorization = await fetch(`${url}/v1/authorize/github`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'valid' }),
    });
    assert.equal(authorization.status, 200);
    const grant = await authorization.json();
    const dispatch = await fetch(`${url}/v1/dispatch`, {
      method: 'POST', headers: { authorization: `Bearer ${grant.capability}`, 'content-type': 'application/json' }, body: JSON.stringify({ scenario: 'success' }),
    });
    assert.equal(dispatch.status, 202);
    assert.equal((await dispatch.json()).request.scenario, 'success');
  });
});

test('returns bounded errors without leaking verifier details', async () => {
  await withServer(async (url) => {
    const invalid = await fetch(`${url}/v1/authorize/github`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'invalid' }),
    });
    assert.equal(invalid.status, 401);
    assert.deepEqual(await invalid.json(), { error: 'OIDC verification failed' });

    const oversized = await fetch(`${url}/v1/receipts`, { method: 'POST', body: 'x'.repeat(65_537) });
    assert.equal(oversized.status, 400);
  });
});
