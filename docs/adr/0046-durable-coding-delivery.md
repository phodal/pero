# 0046: Durable Coding Delivery and Worker Recovery

Date: 2026-11-28

Status: proposed for #277, narrowed after PR #265 and PR #276.

## Decision

Pero will treat the existing Campaign, exact Run, approval receipt, and live
Worker recovery paths as the durability baseline. PR #265 already proves the
shared Project review path with an orchestrator restart, approval receipt
deduplication, and Temporal replay. PR #276 already proves the two-device DSH
Go to Codex ACP handoff, reconciliation-gated generation change, human review,
and clean-workspace verification.

The first #277 increment is an integration slice that gives this proven path a
shared Project Delivery view and one linked evidence chain:

```text
shared Project
  -> frozen Git baseline
  -> DSH read-only analysis
  -> Codex ACP implementation in an isolated workspace
  -> human approval of one exact candidate
  -> independent verification in a clean workspace
  -> publish or close with retained evidence
```

The Delivery reuses existing Project authorization, Campaign and Task/Run
identity, generation, lease, reconciliation, Worker journal, approval receipt,
and Temporal Workflow identity. It links the existing DSH analysis, Codex
candidate, approval, and verifier evidence. A retry resumes or reconciles the
existing operation and cannot create a second stage Run.

The Go control plane continues to own project authorization, Campaign and
Task/Run records, leases, operation receipts, approval decisions, artifact
references, and final readable results. Temporal continues to own Workflow
progression, durable waits, timers, cancellation, retries, and replay. Rust
Worker, Harness, and ACP providers continue to own local processes, workspace
state, session/thread references, tool receipts, and stop evidence.

The Delivery stores stable references and bounded digests. Full session
transcripts, tool output, patches, test reports, and journals remain with their
existing owner. Unknown Worker outcomes use the existing reconciliation path.
The Delivery does not introduce a second effect or retry protocol.

The existing approval path remains bound to the exact candidate and evidence
digests. A repeated approval is idempotent. An expired, unauthorized,
rejected, or digest-mismatched decision keeps verification and publication
blocked.

The required acceptance gate for #277 is the real two-device runner from
PR #276, combined with the shared Project review and replay checks from
PR #265. These PRs remain open, so the evidence is available on their branches
and must be merged before it becomes a master-branch regression gate.

## What this does not do

This decision does not introduce a new Coding state machine, a second
orchestration service, a generic dynamic workflow editor, or a new agent
plugin platform. PR, CI, schedule triggers, elastic Worker pools, consensus
review, and general-purpose cross-device session migration remain later
stages. The two-device acceptance path transfers a reviewed candidate between
workers. It does not claim that an ACP session can resume on another device.

## Consequences

- The first implementation is a projection and evidence-linking slice over
  existing Campaign and Worker paths.
- The live recovery runner becomes the primary regression artifact for
  restart, lost reply, lease expiry, worker replacement, cancellation races,
  and late writes.
- A candidate patch, workspace revision, verification receipt, and approval
  receipt can be read back from one Delivery after Workflow history is
  compacted or closed.
- DSH-to-Codex handoff remains a candidate transfer with evidence, rather than
  an implicit conversation transfer.

## References

- [Issue #277](https://github.com/phodal/pero/issues/277)
- [PR #265: Review two-round research campaigns in Desktop](https://github.com/phodal/pero/pull/265)
- [PR #276: Default remote DSH to read-only and verify cross-device Run recovery](https://github.com/phodal/pero/pull/276)
- [Durable Coding Worker analysis](../issues/2026-11-28-durable-coding-worker-analysis.md)
- [ADR 0002: Remote task dispatch and task sources](0002-remote-task-dispatch.md)
- [ADR 0037: Temporal for durable shared research campaigns](0037-temporal-research-campaigns.md)
- [ADR 0042: Run and session projection](0042-run-lifecycle.md)
