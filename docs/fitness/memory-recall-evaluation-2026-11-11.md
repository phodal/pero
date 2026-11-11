---
kind: verification_report
date: 2026-11-11
github_issue: 161
github_state: open
github_url: https://github.com/phodal/pero/issues/161
---

# Memory recall: reproducible bounded evaluation

Decision: **reuse contracts only** for further memory research; keep the existing
optional external Engram integration. This experiment provides no evidence to
adopt a new memory service, notes database, background reflection worker or Wiki
writer. It does not close the broader [#161 research issue](https://github.com/phodal/pero/issues/161).

## Existing owners and actual baseline

Inspected Pero base `561e2850157f3a0b406289dba9488206188451ab`:

- `crates/pero-ui/src/sessions_view.rs` filters session titles. It is not a
  cross-session transcript-body search API. Here, **search_files** means the
  actual `harness/go/fstools` search/read implementation over explicit synthetic
  exports, invoked by an evaluation bridge. Export and retrieval integration
  would still be needed before offering this as a Transcript Search product.
- `crates/pero-host/src/insights.rs` and `crates/session-analysis` own the
  deterministic journal fold. Its short excerpts and tool status omit complete
  tool output/arguments/thinking. `apps/insights/ui-src/work-recap-model.mjs`
  supplies an empty memory context. Brief generation is an ordinary App Agent
  session; a brief is not verified scientific evidence.
- `crates/pero-runtime/src/engram.rs` owns optional external process composition,
  separate canonical-workspace data directories and tool admission. Read tools
  are allowed, save/update require approval, and deletion is not exposed by
  Host's policy. Insights remains excluded. Existing Markdown memory layers and
  Host journals retain their current owners. No production code changed here.

The earlier nine-record Engram/Hindsight trial in
[the #162 record](../issues/2026-11-07-engram-beside-insights.md) remains historical
evidence. Its `topic_key` overwrite and same-database `all_projects` findings
informed this setup. Its Hindsight chunks-mode recall and unavailable reflect
result are **not** new measurements in the present 25-question experiment.

## Frozen experiment and receipts

[Reproduction commands](../../scripts/memory-eval/README.md),
[fixtures](../../scripts/memory-eval/fixtures.json),
[compact measured receipts](../../scripts/memory-eval/results.json) and
[source manifest](../../scripts/memory-eval/sources.json) are committed.

Fifteen synthetic records span two projects and multiple sessions. Twenty-five
fixed questions include 12 positive expectations and 13 expected abstentions.
Fixture SHA-256:
`96db2e049abd9ed1f5e1c838a83c87f03c3e9ffa0504de3661701dbc54646352`.
Both retrieval arms receive the same frozen literal queries, with a 20-hit cap,
full readback, no model, expansion or retry. Golden answer labels never enter
backend notes or queries. The no-memory control receives no references.

The Python frozen domain values and pure `assess` function implement an
**evaluation-only** contract. Temporal bounds, conditions, corrections,
verification state and source identity are authored annotations. They are not
LLM extraction results. The gate checks actual current bytes against the stored
hash before using a source. A synthetic verifier receipt must identify the same
source and value; an existing citation alone does not establish support.

All producer processes close before fresh readers start. Revocation, source
removal, direct experimental note deletion, reader restart, source replacement
and fresh-store rebuild happen in isolated directories. Alpha queries use
`all_projects=true` while beta has its own store, matching the existing directory
boundary. The runner grants `mem_delete` only to its experimental process and
does not change Host admission. Old synthetic databases remain audit artifacts;
physical erasure of SQLite pages, WAL, backups or cloud copies was not tested.

## Measured results

Final recorded run `run-07`: Python 3.12.11, Darwin 27.2.0 arm64, clean Engram
v1.20.0 at `ba9e46ced152c37a7cb9e576153c41995873e2fc`. `run-06` and `run-07`
have identical 75 deterministic outcomes, including raw ID sets, source hashes,
admitted IDs and rejection reasons, after ignoring ranking ties and timing.

| Measure | No memory | search_files | Engram MCP |
| --- | ---: | ---: | ---: |
| Positive questions with all expected raw IDs | 0/12 | 11/12 | 11/12 |
| Explicit gate decisions matching fixture | 13/25 | 24/25 | 23/25 |
| Raw reference/hash readback matches | 0/0 | 32/32 | 31/34 |
| Wrong-project raw hits | 0 | 0 | 0 |
| Query/readback operations | 0 | 57 | 59 |
| Received JSONL UTF-8 bytes | 0 | 38,581 | 73,510 |
| Median retrieval milliseconds | — | 1.051 | 0.480 |
| p95 retrieval milliseconds | — | 1.505 | 1.007 |

The no-memory 13/25 figure is trivial abstention agreement, **not 13 answered
questions**. Neither gate agreement nor readback validity measures LLM answer
accuracy or scientific correctness. Engram's invalid raw readbacks are a note
with no source, a deleted source and a changed source; the gate rejects all three.
Expired and revoked sources can still have a correct hash and are separately
rejected. Isolation here covers the two explicitly separated synthetic stores,
not every multi-tenant threat model.

| Fixed questions | Observed result |
| --- | --- |
| Q01–Q04 current correction, history, version and unspecified condition | Both retrieve old/new variants; gate selects valid evidence or reports conflict. |
| Q05 expired rule | Both retrieve it; gate abstains. |
| Q06–Q08 conflicting result, supporting receipt, unverified result | Both retrieve related records; gate preserves conflict, admits the matching synthetic receipt, or abstains. |
| Q09 failure trace | Both return the source-linked software failure record. |
| Q10–Q11 absent topic and other project | Neither returns evidence. |
| Q12 instruction-shaped payload | Retrieved as data and rejected by authored untrusted status; no LLM injection defense tested. |
| Q13–Q14 missing source and unsupported verification claim | Engram can return a source-less note; gate rejects it. Both reject unsupported verification. |
| Q15 semantic paraphrase | Both miss the expected source; no semantic recall gain established. |
| Q16–Q18 before deletion, revocation, missing source | Initial evidence available; revoked source rejected; deleted export disappears from native search but remains in Engram until note deletion. |
| Q19–Q21 note deletion and restart | Deleted note is absent by search and by ID, remains absent after restart; correction still available. |
| Q22 changed source | Native reads replacement; Engram returns stale hash and gate abstains. |
| Q23–Q25 rebuild | Deleted/revoked sources remain absent; replacement source becomes usable with its current hash. |

Combined bridge/process startup and 15-note ingestion took 90.245 ms. Final
source exports occupy 5,112 bytes; original alpha/beta stores 503,808 bytes;
fresh alpha rebuild 266,240 bytes. These are final local file sizes, not peak
storage/RSS or production capacity estimates. Full receipts retain binary hashes.

Retrieval timing excludes source snapshot re-reading and gate execution. Native
search opens a workspace per query and batches its search/read operations over
one JSONL request; Engram uses a warm process and separate MCP requests. This
tiny local sample cannot establish a speed advantage. No throughput or scaling
claim follows. Bytes are not token counts. Model, tokens, answer accuracy,
Dreaming quality and Wiki quality are `null`; paid calls and API spend are zero.

## Candidate source review and deployment costs

Official source pins, reviewed file hashes and root licenses are in the
[manifest](../../scripts/memory-eval/sources.json). The observed commits were
recent for Hindsight, LangMem and Graphiti, but commit recency is not a support
or reliability guarantee. Engram intentionally retains the previously evaluated
v1.20.0 baseline instead of silently moving to current main. This is not a full
transitive dependency/license audit or redistribution approval.

| Candidate | Source-observed mechanism and boundaries | Local execution / marginal deployment cost | Decision |
| --- | --- | --- | --- |
| Engram 1.20.0, MIT | SQLite/FTS, explicit save/search/full read; caller source text; directory owns isolation. Current provenance/validity gate is supplied by this experiment, not Engram. | Executed. Existing Go binary/MCP/store; measured costs above. No semantic gain on frozen sample. | Retain current optional integration; reuse contract only for any extension. |
| Hindsight 1.2.1, MIT, `586f0fae…` | Retain orchestrator processes facts/chunks; PostgreSQL bank partitions and watermarks; reflect agent calls configured LLM. A bank/source reference does not independently verify a scientific claim. | Source review only. Python >=3.11, PostgreSQL/pgvector plus SDK, embedding/reranking and LLM configuration depending on mode. No new service installed or model budget consumed; operational/model cost unmeasured. | Stop adoption for now; require same-fixture live extraction/recall/reflect evidence first. |
| LangMem 0.0.30, MIT, `8620b986…` | MemoryStoreManager uses model extraction and namespaced store puts/deletes; LocalReflectionExecutor owns a queue and worker thread. Deletion operations do not prove withdrawal of all derived prose. | Source review only. Python >=3.10 and LangChain/LangGraph/provider/checkpoint dependencies; configured model/store required. Cost/quality unmeasured. | Reuse namespace/update/delete contract ideas; do not import its worker/scheduler into Pero. |
| Graphiti 0.31.2, Apache-2.0, `ebef986a…` | Entity edges carry episode provenance and valid/invalid/expired time; typed time filters compile to backend queries. Episode removal prunes unsupported edges and can rebuild entity summaries with an LLM. Source code restores an old summary on summary-generation error; deletion semantics need a real replay. | Source review only. Python >=3.10, graph backend and extraction/model clients; optional backends do not eliminate operation/model costs. No graph service installed. | Reuse temporal/provenance concepts; defer graph adoption until gain justifies its ownership and operations. |

The official [Anthropic memory components article](https://www.anthropic.com/research/components-of-agent-memory)
and [Managed Agents Dreaming workflow](https://platform.claude.com/cookbook/managed-agents-cma-dreaming-with-a-dynamic-workflow)
were read on 2026-11-11 as design references. They do not supply local execution
evidence. Managed service credentials and model runs would be required to measure
that workflow. No external analyzer/organizer loop or Wiki writer was added.

## Minimal decision record and next acceptance boundary

Status: bounded PoC complete; broader research open. Choose **reuse-contract-only**.
Preserve Host journals and existing Markdown memory as source owners, Insights as
session analysis, and optional external Engram as the replaceable derived store.
Any future implementation should place source identity/hash, temporal validity,
conditions, correction/conflict and revocation rules in one existing owning
domain boundary, with adapters carrying values rather than duplicating rules.
The experimental Python gate is not silently promoted into that architecture.

Reconsider adoption only after a separately authorized, equally budgeted real
model run demonstrates improvement on frozen positive/absence questions and
source-backed corrections/deletions, with extraction errors and complete model
usage reported. Hindsight versus native versus no-memory LLM comparison,
Dreaming/Wiki quality, real-session or public benchmark generalization (including
LongMemEval), and long-term retention/deletion behavior remain unverified. A
public/synthetic benchmark may be used before considering any private sessions.

Validation: three value-level tests with behavioral subcases passed; actual
`fstools` and `nativetools` tests passed with race detection; two new isolated
process runs passed the lifecycle/replay checker. No UI/runtime composition
changed, so browser, Electron and Native acceptance are outside this result.
