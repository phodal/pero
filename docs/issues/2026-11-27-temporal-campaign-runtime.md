---
kind: issue
status: open
date: 2026-11-27
github_issue: 252
github_state: open
github_url: https://github.com/phodal/pero/issues/252
related: https://github.com/phodal/pero/issues/249
---

# Compute P1 — Go Temporal runtime for a finite research campaign

A shared research campaign must continue after the client closes, the
orchestrator restarts, or a start reply is lost. Temporal owns the live phase
and timers. The Go control plane retains admitted campaign identity and exact
execution and evidence references.

## Scope

- Model a typed `ResearchCampaign` and immutable plan reference with explicit
  rounds, trial identity, concurrency and stopping limits. Keep domain
  transitions deterministic and independent of the Temporal SDK.
- Add manual start and read operations for one authorized shared project.
  Persist start intent before contacting Temporal. Recover the same intent
  through a stable Workflow ID and reject a changed plan for the same request.
  Provide a visible pending start and reuse the same intent on an interrupted
  handoff. Record completion references independent of Temporal history retention.
- Add an opt-in Go orchestration process. Use the existing Go control plane
  for project admission and exact Run operations. Use short Activities plus a
  durable Timer for Run observation. Carry references and bounded summaries in
  Workflow history.
- Hold dependent phases while an original Run is unresolved. On campaign
  cancellation stop scheduling new trials and associate remaining cleanup
  obligations with the original operation and Run identities.

## Acceptance

- [ ] Losing the start acknowledgement and retrying returns one campaign and
  one Workflow execution for the same request. A start intent saved before an
  unavailable Temporal Service can be resumed without changing its identity.
- [ ] Restarting the orchestrator while the execution is active keeps the
  same Campaign, plan revision and Run. It resumes observation without
  dispatching another computation.
- [ ] A campaign with an unresolved Run can be retrieved with explicit pending
  reconciliation and its responsible operation and Run references.
- [ ] On a deterministic test case, the Workflow preserves concurrency and trial
  limits across restart and stops at the frozen plan's terminal condition.
- [ ] Once the Workflow closes, the campaign and its evidence references remain
  retrievable under the original project's permissions.

Requires [exact Run control and retry-safe campaign submission](2026-11-27-campaign-run-control.md).
See
[ADR 0037](../adr/0037-temporal-research-campaigns.md).
