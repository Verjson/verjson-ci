# Framework-neutral compliance capability

`checks.compliance` projects observations already produced by the portable engine into deterministic compliance evidence. It does not run a second scanner. `off` disables the capability, `auto` reports every bundled pack, and object form selects exact pack versions plus `report` or `required` enforcement.

```yaml
checks:
  compliance:
    frameworks:
      - id: verjson-ci-foundation
        version: 1.0.0
    mode: required
    baseline: 66
```

`report` records findings without changing the run outcome. `required` fails when a blocking control is neither `satisfied` nor `not-applicable`, or when the percentage of satisfied controls is below `baseline`. Missing observations and manual assessments are `not-automated`; explicitly inapplicable capabilities are `not-applicable`. Neither state counts as satisfied.

The CLI writes `.verjson-ci/compliance-evidence.json` using evidence schema 2. Each framework contains control records and, when its pack declares them, generic item records projected from their parent control. Evidence excludes command text, environment values, file contents, timestamps, run identities, and provider URLs. Both adapters retain the same file and the result envelope records its SHA-256 digest.

## CSA STAR Level 1 CAIQ v4

The bundled `csa-star-l1-caiq@4.0.13` pack covers all 197 CCM v4.0.13 control identifiers and maps all 261 CAIQ v4.0.3 question identifiers to their parent controls. Every question identifier produces exactly one evidence item with a status, evidence digest, and concrete evidence reference in CLI, GitHub, and GitLab output.

```yaml
checks:
  compliance:
    frameworks:
      - id: csa-star-l1-caiq
        version: 4.0.13
    mode: required
```

Automation is intentionally conservative. Only specifically modeled runtime observations can satisfy a control. ShadScan currently supplies trustworthy evidence for `AIS-05`. `CCC-02` is the sole blocking control and requires the named `required-checks` observation; an unrelated successful command cannot satisfy it. Protected changes, immutable tags, keyless signing, OIDC identity, signed receipts, exported evidence, and OCI digest binding remain named capabilities and report `not-automated` until adapters emit those observations. Every other control is a manual assessment with an accountable `human-*` evidence reference and explicit reason.

The pack redistributes identifiers and Verjson-authored mappings only; it does not redistribute CSA control specifications or questionnaire text. Both identifier sets are derived from CSA's commit-pinned [official CC0 dataset](https://github.com/CloudSecurityAlliance-DataSets/dataset-public-laws-regulations-standards/tree/74ff4b828e60531d70a3d173784231f8a882a18c/control/cloudsecurityalliance.org). The exact source URLs, CC0 license URL, and SHA-256 digests are embedded in pack provenance. CSA separately governs questionnaire text and commercial use through its [official CCM v4 artifact page](https://cloudsecurityalliance.org/artifacts/cloud-controls-matrix-v4); adopters must obtain and retain any separately licensed text themselves.

To reproduce the data file, download the two exact inputs named in `provenance`, verify their recorded SHA-256 values, then run:

```sh
node scripts/build-caiq-pack.mjs /path/to/ccm-4.0.13.json /path/to/caiq-4.0.3.csv
```

The builder rejects changed digests, unexpected counts, duplicate item IDs, and items whose parent control is absent.

## Pack authoring

Packs live at `packages/compliance/packs/<id>/<version>.json`; `packages/compliance/packs/catalog.json` binds each exact identity and SHA-256 digest. Supported neutral mappings are `commands-all`, `file-any` with a bounded filename allowlist, `capability` with a named observation, and `manual` with a bounded owner and reason. Framework-specific interpretation belongs in pack data, not in adapters.

A pack change requires schema, semantic-boundary, missing-pack, success, required-failure, missing-evidence, CLI packaging, and GitHub/GitLab projection tests. The local `act` plus disposable GitLab CE matrix verifies identical results and artifact bytes. Missing artifacts, a single forge leg, digest mismatches, and malformed packs fail closed.
