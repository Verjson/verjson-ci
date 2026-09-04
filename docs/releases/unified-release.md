# Unified release protocol

`Unified release` is the sole release entrypoint. It is manually dispatched with an unprefixed SemVer and a full commit, runs in the protected `verjson-ci-release` environment, does not cancel an in-flight release, and receives only the `contents`, `packages`, and `id-token` permissions needed by the release job. A merge or push to `main` never derives or publishes a version.

The release manifest binds one commit and version to the CLI archive integrity, OCI digest, schema, GitHub Action and reusable workflow, GitLab component, mirror kit, and independently signed GitHub and GitLab conformance receipts. `release/manifest.schema.json` is closed to unknown properties and is enforced when a manifest is built, restored, signed, or verified. Semantic checks additionally require both receipt request IDs and normalized result digests to match.

Receipt verification happens over canonical receipt bytes before manifest construction. Verification uses checked-in exact issuer and workload identity policies; the resulting manifest records the verified identity and receipt bundle digest rather than accepting identity claims from the receipt. A request ID, commit, image digest, issuer, identity, signature, or content mismatch terminates staging.

Release state is an append-only, signed transition ledger. Reservation is create-only and binds a version to one commit before build work. Each transition carries a monotonic sequence, previous state, manifest digest where applicable, and a signature. Restore verifies every signature, transition edge, manifest schema, digest, version, and commit before honoring even a `complete` state. Compare-and-swap append prevents concurrent dispatches from advancing the same reservation.

Publication is reconciled per endpoint. The orchestrator reads the immutable digest already present at each endpoint, accepts an exact match, creates only an absent artifact, verifies the observed digest, and appends that endpoint receipt before advancing. A mismatch is terminal; it is never overwritten. Failures append a signed quarantine record containing phase, reason, and retry classification. Only an explicitly retryable quarantine may resume, and its history remains intact. If failure and quarantine persistence both fail, both errors are preserved.

The dry-run path exercises signed GitHub and GitLab receipt verification, manifest construction, reservation, endpoint reconciliation, interruption recovery, and completion without tags, external publication, or a license. The workflow then keylessly signs and verifies the proof using the exact release-workflow identity. Local integration tests also interrupt after partial publication and restart against the durable file ledger.

Issue #4 remains the only gate to the first public release. Until a license is selected, a non-dry-run dispatch fails before any tag or publication. Dry runs remain available so legal policy does not block release engineering verification.
