# 0046: Durable Coding Delivery and Worker Recovery

Date: 2026-11-28

Status: proposed for #277. Implementation is staged through `CodingWorkflow v1`.

## Decision

Pero will model a coding task as a `Coding Delivery` with one stable Temporal
Workflow ID. The first delivery path is fixed:

```text
shared Project
  -> frozen Git baseline
  -> DSH read-only analysis
  -> Codex ACP implementation in an isolated workspace
  -> human approval of one exact candidate
  -> independent verification in a clean workspace
  -> publish or close with retained evidence
```

The delivery reuses the existing Project authorization, Task/Run identity,
generation, lease, reconciliation, worker journal, and receipt mechanisms.
Each stage receives a stable operation ID. A retry resumes or reconciles that
operation and cannot create a second stage Run.

Temporal owns stage progression, durable waits, timers, cancellation, retries,
child workflows, and bounded Workflow state. The Go control plane owns project
authorization, Task/Run records, leases, operation receipts, approval
decisions, artifact references, and final readable results. Rust Worker,
Harness, and ACP providers own local processes, workspace state,
session/thread references, tool receipts, and stop evidence.

Workflow state stores stable references and bounded digests. Full session
transcripts, tool output, patches, test reports, and journals remain with their
owning component. Every side effect has an effect owner and a pre-execution
claim. If a worker or network call ends with an unknown outcome, the delivery
enters reconciliation or review. It does not guess and repeat a prompt, tool
call, commit, or publish operation.

Approval is bound to `gate_id`, `base_sha`, `patch_sha256`, the plan digest,
and the verification digest. A repeated approval is idempotent. An expired,
unauthorized, rejected, or digest-mismatched decision keeps verification and
publication blocked.

## What this does not do

This decision does not introduce a generic dynamic workflow editor, a second
orchestration service, or a new agent plugin platform. PR, CI, schedule
triggers, elastic Worker pools, consensus review, and general-purpose
cross-device session migration remain later stages. An ACP adapter must state
its session recovery boundary instead of claiming recovery that the provider
cannot prove.

## Consequences

- The first implementation has one explicit Coding state machine and a small
  number of stage Activities.
- Restart, lost reply, lease expiry, worker replacement, cancellation races,
  and late writes become acceptance cases for the delivery rather than
  incidental transport behavior.
- A candidate patch, workspace revision, verification receipt, and approval
  receipt can be read back from one Delivery after Workflow history is
  compacted or closed.
- DSH-to-Codex handoff is a stage boundary with evidence, not an implicit
  conversation transfer.

## References

- [Issue #277](https://github.com/phodal/pero/issues/277)
- [Durable Coding Worker analysis](../issues/2026-11-28-durable-coding-worker-analysis.md)
- [ADR 0002: Remote task dispatch and task sources](0002-remote-task-dispatch.md)
- [ADR 0037: Temporal for durable shared research campaigns](0037-temporal-research-campaigns.md)
- [ADR 0042: Run and session projection](0042-run-lifecycle.md)
