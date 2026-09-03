# GitLab mirror module

This module creates the internal project that hosts mirrored `verjson-ci` release tags and protects all tags from Developer-level creation. Supply the GitLab provider outside the module; keep its token in the provider's supported environment variable, never Terraform variables or state.

Run `node tools/mirror/sync.mjs --source https://github.com/Verjson/verjson-ci.git --destination <credential-free-internal-url>` from a protected scheduled pipeline. Configure Git's credential helper at runtime with a short-lived, write-only mirror credential. The tool synchronizes only unprefixed SemVer tags, preserves tag object identity, and refuses to change an existing destination tag.
