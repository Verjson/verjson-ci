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
