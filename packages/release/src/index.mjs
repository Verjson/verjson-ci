import { buildManifest, completeManifest, manifestDigest, quarantineManifest, validateManifest } from '../../../tools/release/manifest.mjs';

export class ReleaseConflictError extends Error {}
export class ReleaseQuarantinedError extends Error { constructor(message, manifest, options) { super(message, options); this.manifest = manifest; } }

export class ReleaseOrchestrator {
  constructor({ license, store, builder, conformance, receiptVerifier, signer, tagger, publisher }) { Object.assign(this, { license, store, builder, conformance, receiptVerifier, signer, tagger, publisher }); }

  async release(candidate) {
    validateCandidate(candidate);
    if (!candidate.dryRun) await this.license.assertPublishable();
    let release = await this.store.reserve(candidate.version, candidate.commit);
    if (release === 'conflict') throw new ReleaseConflictError('release version already belongs to another commit');
    release = await this.#verifyHistory(release, candidate);
    if (release.state === 'complete') return release.manifest;
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
      if (!candidate.dryRun) await this.tagger.createImmutable(candidate.version, candidate.commit);
      release = await this.#publishCreateOnly(release, staged, candidate.dryRun);
      const complete = completeManifest(staged);
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
    if (release.version !== candidate.version || release.commit !== candidate.commit) throw new ReleaseConflictError('reserved release identity differs from candidate');
    let lastState = 'reserved';
    for (let index = 0; index < release.transitions.length; index += 1) {
      const transition = release.transitions[index];
      if (transition.sequence !== index + 1 || transition.previousState !== lastState) throw new ReleaseConflictError('release history is not append-only');
      await this.signer.verifyRecord(transition);
      assertTransition(transition, release.transitions[index - 1]);
      if (transition.manifest) {
        validateManifest(transition.manifest);
        if (transition.manifest.version !== candidate.version || transition.manifest.commit !== candidate.commit || transition.manifestDigest !== manifestDigest(transition.manifest)) throw new ReleaseConflictError('persisted manifest identity or digest differs');
      }
      lastState = transition.state;
    }
    const latest = release.transitions.at(-1);
    return { ...release, state: latest?.state ?? 'reserved', manifest: [...release.transitions].reverse().find((item) => item.manifest)?.manifest, retryable: latest?.retryable };
  }

  async #transition(release, state, payload) {
    const unsigned = { sequence: release.transitions.length + 1, previousState: release.state, state, ...payload };
    const transition = { ...unsigned, signature: await this.signer.signRecord(unsigned) };
    const next = await this.store.append(release, transition);
    if (next === 'conflict') throw new ReleaseConflictError('release ledger changed concurrently');
    return { ...next, state, manifest: payload.manifest ?? release.manifest, retryable: payload.retryable };
  }

  async #publishCreateOnly(release, manifest, dryRun) {
    for (const endpoint of await this.publisher.endpoints(manifest, { dryRun })) {
      try {
        const prior = release.transitions.find((item) => item.state === 'published' && item.endpoint === endpoint.id);
        if (prior) { if (prior.digest !== endpoint.digest) throw new ReleaseConflictError(`ledger digest differs for ${endpoint.id}`); continue; }
        const existing = await this.publisher.readDigest(endpoint);
        if (existing && existing !== endpoint.digest) throw new ReleaseConflictError(`published content differs for ${endpoint.id}`);
        if (!existing) await this.publisher.create(endpoint);
        if (await this.publisher.readDigest(endpoint) !== endpoint.digest) throw Object.assign(new Error(`publication verification failed for ${endpoint.id}`), { phase: endpoint.id });
        release = await this.#transition(release, 'published', { endpoint: endpoint.id, digest: endpoint.digest });
      } catch (error) { error.release = release; throw error; }
    }
    return release;
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
