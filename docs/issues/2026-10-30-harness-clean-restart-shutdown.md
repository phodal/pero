---
kind: incident
status: resolved
date: 2026-10-30
---

# Clean-restart acceptance rejected pending shutdown

The Windows Harness Go job in [CI 41007545073](https://github.com/phodal/pero/actions/runs/41007545073/job/123905744251)
failed `TestCleanRestartRetainsHistoricalChildWithoutReplayingEffects` at
`restart_test.go:78`: `harness: shutdown is in progress`. This job runs the
unchanged Harness code while verifying the Computer Use acceptance follow-up.

`Harness.Dispose` requests terminal shutdown and legitimately returns
`ErrHarnessDisposalInProgress` when child cleanup remains admitted. `Drain` is
the final shutdown receipt. The restart test incorrectly required the initial
request to finish synchronously, even though it already awaited the final
receipt afterward. Scheduling changes can expose this on any platform.

Accept only the documented pending sentinel from each Dispose request, then
retain the mandatory successful Drain before reopening persistence or asserting
that models/effects were not replayed. Keep all durable-history and effect-count
assertions. No production shutdown logic, timeout, delay or retry is changed.

Local verification: the original test passed 30 race runs on macOS (the reported
failure is from the Windows CI run above). With the documented pending receipt
accepted, 100 race runs and the full `subagents` package race suite pass. The PR
still requires its Windows CI check before merge; no Windows execution is
inferred from the macOS runs.

## Approval acceptance recurrence

The same incorrect synchronous-disposal assumption also exists in
`TestApprovalIsScopedDurableAndFailClosed`. It failed in
CI job 124198996658.
Before this follow-up, the unchanged test reproduced the identical pending
sentinel 11 times in 10,000 local race runs (Go 1.26.4; 46.889 seconds), without
a race-detector finding. A short 100-run sample had passed.

The approval test now accepts only `ErrHarnessDisposalInProgress` and then
requires successful `Drain`. Its approval event order, tool effect count,
scope and fail-closed assertions are unchanged. This is a test lifecycle
correction, not a change to production disposal semantics.

The follow-up passed [CI 41142498082](https://github.com/phodal/pero/actions/runs/41142498082)
on exact head `076bbdba196beb9ab14ff0c298148ecfc4b8dffd`: all 18 checks were
green, including the Windows Harness Go job. This records CI execution, not an
additional local test run.
