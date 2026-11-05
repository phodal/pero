---
kind: incident
status: resolved
---

# Structured completion skips the stop gate

A selected Workflow child can call `structured_output` and finish without
running its `SubagentStop` command hooks. Independent reproduction observed one
provider request, a completed child and zero stop events. A plain-text child
does run the hook and can be asked to continue.

The loop returns immediately when a trusted tool result has `ConcludesTurn`.
That branch bypasses `TurnStopping`. Simply emitting the hook is insufficient:
structured capture has already sealed the candidate, and its guard would reject
the revised submission after hook feedback.

The fix must apply one stop gate to both completion paths, reopen the structured
candidate only when the same worker turn actually continues, and preserve
capture admission, nested execution rollback and the ordinary no-feedback exit.
Conclusion submissions must not reset the consecutive stop-feedback counter;
ordinary tool work continues to reset it.

The loop now routes both completion paths through the same stop gate. On a real
next step in the same turn, structured capture releases only its committed
candidate; staged and nested pending captures retain their existing exact-token
commit/rollback rules. Conclusion submissions retain the consecutive gate count.

`go test -race ./pluginruntime ./subagents ./harness` and the corresponding
`go vet` pass. The lifecycle test runs real plain-text and structured children:
with a one-continuation cap, each executes twice, writes two stop events and
finishes; the structured parent receives attempt 2 rather than rejected attempt
1. An independent two-level nested-tool reproduction also passes. No model or
external service is needed for these checks.
