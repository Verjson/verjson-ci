import { buildManifest, completeManifest, quarantineManifest } from '../../../tools/release/manifest.mjs';

export class ReleaseConflictError extends Error {}
export class ReleaseQuarantinedError extends Error {
  constructor(message, manifest, options) {
    super(message, options);
    this.manifest = manifest;
  }
}

export class ReleaseOrchestrator {
  constructor({ license, store, builder, conformance, signer, tagger, publisher, verifier }) {
    this.license = license;
    this.store = store;
    this.builder = builder;
    this.conformance = conformance;
    this.signer = signer;
    this.tagger = tagger;
    this.publisher = publisher;
    this.verifier = verifier;
  }

  async release(candidate) {
    await this.license.assertPublishable();
    const reservation = await this.store.reserve(candidate.version, candidate.commit);
    if (reservation === 'conflict') throw new ReleaseConflictError('release version already belongs to another commit');

    let staged = recoverStaged(reservation, candidate);
    if (reservation?.state === 'complete') return reservation.manifest;

    try {
      if (!staged) {
        const artifacts = await this.builder.buildOnce(candidate);
        const receipts = await this.conformance.run({ ...candidate, ...artifacts });
        staged = buildManifest({ ...candidate, ...artifacts, receipts });
        const stagedSignature = await this.signer.sign(staged);
        await this.store.stage(staged, stagedSignature);
      }
      await this.tagger.createImmutable(candidate.version, candidate.commit);
      await this.publisher.publish(staged);
      await this.verifier.verifyEveryEndpoint(staged);
      const complete = completeManifest(staged);
      const completeSignature = await this.signer.sign(complete);
      await this.store.complete(complete, completeSignature);
      return complete;
    } catch (error) {
      if (!staged) throw error;
      const quarantined = quarantineManifest(staged, error.code ?? 'release-step-failed');
      const signature = await this.signer.sign(quarantined);
      await this.store.quarantine(quarantined, signature);
      throw new ReleaseQuarantinedError('release quarantined after partial publication', quarantined, { cause: error });
    }
  }
}

function recoverStaged(reservation, candidate) {
  if (!reservation || typeof reservation === 'string') return undefined;
  if (reservation.manifest?.commit !== candidate.commit || reservation.manifest?.version !== candidate.version) {
    throw new ReleaseConflictError('reserved release identity differs from candidate');
  }
  if (reservation.state === 'staged') return reservation.manifest;
  if (reservation.state === 'quarantined') {
    const { quarantineReason, ...manifest } = reservation.manifest;
    return { ...manifest, state: 'staged' };
  }
  if (reservation.state !== 'complete') throw new ReleaseConflictError('unknown release reservation state');
  return undefined;
}
