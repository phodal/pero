---
kind: issue
status: open
date: 2026-11-27
github_issue: 254
github_state: open
github_url: https://github.com/phodal/pero/issues/254
related: https://github.com/phodal/pero/issues/249
---

# Compute P1 — real PyBaMM campaign recovery and replay acceptance

Prove the full shared research flow over a real Temporal Service, Go control
plane, Rust Worker and locked CPU PyBaMM method. Reuse #59 and #220 execution
assets and historical evidence. The new acceptance observes the coordination
boundary across real process failures and human review.

## Scope

- Deliver an opt-in deployment and acceptance path with a pinned Temporal
  Service/Go SDK configuration, isolated project and predeclared two-round
  plan using the existing locked method. Run the existing independent checker
  for the numerical result.
- Keep a versioned, scrubbed Workflow history for replay. Document start,
  restart, version selection, pending reconciliation, and how a running
  campaign can finish through an orchestrator upgrade.
- Record Campaign and Workflow identities, exact Run references, physical
  solver starts, artifact and checker digests, decisions, cancellation facts,
  and unresolved cleanup in the evidence. State the actual environment and
  separate numerical consistency, scientific acceptance and deployment scope.

## Acceptance

- [x] Use the shared Project start + review path with two actual frozen CPU
  rounds and independent verification. Record the entire declared denominator.
- [x] Drop a committed dispatch response and restart the orchestrator. Observe
  the same Run and exactly one solver start for that trial.
- [x] Restart while parked at review, approve twice with the same identity,
  and submit a stale decision. Exactly one follow-up starts using the approved
  evidence version and plan revision.
- [x] Inject cancel in the submit receipt window and an expired lease in
  separate cases. Report actual stop or unresolved reconciliation under the
  original identity, with no follow-up trial for the affected campaign.
- [x] Replay a representative captured history against the supported Go Worker
  version. Keep CLI/runtime evidence sufficient for an independent rerun.

## Local acceptance — 2026-11-28

On one macOS arm64 host, Temporal CLI 1.10.1 (Server 1.32.2), PostgreSQL 17,
the Go control plane, a separate Go orchestrator process and the Rust Worker
completed the `c05-t298` and `c10-t308` rounds. Python 3.12.11 and PyBaMM
25.10.2 executed the locked method. A separate standard-library checker
confirmed all 61 samples for each round against the frozen reference.
The declared denominator was two. One physical solver start and one exact
Run receipt were observed for each condition.

The harness lost the committed first dispatch reply and restarted the
orchestrator, then restarted it again at the persisted evidence gate.
Two concurrent approvals returned the same receipt. A changed retry, stale
gate and unauthorized identity were rejected. The exact evidence and decision
remained readable after completion.

Two isolated fault Campaigns exercised a queued cancellation after submission
commit and an expired lease after observing the original solver PID. The
queued trial never started. The expired solver exited and its original Run
remained pending reconciliation. Neither fault dispatched a follow-up.

[`campaign_acceptance.py`](../../scripts/science/pybamm-sweep/campaign_acceptance.py)
runs these scenarios in CI and records the exact Run, digests, solver starts and
scrubbed history. The Go replay test covers the committed v2 history and the
history captured in each live run. The acceptance establishes numerical
consistency on the test host. Physical battery validity and hosted rollout
are separate checks.

The initial GitHub run stopped during setup on Ubuntu 26.04 because its
`setup-python` manifest does not carry the locked Python 3.12.11 build. The
acceptance job uses Ubuntu 24.04, which publishes that interpreter.

Requires [exact Run control](2026-11-27-campaign-run-control.md), the
[Campaign runtime](2026-11-27-temporal-campaign-runtime.md), and
[review and evidence](2026-11-27-campaign-review-evidence.md). See
[ADR 0037](../adr/0037-temporal-research-campaigns.md).
