---
date: 2026-09-03
issue: 14
impact: minor
title: Add external GitLab mirror kit
---

Provision protected internal GitLab component projects with Terraform and synchronize only immutable unprefixed SemVer tags without embedding credentials in configuration, state, remotes, or output. The hardened boundary restricts Git transports, detects source-tag races before an atomic push, pins the tested provider series, and grants protected-tag creation only to a dedicated deploy key.
