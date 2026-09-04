# Licensing policy

The reusable core currently in this repository is licensed under the
[Apache License 2.0](LICENSE). Unless a file is covered by a nearer license or a
third-party notice says otherwise, the root Apache-2.0 license applies.

Verjson may add paid capabilities, including advanced compliance checks and
documentation features. Apache-2.0 does not require those future capabilities
to use the same license when they are kept as separable works. Before any
non-Apache capability is added to this repository, it must be isolated in a
dedicated workspace package subtree that contains:

- its own `LICENSE` with terms approved by the repository owner; and
- SPDX license metadata in its package manifest and, where practical, source
  file headers.

The package-local `LICENSE` governs that subtree. A
non-Apache package must not depend on ambiguity in this policy or on an
unpublished license: its license and SPDX identifier must land in the same
change as the package's first file. This repository does not currently contain
such a package and does not define proprietary terms here.

Third-party material remains under its applicable license. Preserve its notices
and provenance when redistributing it.
