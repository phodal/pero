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

- [ ] Use the shared Project start + review path with two actual frozen CPU
  rounds and independent verification. Record the entire declared denominator.
- [ ] Drop a committed dispatch response and restart the orchestrator. Observe
  the same Run and exactly one solver start for that trial.
- [ ] Restart while parked at review, approve twice with the same identity,
  and submit a stale decision. Exactly one follow-up starts using the approved
  evidence version and plan revision.
- [ ] Inject cancel in the submit receipt window and an expired lease in
  separate cases. Report actual stop or unresolved reconciliation under the
  original identity, with no follow-up trial for the affected campaign.
- [ ] Replay a representative captured history against the supported Go Worker
  version. Keep CLI/runtime evidence sufficient for an independent rerun.

Requires [exact Run control](2026-11-27-campaign-run-control.md), the
[Campaign runtime](2026-11-27-temporal-campaign-runtime.md), and
[review and evidence](2026-11-27-campaign-review-evidence.md). See
[ADR 0037](../adr/0037-temporal-research-campaigns.md).
