---
date: 2026-09-04
issue: 16
title: Harden unified release recovery and identity boundaries
---

- Add a protected, manually dispatched keyless release proof workflow with a license-independent dry run.
- Verify signed forge receipts before manifest construction using exact workload identity policy.
- Enforce the closed release-manifest schema at build, restore, signing, and verification boundaries.
- Persist signed append-only release transitions with create-only reservation and compare-and-swap advancement.
- Reconcile publication per endpoint without overwrites and resume only explicitly retryable quarantines.
- Cover tampered state, forged and replayed receipts, conflicting content, crash recovery, and persistence failure behavior.
- Split unprivileged candidate validation from approved publication and execute privileged code only from the exact protected `main` head without persisted checkout credentials.
- Exercise a concrete disposable release across the real CLI archive, OCI image, forge adapters, GitLab mirror, immutable tag, and both consumption receipts.
- Bind a closed required endpoint plan into the manifest, re-observe every endpoint, and hash-chain ledger records to a stable signer and persisted head.
