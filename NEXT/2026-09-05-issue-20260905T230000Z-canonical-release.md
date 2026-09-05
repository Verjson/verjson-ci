---
date: 2026-09-05
id: 20260905T230000Z
impact: patch
title: Adopt canonical changelog snapshots before signed unified publication
---

Refs #26. Generate canonical changelog validation, renderer, contract test, ADR
index generator, and dispatch-only snapshot caller from one immutable contract.
Require a separate internal snapshot-v tag before publishing matching unprefixed
CLI, OCI, GitHub and GitLab versions through the signed coordinated protocol.
Pin the current v2 signing identity to unified-release.yml, preserving v1 only
for verification under its historical identity. Internal snapshot tags are not
public release completion and are excluded from the external mirror.
