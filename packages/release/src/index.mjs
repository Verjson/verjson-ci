import { buildManifest, completeManifest, manifestDigest, objectDigest, quarantineManifest, REQUIRED_ENDPOINT_IDS, validateManifest } from '../../../tools/release/manifest.mjs';

export class ReleaseConflictError extends Error {}
export class ReleaseQuarantinedError extends Error { constructor(message, manifest, options) { super(message, options); this.manifest = manifest; } }

export class ReleaseOrchestrator {
  constructor({ license, store, builder, conformance, receiptVerifier, signer, publisher }) { Object.assign(this, { license, store, builder, conformance, receiptVerifier, signer, publisher }); }

  async release(candidate) {
    validateCandidate(candidate);
    if (!candidate.dryRun) await this.license.assertPublishable();
    let release = await this.store.reserve(candidate.version, candidate.commit, this.signer.identity);
    if (release === 'conflict') throw new ReleaseConflictError('release version already belongs to another commit');
    release = await this.#verifyHistory(release, candidate);
    if (release.recoveryNeeded) release = await this.store.recover(release);
    if (release.state === 'complete') {
      await this.#observeCompleted(release, release.manifest, candidate.dryRun);
      return release.manifest;
    }
    if (release.state === 'quarantined' && !release.retryable) throw new ReleaseQuarantinedError('release has a terminal quarantine', release.manifest);
    let staged = release.manifest?.state === 'staged' ? release.manifest : undefined;
    if (release.state === 'quarantined' && release.retryable) {
      const { quarantineReason: _, ...prior } = release.manifest;
      staged = { ...prior, state: 'staged' };
      validateManifest(staged);
      release = await this.#transition(release, 'staged', { manifest: staged, manifestDigest: manifestDigest(staged), resumed: true });
    }
    try {
      if (!staged) {
        const artifacts = await this.builder.buildOnce(candidate);
        const envelopes = await this.conformance.run({ ...candidate, ...artifacts });
        const receipts = {};
        for (const forge of ['github', 'gitlab']) receipts[forge] = await this.receiptVerifier.verify(forge, envelopes[forge], { ...candidate, ...artifacts });
        staged = buildManifest({ ...candidate, ...artifacts, receipts });
        release = await this.#transition(release, 'staged', { manifest: staged, manifestDigest: manifestDigest(staged) });
      }
      release = await this.#publishCreateOnly(release, staged, candidate.dryRun);
      const reconciledEndpoints = release.transitions.filter((item) => item.state === 'published').map((item) => item.endpoint);
      const complete = completeManifest(staged, reconciledEndpoints);
      await this.#transition(release, 'complete', { manifest: complete, manifestDigest: manifestDigest(complete) });
      return complete;
    } catch (error) {
      if (!staged) throw error;
      if (error.release) release = error.release;
      const reason = error.code ?? 'release-step-failed';
      const retryable = error.retryable === true;
      const quarantined = quarantineManifest(staged, reason);
      try { await this.#transition(release, 'quarantined', { manifest: quarantined, manifestDigest: manifestDigest(quarantined), phase: error.phase ?? 'publish', reason, retryable }); }
      catch (persistenceError) { throw new AggregateError([error, persistenceError], 'release failed and quarantine persistence also failed'); }
      throw new ReleaseQuarantinedError('release quarantined after publication failure', quarantined, { cause: error });
    }
  }

  async #verifyHistory(release, candidate) {
    if (release.version !== candidate.version || release.commit !== candidate.commit || release.signerIdentity !== this.signer.identity) throw new ReleaseConflictError('reserved release or signer identity differs from candidate');
    let lastState = 'reserved';
    let previousRecordDigest = release.anchor;
    for (let index = 0; index < release.transitions.length; index += 1) {
      const transition = release.transitions[index];
      if (transition.sequence !== index + 1 || transition.previousState !== lastState || transition.previousRecordDigest !== previousRecordDigest) throw new ReleaseConflictError('release history hash chain is invalid');
      await this.signer.verifyRecord(transition);
      assertTransition(transition, release.transitions[index - 1]);
      if (transition.manifest) {
        validateManifest(transition.manifest);
        if (transition.manifest.version !== candidate.version || transition.manifest.commit !== candidate.commit || transition.manifestDigest !== manifestDigest(transition.manifest)) throw new ReleaseConflictError('persisted manifest identity or digest differs');
      }
      lastState = transition.state;
      previousRecordDigest = objectDigest(transition);
    }
    if (release.head !== previousRecordDigest) throw new ReleaseConflictError('release ledger head does not match its anchored history');
    const latest = release.transitions.at(-1);
    return { ...release, state: latest?.state ?? 'reserved', manifest: [...release.transitions].reverse().find((item) => item.manifest)?.manifest, retryable: latest?.retryable };
  }

