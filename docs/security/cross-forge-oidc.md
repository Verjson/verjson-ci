# Cross-forge OIDC trust contract

GitHub and GitLab jobs authenticate to a small conformance coordinator. They do not exchange personal access tokens and neither forge receives the other's privileged credential.

The coordinator verifies the issuer signature and exact audience, then requires the complete forge-specific subject, repository or project, protected ref, and workflow or CI-configuration identity claims. Policy startup fails on missing or unknown claims, unsafe JWKS endpoints, or issuer-to-JWKS mappings outside the operator allowlist. It records `issuer:jti` before issuing an opaque dispatch capability. That capability expires within one minute, is consumed atomically, and conveys no forge credential.

The consumed capability accepts only an immutable OCI digest under the policy's repository, the commit SHA carried by the authenticated workload identity, an allowed scenario, and the unified adapter SemVer. One request atomically registers a nonce and digest over those values, then dispatches both forge legs against the policy-selected fixture project. Each leg signs the bound request, adapter identity, canonical result digest, and bounded lifetime with an independent key. Authenticated signer identity selects the forge. Receipts are create-once and reject replay, overwrite, cross-request substitution, and post-completion evidence. Missing or expired evidence is never success, and differing canonical result digests fail conformance.

The GitHub workflow reads `VERJSON_CI_COORDINATOR_ORIGIN` only from the protected `cross-forge-conformance` environment. The GitLab component reads it only from a protected CI/CD variable. Neither surface accepts the origin as an input. Both require one credential-free HTTPS origin before obtaining a token, reject redirects, enforce network deadlines, initiate both fixture legs, and poll to a fail-closed deadline.

## Required deployment controls

- Pin issuer, HTTPS JWKS allowlist, audience, every required identity claim, fixture project, OCI repository, scenarios, and receipt lifetime as code.
- Store replay and capability records in an atomic, expiring data store shared by all coordinator replicas.
- Store request registration, create-once forge receipt slots, and completion state transactionally across replicas.
- Keep forge credentials in the deployment secret manager and out of job responses, logs, and artifacts.
- Restrict callback signers independently for GitHub and GitLab and rotate them without weakening receipt verification.
- Audit authorization, dispatch, callback, expiry, replay, and mismatch events without recording bearer tokens.
- Terminate TLS at the coordinator, restrict egress to pinned forge API and JWKS hosts, and enforce concurrency and per-identity rate limits at the deployment edge.

Changes to claim policy, credential scope, replay behavior, callback trust, or expiry require human security review.
