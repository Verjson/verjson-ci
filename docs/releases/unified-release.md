# Unified release protocol

One explicit workflow dispatch supplies an unprefixed SemVer version. The release candidate is the selected full commit and one OCI digest; the GitHub Action, reusable workflow, GitLab component, schema, CLI archive, mirror kit, and conformance receipts are paths or artifacts from that same commit.

`tools/release/manifest.mjs` creates a staged manifest only when independently signed GitHub and GitLab receipts name the same request, commit, image digest, and normalized result digest. The workflow verifies receipt signatures before construction, signs the staged manifest and OCI digest, creates the version tag once, publishes, exercises both consumption paths, and then signs a `complete` manifest.

A failed publish is recorded as `quarantined`. Reconciliation may finish the same artifact identities but must never move the tag, replace an artifact, or reuse the version. Consumers accept only a valid signed `complete` manifest.

The first public release remains blocked until the repository license is selected in issue #4.
