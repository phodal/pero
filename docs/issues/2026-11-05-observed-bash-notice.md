---
kind: issue
status: resolved
date: 2026-11-05
---

# Reading a settled Bash result leaves its completion notice queued

The native HumanEval/116 Session reads the failed job with TaskOutput at seq
1655/result 1657, then receives the same job's completion notice after the main
turn ends (seq 12055). The extra plugin turn is cancelled during ACP shutdown.
TaskOutput retrieval and the durable completion inbox currently have no shared
observation boundary. The independent candidate verdict still passes.

Use a committed native TaskOutput/TaskStop terminal receipt, matched to its
call and exact owned task, to withdraw the equivalent completion notice from
the existing inbox. Remember its stable identity even if publication races
after retrieval. Rebuild this observation from Session history during recovery.
Running, timed-out, missing or mismatched retrievals must retain their notices;
failed task execution with a successfully retrieved terminal receipt counts as
observed. Preserve the original task result and unrelated pending messages.

Regression coverage must include queued and later notification publication,
terminal failures, nonterminal reads, reused call IDs, disk resume and ordinary
unread-job wakeup. Use existing inbox locking, persistence and exact-message
removal rather than a second notification queue.

## Resolution and verification

The existing shell journal fold now recognizes committed native terminal-read
receipts. Pre-step, turn-stop and disk-resume reconciliation acknowledge the
same immutable inbox identity under the existing claim lock and persistence
barrier. Unread completions still wake the parent; executing a failed command
is distinct from successfully retrieving its failure.

Core cases cover exact task identity, failed/stopped results, nonterminal reads,
replacement provenance and reused call IDs. Real FIFO-backed commands cover
successful/failed/stopped retrieval and disk recovery without an extra request.
The actual ACP CLI test now expects one turn after TaskOutput, while the unread
completion case still requires its automatic second turn. The six related Go
race suites and vet pass. The native/harness/engineering-profile/CLI standalone
Bazel targets pass.
Live provider evidence is recorded in [the native sample](../fitness/evalplus-native.md).
