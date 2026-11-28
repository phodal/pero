---
kind: issue
status: open
date: 2026-11-27
github_issue: 253
github_state: open
github_url: https://github.com/phodal/pero/issues/253
related: https://github.com/phodal/pero/issues/249
---

# Compute P1 — authenticated campaign review and retained evidence

The reviewer needs to see which computation finished, what its independent
checker found, and the exact follow-up they are approving. This decision must
survive client and orchestrator restarts and remain available after the
Campaign Workflow closes.

## Scope

- Read the original Run and its authorized evidence. Bind the verification
  record to the fixed inputs, method, environment, Run and output digest.
  Use the existing independent checker and artifact or result paths. Keep
  failed, cancelled and missing trials in the declared denominator.
- Expose the campaign's active review gate and evidence in the existing shared
  Project entry. Separate Run outcome, verification outcome, and human decision.
  Access to the reviewed result follows existing project authorization.
- Use an authenticated Pero decision operation and a distinct Workflow Update
  identity. Bind it to the gate, frozen plan revision and evidence reference.
  Persist the accepted decision and reviewer before issuing the next Run.
  Treat decision re-delivery as a replay of the original decision. An expired
  or superseded gate leaves the next round unapproved.

## Acceptance

- [ ] A researcher can open the exact Run evidence in the shared Project,
  review the checker result, and accept or reject the predeclared follow-up.
- [ ] Restart while waiting for the decision, reopen the Project, and confirm
  it shows the same gate, plan revision and evidence. A duplicate approval
  produces one receipt and only one follow-up Run.
- [ ] A stale gate, an expired decision or an unauthorized reviewer cannot
  advance the workflow. The workflow exposes the actual reason.
- [ ] A successful process with missing, altered or failing evidence remains
  distinct from verified. Failed, cancelled and missing trials remain visible.
- [ ] A completed Campaign can be reopened to inspect the immutable decision
  and evidence after its live Workflow state is unavailable.

Requires the [finite Campaign runtime](2026-11-27-temporal-campaign-runtime.md)
and [exact Run operations](2026-11-27-campaign-run-control.md). See
[ADR 0037](../adr/0037-temporal-research-campaigns.md).
