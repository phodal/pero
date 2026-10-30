# Vendored Point native dependencies

This directory contains source copied from Point's `computer/crates/` at
`a1b9150059a8858bac68497e6789e2b7cac8b08c`. The five crates are the complete
local dependency closure of Pero's macOS/Windows adapters. Pero's core, runtime
and Linux libraries have no Point dependency. The Point
service, CLI, worker, Linux backend and evaluation tools are omitted.

The upstream workspace declares MIT. Attribution and the license text are in
[`../../NOTICE.md`](../../NOTICE.md); revision and selection metadata are in
[`../../SOURCE.json`](../../SOURCE.json). No upstream checkout is needed to
build or run Pero. This is a source snapshot maintained in this repository.

The local changes are limited to build ownership and module organization:

- Restrict workspace members to these five crates, and explicitly bind each
  crate manifest to this workspace. The inherited package and lint settings
  are retained.
- Move the native application, observation and request/result records into
  `point-computer-core/src/types/records.rs`, retaining the `types::*` API.
- Move macOS driver tests into `src/driver/tests.rs`.
- Move macOS AX helpers, event synthesis and JPEG handling into
  `src/ffi/{accessibility,input,image}.rs`, retaining the `ffi::*` API.

The splits keep each source file below Pero's 1000-line limit without changing
driver behavior. Upstream source comments are retained. Their descriptions of
Point's policies and services are upstream context; Pero's contracts and
Desktop remain the public authority and transport owners.

To update the snapshot, copy only this closure from a reviewed revision,
reapply the documented adaptations, update `SOURCE.json`, and rerun the clean
source build and native platform checks. Do not add an automatic source fetch
to the build path.
