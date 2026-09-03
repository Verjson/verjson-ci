# Cross-forge OIDC trust contract

GitHub and GitLab jobs authenticate to a small conformance coordinator. They do not exchange personal access tokens and neither forge receives the other's privileged credential.

The coordinator verifies the issuer signature and exact audience, then requires the configured repository or project, protected ref, and workflow or CI-configuration identity claims. It records `issuer:jti` before issuing an opaque dispatch capability. That capability expires within one minute, is consumed atomically, and conveys no forge credential.

The deployment adapter owns GitHub App installation and restricted GitLab project credentials. It may dispatch only the fixture project selected by policy. Signed callbacks are pending until both forge receipts exist; missing evidence is never treated as success, and differing canonical result digests fail conformance.

## Required deployment controls

- Pin issuer, JWKS URL, audience, repository or project, protected-ref, and workflow or configuration claims as code.
- Store replay and capability records in an atomic, expiring data store shared by all coordinator replicas.
- Keep forge credentials in the deployment secret manager and out of job responses, logs, and artifacts.
- Restrict callback signers independently for GitHub and GitLab and rotate them without weakening receipt verification.
- Audit authorization, dispatch, callback, expiry, replay, and mismatch events without recording bearer tokens.

Changes to claim policy, credential scope, replay behavior, callback trust, or expiry require human security review.
