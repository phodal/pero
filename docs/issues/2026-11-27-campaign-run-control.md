---
kind: issue
status: open
date: 2026-11-27
github_issue: 251
github_state: open
github_url: https://github.com/phodal/pero/issues/251
related: https://github.com/phodal/pero/issues/249
---

# Compute P1 — exact Run control and retry-safe campaign submission

The current client Task view and cancel command follow `current_run_id`. A
campaign that still holds an earlier generation needs to inspect or stop the
original Run. Existing create and dispatch receipts are scoped to the logical
client, and dispatch may reuse an active Run for the same Task. Make the stable
operation identity and immutable trial binding explicit at the Go owner.

## Scope

- Introduce the typed trial submission identity and exact `RunRef` (`task_id`,
  `run_id`, `generation`). Keep the existing Task/Run and lease model. Reuse its
  transaction-backed receipts and freeze the trial payload before dispatch.
- Expose project-authorized operations for ensuring a trial Run, reading the
  original submission receipt, and observing or cancelling the exact Run.
  Repeat requests under a stable logical identity, including after process
  restart or credential rotation.
- Resolve dispatch and cancel against the same operation at the existing Go
  owner. A cancel recorded before dispatch fences that operation. If dispatch
  committed first, use its receipt to cancel the original Run. Preserve
  pending reconciliation when the original owner cannot confirm the effect.
- Keep current Task-level callers and the existing Worker claim, lease and
  completion paths usable.

## Acceptance

- [x] A committed dispatch with a dropped reply is recovered with the original
  exact `RunRef` and a single queued or running execution. Test with the real
  PostgreSQL receipt path.
- [x] Reusing an operation with a different frozen payload is rejected. An
  intentional second trial receives its own binding and Run.
- [x] After a newer generation starts, observing or cancelling the earlier
  Run leaves the newer generation untouched. A client from another project
  cannot read the receipt or operate either Run.
- [x] Both commit orders for cancellation and dispatch are covered. A pending
  or absent reply never yields an invented stop confirmation or a new Run.
- [x] An expired lease remains `reconcile` under the original identity.

## Local verification — 2026-11-28

The v1 client API now offers exact Run read and cancellation plus project-scoped
trial submission, receipt lookup and cancellation. The trial identity is scoped
to the logical client. Task creation, dispatch and the receipt commit together.
A replacement Desktop credential and a reopened database connection see the
same receipt. An ineligible Worker dispatch leaves the operation uncommitted and
the project has no residual draft.

Local PostgreSQL 17 acceptance covered a dropped HTTP reply after commit, both
cancel/dispatch orders and concurrently issued requests, historical Run access,
project isolation, and the existing lease reaper. It observes Run identities and
control-plane state. Physical solver starts and Temporal restart and replay
belong to [#254](https://github.com/phodal/pero/issues/254).

## Agent Worker follow-up — 2026-11-28

An enrolled Worker with a known incompatible Agent was previously accepted as
an explicit target and could never claim its queued Run. A lost lease also
left the device fenced without an operator resolution path. Explicit placement
now uses the same project and capability predicate as claim. A targeted Run
can queue while its eligible Worker is offline.

An operator can record verified non-start or stop evidence on the exact Run.
The Go server retains `reconcile` and the original receipt and releases the
slot only when the new settlement receipt is present. Managed infrastructure
still requires confirmation of release from its resource owner. Agent Worker
recovery retains its review Journal even when Cloud acknowledged every event.
[Agent Worker control and operator procedure](../../server/README.md#resolve-an-agent-worker-quarantine)

Loopback acceptance used the Go server, PostgreSQL 17, the Rust Worker, and a
deterministic ACP subprocess. After the first prompt, expiring the original
lease stopped that subprocess and retained its Journal. The operator receipt
was readable through the original Run reference and stable across retries.
Restarting the Worker after recording the receipt submitted no prompt. An
explicit dispatch created the next generation, which completed after exactly
one new prompt. The original Run remained `reconcile` throughout.

Design owner and implementation boundary are in
[ADR 0037](../adr/0037-temporal-research-campaigns.md).
