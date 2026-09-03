# Unified release protocol

One explicit workflow dispatch supplies an unprefixed SemVer version. The release candidate is the selected full commit and one OCI digest; the GitHub Action, reusable workflow, GitLab component, schema, CLI archive, mirror kit, and conformance receipts are paths or artifacts from that same commit.

`tools/release/package-cli.mjs` bundles the engine, schema, result contract, and ShadScan integration into a dependency-free `@verjson/ci` package. Its embedded engine and adapter versions equal the release version. External users consume the CLI package, `Verjson/verjson-ci/adapters/github/action@<version>`, `.github/workflows/reusable-ci.yml@<version>`, and the mirrored GitLab component at that same unprefixed tag; the signed manifest is the authoritative mapping.

`tools/release/manifest.mjs` creates a staged manifest only when independently signed GitHub and GitLab receipts name the same request, commit, image digest, and normalized result digest. The workflow verifies receipt signatures before construction, signs the staged manifest and OCI digest, creates the version tag once, publishes, exercises both consumption paths, and then signs a `complete` manifest.

A failed publish is recorded as `quarantined`. Reconciliation resumes only the same reserved version, commit, and staged artifact identities; it skips rebuilding and reconformance, and idempotently retries tagging and publication. It must never move the tag, replace an artifact, or reuse the version. Consumers accept only a valid signed `complete` manifest.

The first public release remains blocked until the repository license is selected in issue #4.
