# Cross-forge OIDC trust contract

GitHub and GitLab jobs authenticate to a small conformance coordinator. They do not exchange personal access tokens and neither forge receives the other's privileged credential.

The coordinator verifies the issuer signature and exact audience, then requires the complete forge-specific subject, repository or project, protected ref, and workflow or CI-configuration identity claims. Policy startup fails on missing or unknown claims, unsafe JWKS endpoints, or issuer-to-JWKS mappings outside the operator allowlist. It records `issuer:jti` before issuing an opaque dispatch capability. That capability expires within one minute, is consumed atomically, and conveys no forge credential.

The consumed capability accepts only an immutable OCI digest under the policy's repository, the authenticated commit SHA, an allowed scenario, the unified adapter SemVer, and a stable client nonce. The authenticated workload scope, nonce, and immutable fields deterministically derive the request ID, so repeating an identical request with the original or a fresh capability recovers its accepted identity after a lost response. Registration atomically persists the request and both forge legs before an independently supervised worker attempts delivery. Each leg signs the bound request, adapter identity, canonical result digest, and bounded lifetime with an independent key. Receipts are create-once and fail closed on missing, expired, replayed, substituted, or mismatched evidence.

The GitHub workflow reads `VERJSON_CI_COORDINATOR_ORIGIN` only from the protected `cross-forge-conformance` environment. The canonical GitLab component compiles `https://coordinator.verjson.org` directly into its token-bearing job; adopter mirrors must compile their own exact origin under protected review before signing an immutable component tag. Pipeline, execution-policy, and component input variables cannot select or override that destination. Both adapters reject redirects, enforce network deadlines, initiate both fixture legs, and poll to a fail-closed deadline.

## Required deployment controls

- Pin issuer, HTTPS JWKS allowlist, audience, every required identity claim, fixture project, OCI repository, scenarios, and receipt lifetime as code.
- Store replay and capability records in an atomic, expiring data store shared by all coordinator replicas. Capability binding may recover only an identical request key and must reject substitution.
- Store request registration and both per-leg outbox intents in one transaction before external dispatch. Dispatch claims are expiring leases with monotonically increasing fencing tokens; only the current token may finish a leg. Claims, lease takeover, create-once receipt slots, and completion compare-and-set operations must be atomic across replicas. Reclaimed delivery always reuses the stable `requestId:forge` idempotency key, including crashes immediately before or after the external API call.
- Run an internal outbox worker that calls `retryDispatch(requestId)` for pending or failed legs until delivery succeeds or the request expires. Partial dispatch state remains visible to verdict clients and can never be interpreted as conformance success.
- Keep forge credentials in the deployment secret manager and out of job responses, logs, and artifacts.
- Restrict callback signers independently for GitHub and GitLab and rotate them without weakening receipt verification.
- Audit authorization, dispatch, callback, expiry, replay, and mismatch events without recording bearer tokens.
- Terminate TLS at the coordinator, restrict egress to pinned forge API and JWKS hosts, and enforce concurrency and per-identity rate limits at the deployment edge.

Changes to claim policy, credential scope, replay behavior, callback trust, or expiry require human security review.
