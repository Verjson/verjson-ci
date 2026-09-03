import { randomUUID } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify } from 'jose';

export class AuthorizationError extends Error {}
export class ConformanceError extends Error {}

export class JoseOidcVerifier {
  #jwksByIssuer = new Map();

  async verify(token, { issuer, audience, jwks }) {
    let keySet = this.#jwksByIssuer.get(issuer);
    if (!keySet) {
      keySet = createRemoteJWKSet(new URL(jwks));
      this.#jwksByIssuer.set(issuer, keySet);
    }
    const { payload } = await jwtVerify(token, keySet, { issuer, audience });
    return payload;
  }
}

export class OidcCoordinator {
  constructor({ policies, verifier, replayStore, capabilityStore, dispatcher, clock = () => Date.now() }) {
    this.policies = policies;
    this.verifier = verifier;
    this.replayStore = replayStore;
    this.capabilityStore = capabilityStore;
    this.dispatcher = dispatcher;
    this.clock = clock;
  }

  async authorize(token, forge) {
    const policy = this.policies[forge];
    if (!policy) throw new AuthorizationError(`unsupported forge: ${forge}`);

    let claims;
    try {
      claims = await this.verifier.verify(token, policy);
    } catch (error) {
      throw new AuthorizationError('OIDC verification failed', { cause: error });
    }
    validateClaims(claims, policy, this.clock());

    const replayKey = `${policy.issuer}:${claims.jti}`;
    if (!await this.replayStore.reserve(replayKey, claims.exp * 1000)) {
      throw new AuthorizationError('OIDC token replayed');
    }

    const capability = randomUUID();
    const expiresAt = Math.min(claims.exp * 1000, this.clock() + policy.capabilityTtlMs);
    await this.capabilityStore.put(capability, { forge, expiresAt });
    return { capability, expiresAt };
  }

  async dispatch(capability, request) {
    const grant = await this.capabilityStore.consume(capability);
    if (!grant || grant.expiresAt <= this.clock()) {
      throw new AuthorizationError('dispatch capability invalid or expired');
    }
    return this.dispatcher.dispatch(grant.forge, request);
  }
}

export class ReceiptAggregator {
  constructor({ verifier, receiptStore }) {
    this.verifier = verifier;
    this.receiptStore = receiptStore;
  }

  async accept(signedReceipt) {
    const receipt = await this.verifier.verify(signedReceipt);
    if (!['github', 'gitlab'].includes(receipt.forge) || !receipt.requestId || !receipt.resultDigest) {
      throw new ConformanceError('invalid conformance receipt');
    }
    await this.receiptStore.put(receipt.requestId, receipt.forge, receipt);
    return this.verdict(receipt.requestId);
  }

  async verdict(requestId) {
    const receipts = await this.receiptStore.get(requestId);
    const github = receipts.github;
    const gitlab = receipts.gitlab;
    if (!github || !gitlab) return { status: 'pending' };
    if (github.resultDigest !== gitlab.resultDigest) {
      return { status: 'failed', reason: 'result-digest-mismatch' };
    }
    return { status: 'passed', resultDigest: github.resultDigest };
  }
}

function validateClaims(claims, policy, nowMs) {
  const now = Math.floor(nowMs / 1000);
  if (!claims.jti || !Number.isInteger(claims.exp) || claims.exp <= now) {
    throw new AuthorizationError('OIDC token missing identity or expired');
  }
  if (claims.iat && claims.iat > now + 30) throw new AuthorizationError('OIDC token issued in future');
  for (const [claim, expected] of Object.entries(policy.claims)) {
    const actual = claims[claim];
    const accepted = Array.isArray(expected) ? expected.includes(actual) : actual === expected;
    if (!accepted) throw new AuthorizationError(`OIDC claim rejected: ${claim}`);
  }
}
