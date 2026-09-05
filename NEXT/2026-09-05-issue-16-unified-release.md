---
date: 2026-09-05
issue: 16
impact: major
title: Unified signed release protocol and security hardening
---

## Verify standalone CLI release archive

Source: `2026-09-03-issue-16-cli-package-contract-test.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Build, install, and execute the standalone CLI archive in CI to prove its engine and adapter versions equal the unified release version.

## Add keyless release manifest signing

Source: `2026-09-03-issue-16-keyless-manifest-signing.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Sign staged, complete, and quarantined manifests with keyless Sigstore bundles and verify them against an exact workflow certificate identity and OIDC issuer.

## Add restart-safe unified release state machine

Source: `2026-09-03-issue-16-release-state-machine.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Order license validation, atomic version reservation, build-once artifacts, cross-forge conformance, signed staging, immutable tagging, publication, endpoint verification, and signed completion with quarantine on partial failure.

## Lock release workspace importer

Source: `2026-09-03-issue-16-release-workspace-lock.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Record the unified release package in the pnpm lockfile so clean frozen installs reproduce the reviewed workspace graph.

## Add signed unified release manifest contract

Source: `2026-09-03-issue-16-unified-release-manifest.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Bind the CLI, OCI digest, GitHub and GitLab adapters, schema, mirror kit, and matching signed cross-forge receipts to one unprefixed SemVer tag with staged, complete, and quarantined states.

## Bind standalone CLI package to unified version

Source: `2026-09-03-issue-16-versioned-cli-package.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Bundle the engine and capabilities into a dependency-free CLI archive whose embedded version and SHA-256 integrity are bound to the same release manifest as both forge adapters.

## Harden unified release recovery and identity boundaries

Source: `2026-09-04-issue-16-release-security-review.md` (preserved in `docs/changelog-migration/2026-09-05/`).


- Add a protected, manually dispatched keyless release proof workflow with a license-independent dry run.
- Verify signed forge receipts before manifest construction using exact workload identity policy.
- Enforce the closed release-manifest schema at build, restore, signing, and verification boundaries.
- Persist signed append-only release transitions with create-only reservation and compare-and-swap advancement.
- Reconcile publication per endpoint without overwrites and resume only explicitly retryable quarantines.
- Cover tampered state, forged and replayed receipts, conflicting content, crash recovery, and persistence failure behavior.
- Split unprivileged candidate validation from approved publication and execute privileged code only from the exact protected `main` head without persisted checkout credentials.
- Exercise a concrete disposable release across the real CLI archive, OCI image, forge adapters, GitLab mirror, immutable tag, and both consumption receipts.
- Bind a closed required endpoint plan into the manifest, re-observe every endpoint, and hash-chain ledger records to a stable signer and persisted head.
- Re-observe completed releases, anchor ledger heads in an independent monotonic store, and recover stable signed state across hard process exits at both persistence boundaries.
- Execute independent GitHub and disposable GitLab CE fixture processes, create and mirror a real immutable Git tag, and snapshot manifest bytes before keyless signing or verification.
- Remove unused repository/package write permissions from proof execution and isolate future public endpoint permissions behind issue #4 environments.
- Consume the immutable staged GitHub tag through real `act` Action/reusable-workflow jobs and the mirrored tag through a real disposable GitLab CE runner.
- Derive consumption digests from independently observed adapter results and prove full successor-process recovery after an endpoint-create hard kill without overwrite.
- Suppress GitHub artifact upload only under the local `act` harness so the reusable workflow can complete without GitHub's artifact service.
- Pass the provider-neutral conformance scenario through both GitHub adapter surfaces so their independently observed consumption results are identical.
- Route the disposable GitHub consumption proof through canonical portable runner lanes while retaining a GitHub-hosted fallback for external adopters.
- Route public CLI, OCI, forge tag/component, mirror, and consumption endpoints through the same closed plan using create-only GitHub release checkpoint generations, keyless ledger bundles, and rerun-safe quarantine reconciliation.
- Anchor every remote checkpoint generation to a separately protected immutable annotated tag and reject suffix deletion, anchor deletion, binding mismatch, gaps, and generation races on restore.
- Recover only signed next-generation dual-write interruptions through deterministic create-only anchor/marker reconciliation, fence stale writers, and retain live effective-ruleset evidence before public mutation.

