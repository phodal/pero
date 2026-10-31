# CI feedback and complete acceptance

## Measured baseline (2026-10-31)

Run `41199679837` passed, but Linux took about 30 minutes: build 5m36s,
then serial Desktop acceptance 22m10s. macOS took 10m38s (build 7m49s),
Windows 11m37s (build 7m31s). Queue delay in the sampled runs was seconds,
not the cause. npm, Go and Cargo reported cache hits, yet every platform
rebuilt `wasm-bindgen-cli 0.2.127` (86–122s) and the separate Connectors
Cargo target (56–96s). MCP UI alone took 6m14s.

The target is **under ten minutes from the first job starting until the complete
Linux CI gate finishes**, not ten minutes per job. Queue time must be reported
separately. A timeout is a failure and is not evidence of faster execution.
New-path cold caches and subsequent warm-cache runs must be measured separately;
no cold-build ten-minute guarantee is claimed before Actions measurement.

## Execution graph

- Generated contracts and CI runner tests provide early, cheap failure evidence.
- Ordinary PR/push runs Linux only, as explicitly requested. Daily at 20:00 UTC
  (04:00 UTC+08) and manual `workflow_dispatch` run Linux/macOS/Windows builds,
  Go/Bazel/Harness and Windows positive ACL tests. Native Computer Use follows
  the same split. Scheduled runs use the default branch.
- Each selected OS retains its complete build, typechecks, generated checks, Rust
  tests, Host contracts and transport tests. Daily full builds keep every platform.
- An exact-version bindgen cache and all three Rust target directories avoid
  recompiling independent tools. The bindgen executable is probed before use;
  a damaged or mismatched cache is rebuilt with the pinned version.
- Linux builds once, then passes a SHA-bound, checksummed runtime archive to
  independent acceptance jobs. The tar retains executable permissions. No
  source, node_modules, Cargo incremental data or credentials are shipped.
- Acceptance checks out the same commit, installs npm dependencies, restores
  that archive and runs the existing real Desktop tests. It does not rebuild
  Rust, Go, GPUI or Apps. The live Control Lab local fixture uses the exact
  bundled harness binary and its SHA, not a second compilation.
- The three MCP scenarios use independent fixtures/profiles. Lifecycle covers
  actual add/grant/edit/remove; persistence covers write failure, restart,
  conflict/import and visual states; transport covers rejected/unrelated IPC,
  unknown save reload and disconnection. The default command still runs all.
- `Linux CI gate` requires every Linux job and all acceptance shards. Only the
  two explicitly full-platform-only job groups may be skipped in normal mode.
  `Full-platform CI gate` requires all jobs, including Windows positive ACL and
  macOS/Windows builds. Failure/cancellation of any required job rejects the gate;
  the Linux result is not represented as proof of cross-platform acceptance.

Acceptance parity is pinned by `scripts/ci/desktop-ci.test.mjs`: Workbench,
Toolcalls, Data, Data Product, three Control Lab suites, two Virtual Cell suites,
two App Use suites and all three MCP scenarios. MCP settings/ownership protocol
contracts and all fixture/control-lab unit tests remain in Linux build contracts.
When Automation is integrated later, its stdio and GUI acceptance must be added
explicitly; this change is based on master `81ebd851`, which has no Automation.

## Failure evidence and measurement

Each suite runs in its own test-owned process group. The runner prints start/end
checkpoints, streams output, saves an initial and final JSON receipt with actual
elapsed time, preserves command failures and reports deadline expiry as exit124.
It cleans only identity-checked descendants of that test process, including
observed detached Electron groups and resistant children. This is lifecycle
cleanup, not a cgroup sandbox: a daemon that escapes ancestry before observation
is outside that guarantee; the disposable hosted job remains the final boundary.
The six-minute suite
deadline catches hangs; it does not replace the under-ten-minute performance goal.
Every shard uploads screenshots/results and receipts even on failure. Native and
build failures remain in their original job logs. Artifact names include the
revision and suite, and the mode-specific gate rejects any unexpected failed/skipped dependency.

For acceptance, compare exact-head Actions job/step timestamps and cache-hit
outputs, report total execution critical path and queue separately, and identify
cold versus warm runs. If the target is missed, retain the failure evidence and
optimize the measured bottleneck; do not shrink coverage or call a cancelled run
successful. Branch protection should require `Linux CI gate` once this workflow is deployed;
the daily/manual result is separately named `Full-platform CI gate`. Changing
required-check settings is a separate repository operation.
