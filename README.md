# verjson-ci

Portable, conformant CI for GitHub and GitLab.

This repository implements the unified CI architecture governed by
[Verjson/.github ADR 0162](https://github.com/Verjson/.github/tree/main/docs/decisions/0162-unify-portable-ci-engine-and-forge-adapters).

The contract schema, provider-neutral engine, CLI, OCI image, GitHub adapter, GitLab
adapter, conformance fixtures, and release tooling share one repository and version.

No stable release exists yet. Until the signed release pipeline is complete, examples use
placeholders rather than a mutable branch or image tag.

## Licensing

The reusable core in this repository is available under Apache-2.0. Verjson may
ship separately licensed paid capabilities, including advanced compliance and
documentation features, from explicitly isolated packages. See
[LICENSING.md](LICENSING.md) for the boundary rules; no paid package or
proprietary license is present today.

## Portable contract

```yaml
schema: 1
stack: node
runtime:
  node: '24'
  package-manager: pnpm
commands:
  verify: pnpm check
checks:
  shadscan:
    mode: auto
    version: 0.17.0
    fail-under: 70
    baseline: 82
  compliance:
    frameworks:
      - id: verjson-ci-foundation
        version: 1.0.0
    mode: report
```

Both adapters execute this contract through the same OCI image and produce the same
normalized `.verjson-ci/result.json`. ShadScan's complete versioned report is retained as
`.verjson-ci/shadscan-report.json` when applicable.
Compliance evidence is retained as `.verjson-ci/compliance-evidence.json`; see the
[pack and enforcement contract](docs/capabilities/compliance.md).

## Local development

Install Node 24, pnpm, Docker, and [`act`](https://nektosact.com/). Then run:

```bash
pnpm install
pnpm check
pnpm parity:local --changed
```

Schema changes automatically select both success and failure fixtures. The harness builds
one local OCI candidate, runs the GitHub entrypoint with `act`, and runs all selected GitLab
fixtures through one disposable GitLab CE project and runner. It destroys credentials,
volumes, and networks on exit.

## Consumption

Every public reference below must use the same unprefixed SemVer `<version>`, and
`<image-digest>` must be the OCI digest recorded by that release's signed complete manifest.

GitHub composite Action:

```yaml
- uses: Verjson/verjson-ci/adapters/github/action@<version>
  with:
    image: ghcr.io/verjson/verjson-ci@<image-digest>
```

GitHub reusable workflow:

```yaml
jobs:
  ci:
    uses: Verjson/verjson-ci/.github/workflows/reusable-ci.yml@<version>
    with:
      image: ghcr.io/verjson/verjson-ci@<image-digest>
```

GitLab instances first mirror the canonical tag with `terraform/gitlab-mirror` and
`tools/mirror/sync.mjs`, then consume the internal component:

```yaml
include:
  - component: $CI_SERVER_FQDN/platform/verjson-ci/ci@<version>
    inputs:
      image: ghcr.io/verjson/verjson-ci@<image-digest>
```

Never combine a CLI, Action, workflow, component, schema, or image from different release
manifests. GitHub remains a tested fallback when GitLab is the primary forge.

## Delivery status

- Local engine, adapters, ShadScan, and real `act`/GitLab CE parity are implemented.
- Cross-forge OIDC and signed-release controls are under mandatory security review in
  [PR #11](https://github.com/Verjson/verjson-ci/pull/11) and
  [PR #17](https://github.com/Verjson/verjson-ci/pull/17).
- External GitLab mirror provisioning is under mandatory review in
  [PR #15](https://github.com/Verjson/verjson-ci/pull/15).
- The public release license gate is resolved by the root Apache-2.0 license.
