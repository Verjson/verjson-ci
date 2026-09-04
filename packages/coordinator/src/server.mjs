import { createServer } from 'node:http';

import { AuthorizationError, ConformanceError } from './index.mjs';

class PayloadTooLargeError extends Error {}

export function createCoordinatorServer({ coordinator, aggregator }) {
  return createServer({ headersTimeout: 10_000, requestTimeout: 15_000, keepAliveTimeout: 5_000, maxHeaderSize: 16_384 }, async (request, response) => {
    try {
      const body = request.method === 'POST' ? await readJson(request) : null;
      const authorize = request.url?.match(/^\/v1\/authorize\/(github|gitlab)$/);
      if (request.method === 'POST' && authorize) {
        return send(response, 200, await coordinator.authorize(body?.token, authorize[1]));
      }
      if (request.method === 'POST' && request.url === '/v1/dispatch') {
        const capability = bearer(request.headers.authorization);
        return send(response, 202, await coordinator.dispatch(capability, body));
      }
      if (request.method === 'POST' && request.url === '/v1/receipts') {
        return send(response, 200, await aggregator.accept(body));
      }
      const verdict = request.url?.match(/^\/v1\/verdict\/([0-9A-Za-z._-]+)$/);
      if (request.method === 'GET' && verdict) return send(response, 200, await aggregator.verdict(verdict[1]));
      send(response, 404, { error: 'not found' });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return send(response, 413, { error: error.message });
      if (error instanceof AuthorizationError) return send(response, 401, { error: error.message });
      if (error instanceof ConformanceError || error instanceof SyntaxError) return send(response, 400, { error: error.message });
      send(response, 500, { error: 'coordinator failure' });
    }
  });
}

async function readJson(request) {
  const chunks = [];
  let received = 0;
  for await (const chunk of request) {
    received += chunk.length;
    if (received > 65_536) {
      request.resume();
      throw new PayloadTooLargeError('request body too large');
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function bearer(header = '') {
  const match = header.match(/^Bearer ([0-9A-Za-z-]+)$/);
  if (!match) throw new AuthorizationError('dispatch capability missing');
  return match[1];
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(`${JSON.stringify(body)}\n`);
}
