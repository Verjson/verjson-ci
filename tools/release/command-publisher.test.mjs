import assert from 'node:assert/strict';
import test from 'node:test';
import { commandPublisher, validatePlan } from './command-publisher.mjs';
import { REQUIRED_ENDPOINT_IDS } from './manifest.mjs';

const plan = REQUIRED_ENDPOINT_IDS.map((id, index) => ({ id, digest: `sha256:${String(index + 1).repeat(64)}`, observe: ['endpoint', 'observe', id], create: ['endpoint', 'create', id] }));

test('public publisher uses the exact closed endpoint plan and create-only observation', async () => {
  const published = new Map(); const calls = [];
  const run = async (command) => {
    calls.push(command.join(' ')); const [, operation, id] = command; const endpoint = plan.find((item) => item.id === id);
    if (operation === 'observe') return published.has(id) ? { stdout: `${published.get(id)}\n`, missing: false } : { stdout: '', missing: true };
    if (published.has(id)) throw new Error('overwrite attempted'); published.set(id, endpoint.digest); return { stdout: '', missing: false };
  };
  const publisher = commandPublisher(plan, run); const endpoint = (await publisher.endpoints())[0];
  assert.equal(await publisher.readDigest(endpoint), undefined); await publisher.create(endpoint); assert.equal(await publisher.readDigest(endpoint), endpoint.digest);
  assert.deepEqual(calls, [`endpoint observe ${endpoint.id}`, `endpoint create ${endpoint.id}`, `endpoint observe ${endpoint.id}`]);
});

test('public endpoint plan rejects omissions duplicates unknown endpoints and mutable commands', () => {
  for (const invalid of [plan.slice(1), [...plan.slice(0, -1), plan[0]], [...plan.slice(0, -1), { ...plan[0], id: 'unknown' }], plan.map((item, index) => index ? item : { ...item, create: [] })]) assert.throws(() => validatePlan(invalid));
});
