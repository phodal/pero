---
kind: incident
status: resolved
---

# Workflow cancellation sometimes lacks the expected child terminal fact

[Standalone Harness Bazel job 126395552562](https://github.com/phodal/pero/actions/runs/41775742522/job/126395552562)
at head `96cba6a4399431c4aaf535fd7352ec74c6b4634f` failed
`TestWorkflowCancellationJoinsProcessAndChildren/cancel_child`:
`lifecycle_test.go:91: cancelled child terminal records=0 want one`.
The other 34 standalone packages, including nativetools, passed. The parallel
Harness Go contracts job passed the complete suite.

The assertion requires one workflow/agent-end fact with cancelled outcome,
aborted status and a nonempty child identity after the workflow joins cleanup.
The CI log does not show whether the record is absent or has different fields.
The failing Workflow package was introduced earlier in this PR; this is not
classified as an upstream-master failure.

On macOS arm64 the unchanged focused case passed 30 race runs, then 200 more
using a temporary Go overlay that prints the original Session events on failure.
The complete local Go race suite also passed. These retries do not establish
the root cause or a fix. Preserve the terminal/effect assertions and capture
the actual record fields on recurrence before changing cancellation behavior.
No production workaround, delay or relaxed assertion is introduced.

The same assertion recurred in Harness Go CI at head `7877a5fa`, job
126677025387 of run 41859450156, while the standalone Bazel job passed.
The assertion now includes every observed workflow/agent-end payload on
failure so a new Linux recurrence distinguishes absence from an empty child
identity or a different terminal status. Local full Go tests and the targeted
package still pass; this diagnostic change is not a root-cause fix.

## Root cause and correction (2026-11-10)

[Standalone Harness job 129626059983](https://github.com/phodal/pero/actions/runs/42754635967/job/129626059983)
at `a8865186` exposed the recorded child as `failed`/`failed`, with a valid
identity. Linux Go 1.26.4 stress with diagnostic-only overlays reproduced it
once in 2,000 focused runs and twice in 1,000 race runs. The provider's actual
result was `failed`/`error`, diagnostic `context canceled`; cleanup itself was
not failing. A further 4,000-run diagnostic batch reproduced it three times.

Activation teardown withdraws the exact child through `RemoveExact` before
calling the one-shot provider's `Cancel`. The child's prompt can therefore
return `context.Canceled` while the provider's separate lifetime is still
live. `inProcessProvider.Prepare` checked only that lifetime and incorrectly
classified the child's cancellation as a provider failure. Workflow correctly
persisted the result it received.

The existing provider outcome branch now recognizes cancellation/deadline
errors returned by the child as well as its own cancelled lifetime. The
retirement order, actual cancellation, cleanup joins and workflow terminal
assertions are unchanged. No retry, delay, skipped assertion or timeout
increase is involved.

`TestInProcessTerminalOutcomes` makes the two cancellation authorities
explicit. Its child-only row fails deterministically before the fix with the
same `failed`/`error`/`context canceled` result. Its deadline row also fails
before the fix. All five rows pass 100 race repetitions after the fix, including
ordinary provider failure (with its diagnostic) and success (with its output). The test waits for model entry, cancels the selected authority,
checks the exact terminal identity/status and joins retirement before checking
provider exit. The complete standalone Harness Go 1.26.4 suite passes.

Race-enabled full `subagents` and `harness` package suites also pass.

The unchanged workflow cancellation assertions pass 1,000 race repetitions of
all three modes (3,000 cases, 316 seconds) with the fix. The standalone Bazel
provider terminal-outcome table also passes all five rows. With the installed
Node directory explicitly in its test PATH, the standalone Bazel workflow
cancellation test executes and passes all three modes (no skips). Full local Bazel
suite execution is limited by its sandbox's denied Git random-byte access in
existing worktree fixtures; this is separate from cancellation correctness.

Final-tree `go test -race -count=1 ./...` with Go 1.26.4 passes all 37 Harness
packages. Build/cache/temp directories were moved to workspace storage after
local `/tmp` capacity failures; those setup failures are not counted as test
passes or lifecycle regressions.
