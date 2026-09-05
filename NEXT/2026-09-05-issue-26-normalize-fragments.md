---
date: 2026-09-05
issue: 26
impact: patch
title: Normalize legacy fragments before canonical changelog adoption
---

Consolidate duplicate issue 3, 10, and 16 entries into one active fragment per
issue. Preserve their original files byte-for-byte in the documented migration
archive and retain every original body and title in the consolidated entries.
This prepares canonical validation without changing release or signing behavior.
