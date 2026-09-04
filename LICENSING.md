# Licensing policy

The reusable core currently in this repository is licensed under the
[Apache License 2.0](LICENSE). Unless a file is covered by a nearer license or a
third-party notice says otherwise, the root Apache-2.0 license applies.

Verjson may add paid capabilities, including advanced compliance checks and
documentation features. This roadmap does not decide their license or promise
that they will be legally separable from the Apache-2.0 core. Before any
non-Apache capability is added to this repository, it must be isolated in a
dedicated workspace package subtree that contains:

- its own `LICENSE` with terms approved by the repository owner; and
- SPDX license metadata in its package manifest and, where practical, source
  file headers.

The package-local license governs only material to which it legally applies; a
directory boundary does not relicense Apache-2.0 core code or third-party
material. Proprietary terms require explicit repository-owner and legal
approval. A non-Apache package must not depend on ambiguity in this policy or
on unpublished terms: its approved license and SPDX identifier must land in
the same change as the package's first file. This repository does not currently
contain such a package and does not define proprietary terms here.

Third-party material remains under its applicable license. Preserve its notices
and provenance when redistributing it.

CLI and OCI assembly validate the closed Apache-2.0 package inventory in
`release/artifact-licenses.json` and fail if their included workspace packages
drift. Release manifest schema v2 binds the exact inventory digest alongside the
CLI and OCI identities. Schema v1 remains readable only for existing release
history.
