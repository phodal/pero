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

## First split run and revised feedback tiers

Run `41204251625` took **16m07s** end to end, not under ten minutes.
The Linux producer took 11m51s with cold Cargo and bindgen caches. Its build step
was 8m53s, including 4m59s in App/reader preparation (bindgen 1m27s and GPUI Wasm
cold compilation 2m22s), plus about one minute for the separate connector worker.
npm and Go caches hit. The next same-PR run should check Cargo exact key
`v0-rust-desktop-Linux-x64-b68de317-e300d015` and tool key
`wasm-bindgen-Linux-X64-0.2.127-v1`: the producer uploaded about 943 MB of Cargo
cache and saved the bindgen cache. The old PR's Cargo key ended in `517c8f6c`;
its restore prefix was unchanged. Dependency/path versions and PR scope changed,
so logs do not isolate one cause for the miss. GitHub's [cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache)
prevent one PR from reusing another PR's merge-ref cache. Default-branch push/daily
runs can maintain the compatible shared cache after deployment. No cache security
boundary is bypassed. All 14 acceptance jobs started together after the producer;
11 passed, three Control Lab scenarios failed and require actual fixes. MCP
persistence/transport were the longest shards, about four minutes including setup.

The later run `41209081679` again missed both Cargo and bindgen caches:
its build job took about 12m25s and the complete run 14m58s. Its three GUI
failures exposed stale navigation clicks, not a successful fast tier. Cache-hit
claims cannot substitute for observed results.

The user then authorized moving complete Desktop compilation and GUI acceptance
to daily/manual runs. No test is physically deleted. Ordinary PR/push now runs
Linux core contracts, not Desktop smokes; full runs retain all fifteen scenarios.
Moving a failing scenario to daily is not a fix or a passing result.

| Tier | Coverage | Explicit limitation |
| --- | --- | --- |
| Ordinary + daily | Contracts/Runtime/Host/Worker Rust, actual Host stdio, SQLite/ACP recovery, App Use permissions, MCP ownership, science/Go/Bazel/AST checks | No rendered Desktop or native GUI acceptance |
| Ordinary + daily | Independent Desktop and Web TypeScript graph in `scripts/ci/tsconfig.core.json`, model/unit tests | Excludes Wasm-dependent frontend entrypoints and Product shell; no fake declarations |
| Daily/manual | Complete three-platform build/typecheck and fifteen real Desktop scenarios | Required to establish rendering, scientific workflows and GUI recovery behavior |

Master `9af37ba4` restored the normal registry checksums in the committed
workspace lock. Core now uses directly validated `cargo test/build --locked`
without a GPUI checkout or temporary lock edits. It compiles only
Contracts/Runtime/Host/Worker, not GPUI, Reader or Wasm. Full Desktop builds still
use the existing pinned GPUI source preparation and wrapper. The generated Host binary
is exercised directly; no cached GUI runtime is accepted as a substitute.
Ordinary checks do not prove UI correctness or complete frontend type safety.
Both cold and warm latency require actual exact-head Actions measurements.

## Execution graph

- Generated contracts and CI runner tests provide early, cheap failure evidence.
- Ordinary PR/push runs Linux only, as explicitly requested. Daily at 20:00 UTC
  (04:00 UTC+08) and manual `workflow_dispatch` run Linux/macOS/Windows builds,
  Go/Bazel/Harness and Windows positive ACL tests. Native Computer Use follows
  the same split. Scheduled runs use the default branch. On a PR, an operator can
  add the `ci:full` label to run the full matrix at that exact head and remove it
  to return to the ordinary tier. GitHub cannot filter label names in the trigger:
  other label changes rerun the currently selected tier, rather than emitting a
  misleading skipped required gate; they cannot cancel an active main CI run.
  Native Computer Use has no PR path filter, so manual full works for every PR.
- Daily/manual selected OS jobs retain complete build, typechecks, generated
  checks, Rust tests, Host contracts and transport tests. Ordinary core jobs
  do not depend on a Desktop build or runtime artifact.
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
- `Linux CI gate` requires every ordinary Linux contract job, including core.
  Only Desktop Linux build, other-OS Desktop builds, Desktop acceptance and
  Windows ACL jobs may be skipped in normal mode.
  `Full-platform CI gate` requires all fifteen acceptance shards and all jobs,
  including Windows positive ACL and macOS/Windows builds. Failure/cancellation of any required job rejects the gate;
  the Linux result is not represented as proof of cross-platform acceptance.

Daily acceptance parity and the independent core command coverage are pinned by `scripts/ci/desktop-ci.test.mjs`: Workbench,
Automation, Toolcalls, Data, Data Product, three Control Lab suites, two Virtual Cell suites,
two App Use suites and all three MCP scenarios. MCP settings/ownership protocol
contracts and all fixture/control-lab unit tests remain in Linux build contracts.
After integrating master `aa24514a`, Automation model/contract checks and real
Host stdio lifecycle tests run in the ordinary tier. Its complete crash/restart
and operator-reconciliation GUI runs as the fifteenth daily/manual shard. The
owned-Electron cleanup and ACP fixture regressions remain ordinary Linux checks.
These fixtures make no real provider calls.

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
optimize the measured bottleneck; do not silently drop a tier or call a cancelled
run successful. Branch protection should require `Linux CI gate` once this workflow is deployed;
the daily/manual result is separately named `Full-platform CI gate`. Changing
required-check settings is a separate repository operation.
