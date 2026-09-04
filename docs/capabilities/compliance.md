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

The CLI writes `.verjson-ci/compliance-evidence.json`. Evidence contains only normalized names, outcomes, exit status, applicability, and hashes. It excludes command text, environment values, file contents, timestamps, run identities, and provider URLs. Dependency evidence uses no-follow metadata beneath the canonical repository root and accepts regular files only; directories, symlinks, and special files fail at the boundary. Both adapters retain the file and the result envelope records its SHA-256 digest.

## CSA STAR Level 1 CAIQ v4

The bundled `csa-star-l1-caiq@4.0.13` pack covers all 197 CCM v4.0.13 control identifiers and binds the 261 CAIQ v4.0.3 question identifiers to their parent controls. Select it explicitly:

```yaml
checks:
  compliance:
    frameworks:
      - id: csa-star-l1-caiq
        version: 4.0.13
    mode: required
```

CI evidence is intentionally conservative. Quality-test commands automate `CCC-02`; static commands, ShadScan, and a regular dependency lockfile provide evidence for a small set of AIS, STA, and TVM controls. Protected changes, immutable tags, keyless signing, OIDC identity, signed receipts, exported evidence, and OCI digest binding remain named capability evidence until the runtime observes them. Every other control reports `not-automated` with an accountable `human-*` owner in its evidence reference. `CCC-02` is the sole blocking control, so a command regression fails in `required` mode while `report` mode remains observational.

The pack redistributes identifiers and Verjson-authored mappings only. It does not redistribute CSA control specifications or question text. The 4.0.13 control identifiers come from CSA's [CC0 public dataset](https://github.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/tree/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org/ccm/4.0.13); source URLs, license URL, and retrieval digests are embedded in the pack. CSA's [official v4 artifact page](https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4) identifies v4.0.13 and explains which workbook is valid for STAR submission. CSA separately states that product or commercial use of CCM content requires a license, so adopters must obtain and retain the licensed questionnaire text themselves.

To reproduce the data file, download the two exact inputs named in `provenance`, verify their recorded SHA-256 values, and run `node scripts/build-caiq-pack.mjs /path/to/ccm-4.0.13.json /path/to/caiq-4.0.3.json`. The builder rejects changed digests, unexpected counts, duplicate IDs, and CAIQ questions whose parent control is absent.

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

Pack changes require schema, malformed-boundary, missing-pack, success, required-failure, missing-evidence, and GitHub/GitLab projection tests. The local `act` and disposable GitLab CE matrix records the inner CLI exit code: malformed pack declarations and absent registered packs exit 2 without a semantic result, while ordinary required missing evidence exits 1 with matching unsatisfied controls. For the exact checked-in `compliance-missing-evidence` local fixture only, each harness deletes the evidence after CLI execution and replaces the inner verdict with boundary exit 86. Both absent artifacts count as the expected negative test only when both independent legs carry that verdict; default and consumer adapters expose no injection input or environment switch. The parity boundary otherwise requires both evidence artifacts to exist, verifies each digest, and then compares canonical bytes and control semantics. An absent pack, missing artifact, single forge leg, or digest mismatch fails closed.