  async #transition(release, state, payload) {
    const unsigned = { sequence: release.transitions.length + 1, previousState: release.state, previousRecordDigest: release.head, state, ...payload };
    const transition = { ...unsigned, signature: await this.signer.signRecord(unsigned) };
    const next = await this.store.append(release, transition);
    if (next === 'conflict') throw new ReleaseConflictError('release ledger changed concurrently');
    return { ...next, state, manifest: payload.manifest ?? release.manifest, retryable: payload.retryable };
  }

  async #publishCreateOnly(release, manifest, dryRun) {
    const endpoints = await this.publisher.endpoints(manifest, { dryRun });
    const ids = endpoints.map(({ id }) => id);
    if (new Set(ids).size !== ids.length || [...ids].sort().join() !== [...REQUIRED_ENDPOINT_IDS].sort().join()) throw new ReleaseConflictError('publication plan is missing, duplicate, or unknown endpoints');
    for (const endpoint of endpoints) {
      try {
        const prior = release.transitions.find((item) => item.state === 'published' && item.endpoint === endpoint.id);
        if (endpoint.digest !== manifest.endpoints[endpoint.id]) throw new ReleaseConflictError(`manifest digest differs for ${endpoint.id}`);
        if (prior && prior.digest !== endpoint.digest) throw new ReleaseConflictError(`ledger digest differs for ${endpoint.id}`);
        const existing = await this.publisher.readDigest(endpoint);
        if (existing && existing !== endpoint.digest) throw new ReleaseConflictError(`published content differs for ${endpoint.id}`);
        if (prior && !existing) throw new ReleaseConflictError(`published endpoint disappeared for ${endpoint.id}`);
        if (prior) continue;
        if (!existing) await this.publisher.create(endpoint);
        if (await this.publisher.readDigest(endpoint) !== endpoint.digest) throw Object.assign(new Error(`publication verification failed for ${endpoint.id}`), { phase: endpoint.id });
        release = await this.#transition(release, 'published', { endpoint: endpoint.id, digest: endpoint.digest });
      } catch (error) { error.release = release; throw error; }
    }
    return release;
  }

  async #observeCompleted(release, manifest, dryRun) {
    const endpoints = await this.publisher.endpoints(manifest, { dryRun });
    const ids = endpoints.map(({ id }) => id);
    if (new Set(ids).size !== ids.length || [...ids].sort().join() !== [...REQUIRED_ENDPOINT_IDS].sort().join()) throw new ReleaseConflictError('completed publication plan is incomplete');
    for (const endpoint of endpoints) {
      if (endpoint.digest !== manifest.endpoints[endpoint.id]) throw new ReleaseConflictError(`completed manifest digest differs for ${endpoint.id}`);
      const recorded = release.transitions.find((item) => item.state === 'published' && item.endpoint === endpoint.id);
      if (!recorded || recorded.digest !== endpoint.digest) throw new ReleaseConflictError(`completed ledger lacks ${endpoint.id}`);
      if (await this.publisher.readDigest(endpoint) !== endpoint.digest) throw new ReleaseConflictError(`completed endpoint drifted for ${endpoint.id}`);
    }
  }
}

function validateCandidate(candidate) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(candidate.version) || !/^[0-9a-f]{40}$/.test(candidate.commit) || !candidate.requestId) throw new Error('candidate requires unprefixed SemVer, full commit SHA, and request ID');
}

function assertTransition(transition, prior) {
  const allowed = { reserved: ['staged'], staged: ['published', 'complete', 'quarantined'], published: ['published', 'complete', 'quarantined'], quarantined: ['staged'], complete: [] };
  if (!allowed[transition.previousState]?.includes(transition.state)) throw new ReleaseConflictError(`invalid release transition ${transition.previousState} -> ${transition.state}`);
  if (transition.state === 'staged' && transition.previousState === 'quarantined' && prior?.retryable !== true) throw new ReleaseConflictError('terminal quarantine cannot resume');
  if (transition.state === 'published' && (!transition.endpoint || !/^sha256:[0-9a-f]{64}$/.test(transition.digest))) throw new ReleaseConflictError('published transition lacks endpoint digest');
  if (['staged', 'complete', 'quarantined'].includes(transition.state) && (!transition.manifest || !transition.manifestDigest)) throw new ReleaseConflictError(`${transition.state} transition lacks manifest`);
}
