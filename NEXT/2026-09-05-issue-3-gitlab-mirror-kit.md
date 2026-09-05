---
date: 2026-09-05
issue: 3
impact: minor
title: GitLab mirror kit and immutable tag verification
---

## Add the local cross-adapter parity harness

Source: `2026-09-03-issue-3-local-parity-harness.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Build one local OCI candidate and provide `act` plus disposable GitLab CE execution paths
that compare normalized GitHub and GitLab results without publishing or persistent secrets.

## Conform local parity to organization runner policy

Source: `2026-09-03-issue-3-local-parity-runner-policy.md` (preserved in `docs/changelog-migration/2026-09-05/`).


Route the local parity workflow through the canonical trusted and untrusted organization lanes while retaining the hosted fallback for external forks.

