# ShadScan capability

`checks.shadscan` runs the deterministic static audit in the provider-neutral engine. `off` disables it; `auto` runs only when a React dependency and `components.json` are present; object form pins the CLI version, chooses `auto` or `required`, and sets the score floor.

The built-in auto mode pins `@shadscan/cli@0.17.0`, the current version available from npm. The upstream v0.17.1 release and README advertise 0.17.1, but that package version was not present in npm when this integration was verified.

`baseline` implements adoption without regression: the effective threshold is the greater of `fail-under` and `baseline`. Raise the baseline when the score improves. Never lower it to accommodate a regression.

Both adapters publish `.verjson-ci/shadscan-report.json` and include the same applicability, score, finding count, threshold, and outcome fields in the normalized result. Provider-specific issue creation is intentionally outside the engine.

Rendered checks use the separate `shadscan-rendered` GitHub workflow or GitLab component. They run ShadScan `--check-ui` against an already-running preview URL and do not alter the static score.
