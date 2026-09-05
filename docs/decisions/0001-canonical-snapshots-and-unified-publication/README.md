# 0001 — Canonical snapshots precede signed unified publication

- **Status:** Accepted
- **Date:** 2026-09-05
- Issue: https://github.com/Verjson/verjson-ci/issues/26

## Context

The canonical Verjson changelog contract must consume NEXT fragments into immutable
release snapshots. Its generated release-snapshot caller publishes notes and an
annotated tag, but does not provide a same-run post-snapshot publication hook.
The existing unified release protocol additionally signs manifest v2, binds the
license inventory, and coordinates CLI, OCI, GitHub, and GitLab endpoints with
protected approvals and restart-safe recovery. A notes-only release cannot prove
that protocol completed. PR #28 normalized pre-contract fragments first.

## Decision

Generate validation, renderer, contract test, ADR index generator, and snapshot
release caller at contract SHA `b2fc4f832bd11c46769f56922712510d0c14a6e4`.
Keep the generated `.github/workflows/release.yml` byte-identical to that contract.
Its repository-owned verification hook requires explicit `prefix: snapshot-v`
and `version: snapshot-v<SemVer>` inputs. The namespace is internal even though
the generated caller creates a visible GitHub Release containing its notes.

Move the independently dispatched signed publication workflow to
`.github/workflows/unified-release.yml`. Operators dispatch it separately with
unprefixed public SemVer and the exact snapshot commit at protected main HEAD.
A gate requires the matching annotated `snapshot-v<SemVer>` tag to resolve to
that commit and the committed immutable snapshot notes to exist and be nonempty.
No push trigger or snapshot completion automatically starts public publication.
If main advances, do not retarget the snapshot or bypass the protected-head gate;
cut a new version with new fragments or address recovery through reviewed work.

Snapshot-created means changelog consumption completed. Publication-complete
means the existing signed coordinated protocol completed: its complete manifest,
endpoint receipts, artifact/license digests, protected anchor, and verification
remain mandatory. An internal GitHub Release, tag, or candidate-gate success
alone never asserts that public artifacts exist or are compliant.

Public CLI/OCI/Action/Component versions and external GitLab tags remain matching,
unprefixed SemVer. Mirror discovery rejects the internal snapshot namespace.
OIDC federation, protected publication/recovery environments, and manifest-v2
license inventory binding are unchanged.

The current v2 signer is the exact unified-release.yml identity on main. Legacy
v1 manifests remain verification-only under the previous release.yml identity;
new signing refuses v1, and v2 verification never falls back to the old signer.
There were no GitHub releases when this migration was checked. Historical v2
dry-run bundles signed by the old workflow are intentionally no longer accepted
by the current verifier; regenerate dry-run evidence under the new signer.
This does not authorize weakening the inventory boundary or relicensing material.

## Consequences

Two explicit dispatches are less convenient than one, but preserve the canonical
contract and the stronger coordinated publication protocol without custom forks.
The generated snapshot caller's default prefix is not this repository's internal
namespace: the verification hook rejects accidental default-prefix dispatches.
Consumers and operators must use unprefixed versions and the signed completion
record, not GitHub's generic latest-release view, to discover public availability.

Changes to signing identities are security-sensitive and require independent
review. Live App permissions, environments, OIDC federation and external
publication remain deployment prerequisites; local tests do not prove them.
