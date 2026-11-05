---
kind: incident
status: open
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
