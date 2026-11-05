---
kind: issue
status: resolved
date: 2026-11-05
---

# Queued notices can start a turn after cancellation or retirement

The frozen Terminal-Bench BN trace ends its human turn normally, then opens a
plugin turn for a queued Bash completion notice during shutdown. That turn
records `runtime: run is inactive` without another provider request. Other
closed traces retain `agent generation is retired` or cancellation in the same
tail position, including tasks whose official verifier passes. These errors
are separate from candidate correctness and do not justify changing rewards.

The worker can already be waiting on its activity lock when retirement or
scope cancellation occurs. `runTurn` currently opens `turn/start` and claims
durable input before checking whether the generation and execution context
still permit a new turn. That can consume an otherwise recoverable notice
and create a misleading failed turn during shutdown.

Treat turn entry as the admission boundary: reject an already canceled context
or retired generation before opening the native turn or claiming its input.
Keep errors from turns that genuinely started before cancellation. Turn entry
must leave unclaimed inbox messages intact; explicit Host removal retains its
separate authority to discard them. Do not introduce automatic retries.

Use deterministic entry cases for live, canceled, expired and retired agents.
Assert native turn records, provider effects and retained inbox identity, then
run the core and ACP/native-tool lifecycle regression suites. This does not
claim a benchmark score or token improvement and does not alter frozen runs.

## Resolution and verification

Turn entry now checks its context and existing operation admission before any
turn record or inbox claim. The regression fails before the fix: canceled and
expired contexts consume the notice and record an aborted turn; retired states
are not rejected. Afterward all four invalid states preserve the pending input,
produce no new turn and make no provider call; the live control still runs once.
The retired case models the manager's seal before cleanup, because explicit
Host removal intentionally discards pending work under its separate contract.

The complete Harness, native-tools, ACP and ACP CLI race suites and their vet
checks pass. The standalone Harness Bazel target also passes. These checks
validate the entry rule, not elimination of every historical shutdown error.
Turns that started before retirement remain observable. See the
[failure review](../fitness/terminal-bench-failure-repair-review.md) for the
separate candidate, service and environment findings.
