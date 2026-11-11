# ADR 0034: Auditable memory projections before service adoption

- Date: 2026-11-11
- Status: Accepted for the #161 research decision; runtime implementation deferred
- Issue: [#161](https://github.com/phodal/pero/issues/161)
- Evidence: [frozen evaluation](../fitness/memory-recall-evaluation-2026-11-11.md),
  [acceptance receipts](../../scripts/memory-eval/acceptance-results.json)

## Context

Pero already owns journals, Markdown memory, Insights analysis and optional
external Engram composition. Sidebar Session Search searches titles, not complete
transcripts. Creating another memory database or background worker would add an
owner before evidence establishes a benefit.

On the same 15 synthetic records, 25 frozen queries and 20-hit cap, actual
search_files covers 11/12 positive questions and agrees with 24/25 authored
admission decisions. Engram and Hindsight chunks both cover 11/12 and agree with
23/25. Both stale indexes abstain after source changes until rebuilt. Hindsight
returns 139 candidates versus Engram's 34 and native search's 32. The synthetic
hash embedding is a test seam, so this does not rank semantic model quality.
Hindsight's actual reflect call cannot run with provider `none`.

A reviewed Markdown projection preserves a single-source failure and a two-source
conflict. Its 651-byte single-source output exceeds the 571-byte source; its
839-byte conflict output is smaller than 1,254 bytes of retrieved source text.
Neither result measures answer quality, tokens, or the cost of LLM organization.
LangMem's real CRUD overwrites one key unless the caller retains history.
Graphiti's temporal/episode APIs fit the vocabulary, but graph execution has no
configured backend in this experiment. No paid model was invoked.

## Decision

**Reuse contracts; do not adopt another memory service now.** Keep journals and
existing Markdown as source owners, Insights as the analysis owner, and Engram
as an optional replaceable derived store under its current admission policy.
The evaluation's Python domain types are research code, not a production gateway
or a second canonical memory owner.

Any later projection must carry source ref/hash, project, observed/valid time,
conditions, supersession, verification support and withdrawal. Retrieval only
proposes evidence. One domain admission function decides current eligibility;
transport, storage and UI consume that decision. Verification requires a matching
run/verifier receipt; remembered prose never turns an unsupported result into PASS.

Reviewed Markdown is a derived, inspectable representation. Explicit approval
activates a version. Current source checks apply at publication and consumption;
revocation hides dependent context, and rollback cannot resurrect unavailable
sources. Audit history is retained separately from active context and is not a
privacy-erasure guarantee. Missing evidence yields abstention. Failure or
cancellation before checkpoint publication does not advance the watermark.

## Boundaries and sequencing

| Stage | Boundary | Required evidence before product adoption |
| --- | --- | --- |
| P0, research delivered | Frozen source admission, real search/Engram/Hindsight process receipts, candidate pins and license/dependency inventory | This record; no runtime import or default behavior change. |
| P1, deferred | Explicitly enabled analysis of ended sessions; existing Automation owns triggers, Insights owns analysis, existing Markdown owner owns reviewed versions | Real source exports, incremental checkpoint/retry/cancel, permission and secret handling, user review/revoke UI, measured bounded context. The local deterministic PoC proves these value/file transitions only. |
| P2, deferred | Model extraction/organization, semantic retrieval or graph backend | Separately authorized synthetic/public corpus experiment with identical model/query budgets, complete usage and error receipts, and a demonstrated benefit over search. Private-session collection is not a prerequisite. |

Reuse existing Automation rather than LangMem's queue or a new sleeping thread.
No default silent collection, synchronization, background deployment, global
memory database or tenant ACL inferred from a caller-selected namespace/bank.
No new Notebook, environment, execution or scientific-result owner is introduced.

## Consequences

Hindsight's PostgreSQL, embedding/reranking and reflection dependencies remain
external optional evaluation concerns. LangMem and Graphiti are not runtime
dependencies. Managed Agents Knowledge Wiki is a pinned design reference, not a
Pero feature or an accepted upstream cost estimate. Installed license metadata
includes unknowns; root licenses do not approve redistribution of every dependency.

The original research can conclude with this evidence and explicit unscored
limits. A paid model run, deploying every candidate, benchmark generalization,
full Host integration and scientific validation are future adoption evidence,
not newly invented prerequisites for completing this research issue.
