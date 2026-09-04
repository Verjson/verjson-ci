---
date: 2026-09-04
issue: 4
title: License the reusable core under Apache-2.0
---

License the current reusable CI core under Apache-2.0 and remove the temporary
public-release license gate. Document an explicit package boundary requiring
future paid capabilities to carry their own approved license and SPDX metadata
before code is added. CLI archives and OCI images carry the license materials,
fail closed against a reviewed package inventory during assembly, and bind that
inventory's digest into signed release manifest v2.
