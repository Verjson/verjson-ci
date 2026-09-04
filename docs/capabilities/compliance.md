# Framework-neutral compliance capability

`checks.compliance` turns outcomes already produced by the portable engine into deterministic control evidence. It does not run a second scanner. `off` disables the capability, `auto` reports every bundled pack, and object form selects exact pack versions plus `report` or `required` enforcement.

```yaml
checks:
  compliance:
    frameworks:
      - id: verjson-ci-foundation
        version: 1.0.0
    mode: required
    baseline: 66
```

`report` records control failures without changing the run outcome. `required` fails when a blocking control is `unsatisfied` or the percentage of satisfied controls falls below `baseline`. Missing evidence becomes `not-automated`; an explicitly inapplicable capability becomes `not-applicable`. Neither state is treated as satisfied.

The CLI writes `.verjson-ci/compliance-evidence.json`. Evidence contains only normalized names, outcomes, exit status, applicability, and hashes. It excludes command text, environment values, file contents, timestamps, run identities, and provider URLs. Both adapters retain the file and the result envelope records its SHA-256 digest.

## Pack authoring

Packs live at `packages/compliance/packs/<id>/<version>.json` and are registered in `packages/compliance/packs/catalog.json` with an exact SemVer and SHA-256 digest. Paths are derived from the validated ID and version; contracts cannot supply a path or URL. The release manifest signs the exact catalog identities and digests, and the OCI image carries the same files.

A pack has a closed shape:

```json
{
  "schema": 1,
  "id": "example-framework",
  "version": "1.2.3",
  "controls": [
    { "id": "EXAMPLE-1", "blocking": true, "evidence": { "kind": "commands-all" } }
  ]
}
```

Supported neutral mappings are `commands-all`, `file-any` with a bounded filename allowlist, and `capability` with a capability name. Add a framework by adding pack data, registering its digest, and exposing its exact identity in `verjson-ci.schema.json`; the engine and adapters do not change. Framework-specific interpretation belongs in pack data, not the resolver.

Pack changes require schema, malformed-boundary, success, required-failure, and GitHub/GitLab projection tests. The parity boundary requires both artifacts to exist, verifies each digest, and then compares canonical bytes and control semantics. An absent pack, missing artifact, single forge leg, or digest mismatch fails closed.
