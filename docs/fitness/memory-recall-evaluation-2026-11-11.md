---
kind: verification_report
date: 2026-11-11
github_issue: 161
github_state: open
github_url: https://github.com/phodal/pero/issues/161
---

# Memory recall: reproducible bounded evaluation

Decision: **reuse contracts only**, formalized by [ADR 0034](../adr/0034-auditable-memory-projections.md).
Keep optional external Engram; do not add a memory service or background worker.
The original bounded run below is retained as historical evidence. The final
acceptance section extends it with actual Hindsight/LangMem/Graphiti APIs and a
reviewed Markdown PoC. No LLM quality or scientific acceptance is claimed.

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

## Original source review and deployment costs

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

## Final original-scope acceptance

Acceptance base: `5072cbc606064cd6141848a23587c7bdcbdf997e`. Original fixture and
queries are unchanged. [Compact acceptance results](../../scripts/memory-eval/acceptance-results.json)
include execution environment, binary/evaluation hashes, both replay identities,
lifecycle receipts, candidate probes, dependency metadata gaps and review recovery.
The checked-in dependency constraints and commands make the local probes repeatable.
Raw local artifacts are under `test-results/issue-161-acceptance/`; `compare-08`
and `compare-09` each contain 100 outcomes, source exports, JSONL journal, logs
and owned synthetic stores. They agree on all deterministic outcomes.

### Same-input comparison

Hindsight uses the pinned API source, actual Pg0 PostgreSQL/pgvector,
`retain_async`, `recall_async`, `get_document` and `delete_document`. Retain uses
chunks, recall uses RRF and a disclosed synthetic hash-bag embedding. This avoids
inventing a semantic-model quality result. All arms use the same frozen query,
no expansion, at most 20 returned documents and zero model calls; Hindsight also
has a 4096 internal recall budget. No-memory remains a negative control.

| Observed in compare-09 | Native search + admission | Engram + admission | Hindsight chunks + admission |
| --- | ---: | ---: | ---: |
| Positive retrieval coverage | 11/12 | 11/12 | 11/12 |
| Authored admission agreement | 24/25 | 23/25 | 23/25 |
| Returned candidates | 32 | 34 | 139 |
| Reference/hash matches | 32 | 31 | 129 |
| Wrong-project hits in scoped queries | 0 | 0 | 0 |
| Query + document-read operations | 57 | 59 | 164 |
| Median / p95 retrieval ms | 1.298 / 1.846 | 0.772 / 1.465 | 11.811 / 53.012 |

All three miss Q15 semantic paraphrase. Both derived stores return a stale hash
on Q22; the shared gate abstains, then accepts the replacement after rebuild.
Hindsight's 139 candidates show additional irrelevant data on this tiny corpus,
not better recall. Its source readbacks are real document API reads; JSONL
transport exposes only projected refs/hashes. Its 19,639 transport bytes therefore
cannot be compared with Engram's full-content 73,510 bytes as context savings.
Native transport is 38,590 bytes. No bytes-to-tokens conversion is made.

Combined startup and ingestion took 3,266.6 ms. Final Hindsight database/artifacts
occupy 43,927,365 bytes, versus 503,808 bytes for original Engram stores and
266,240 bytes for its rebuild. Native exports occupy 5,112 bytes. Hindsight's
installed environment occupied roughly 929 MiB after removing Python bytecode;
LangMem 68 MiB and Graphiti 60 MiB. These are local observed sizes, not peak
resource bounds or production capacity. Latencies are diagnostic, not a speed
ranking across transport and caching implementations. CPU/RSS/model cost was not
measured. Model tokens and answer/Dreaming/Wiki quality are null; paid calls and
API spend are zero.

Hindsight deletion is confirmed absent by document ID and recall. A fresh Hindsight process reopens the same actual database after shutdown;
the separate Engram process is also restarted. A new Hindsight bank is rebuilt only from current allowed exports.
An additional real query with bank `beta` returns its synthetic secret: caller-
selected banks are filters, not authentication. The gate enforces project
scope in the experiment; no production multi-tenant guarantee is inferred.

The early delete timeout came from the experiment's JSONL bridge confusing a
request's document `id` with a JSON-RPC correlation ID. A one-document probe
showed upstream deletion succeeded. The bridge now matches IDs only for JSON-RPC
messages, and journals each completed outcome. Both full replays passed after
that correction. This is not reported as a Hindsight deletion defect.

### Candidate deployment and API evidence

All three sources were checked out at the exact manifest revisions with clean
worktrees and installed into independent Python 3.12 environments. Root license
files, dependency declarations and actual owning API implementations were read.

| Candidate | Actual execution | Dependency/permission limit | Recommendation |
| --- | --- | --- | --- |
| Hindsight 1.2.1, MIT | 25-query chunks arm, real PostgreSQL, delete/process-restart/rebuild; bank-selection probe | Docker daemon unavailable and system PostgreSQL lacked vector; official Pg0 embedded dependency worked. Actual reflect raises `LLMNotAvailableError` with provider none. 184 installed distributions, 10 missing license metadata. No ML weights downloaded. | Keep external experiment; no benefit here justifies service adoption. |
| LangMem 0.0.30, MIT | Real create/update/search/delete and alpha/beta namespace behavior in LangGraph InMemoryStore | Updating the same key loses the old version. No persistent store, embedding index or reflection model configured. 51 installed distributions; no unknown license metadata in this inventory. Namespace is caller-selected, not ACL. | Reuse update/namespace concepts; do not import its worker or persistence ownership. |
| Graphiti 0.31.2, Apache-2.0 | Real EntityEdge episode/time fields and temporal filter query compilation; actual Neo4j driver dependency probe | No configured graph backend. Probe reserves a non-listening loopback port and observes ServiceUnavailable; it does not test a deployed graph server. Initial import required explicit httpx 0.28.1 with resolved OpenAI 3; corrected locally without upstream changes. 29 distributions. No extraction model. | Reuse temporal/provenance vocabulary; graph adoption deferred. |

Installed metadata inventories are evidence, not transitive license approval.
Hindsight's missing metadata names are recorded in the compact result. Core
licenses and exact source links are in [sources.json](../../scripts/memory-eval/sources.json).
No missing license is silently labeled MIT and no candidate's failure is assigned
a made-up accuracy or latency score.

The Knowledge Wiki design reference is now pinned to
[Anthropic quickstarts 4a4224bd](https://github.com/anthropics/claude-quickstarts/tree/4a4224bdf0e9cfb3332167b69c90457403813625/managed-agents/knowledge-wiki)
(MIT root license). README, requirements, organizer prompt and `utilities.py`
were inspected: Managed Agents memory stores/sessions/workflows and provenance
traces require an authorized beta organization/API credential. The organizer is
instructed to preserve facts/provenance and treat memory as untrusted data.
That prompt is not execution evidence. Upstream cost/break-even examples are not
Pero measurements. No managed API run or credential use was authorized.

### Reviewed Markdown / Dreaming contract PoC

`ReviewState`, `Draft` and `Page` carry the evaluation-only lifecycle. The
functional core uses the existing admission rule; the shell exports/reads
synthetic JSON source files, writes immutable Markdown and atomically publishes
a checkpoint. The analyzer interprets authored annotations, not free-form text.
The closed-session and permission flags are explicit inputs, not a new Host
scheduler. A narrow secret-field filter, input byte budget, cancellation,
watermark and revision checks are exercised. There is no silent collection.

The default command emits a draft with no active page. An explicit synthetic
approval publishes one version. Injected failure after artifact write but before
checkpoint returns exit 3; a new process resumes to revision 1/watermark 3; a
second retry still has one active page and one immutable version. Unit cases
verify revoked/changed sources cannot publish, rollback cannot restore revoked
evidence, absent evidence yields no context, and a 32-byte budget fails closed.
Revocation removes active context, not audit history or archived files.

Real `search_files`/Read results feed the T8 comparisons:

| Frozen question | Search raw source text | Reviewed Markdown | Outcome |
| --- | ---: | ---: | --- |
| Q09 single-source failure | 571 bytes | 651 bytes | Same source-linked candidate; larger representation. |
| Q06 cross-document conflict | 1,254 bytes | 839 bytes | Same two conflicting records; unrelated blue condition excluded. |

The cross-document reduction is 33.1% of retrieved source bytes; the single-source
increase is 14.0%. This is deterministic conditional filtering/formatting, not
measured LLM compression or better answers. The process writes readable topic
pages and `_index.md`; they are comparison examples separate from the one-page
checkpoint used for failure recovery. Total Markdown artifact size is 2,532
bytes; final local pass wall time is 10.321 ms. The tiny two-question comparison
supports neither general Wiki utility nor model cost savings.

### Original success criteria and task mapping

| Original gate | Evidence and scope |
| --- | --- |
| At least three serious candidates, pinned source/license/deployment/API matrix | Three clean pinned installs, source/API reviews and actual probes above; Engram and pinned Anthropic Wiki also recorded. |
| Reproducible Hindsight / native thin layer / Search-only comparison | Native `search_files` retrieval is the Search-only arm; adding shared admission is the native thin layer, with both raw and admitted outcomes recorded. Same input/query/hit cap, no model in any arm, 100 outcomes per run. Hindsight's missing real model is explicitly unscored. |
| P0 T1/T7 and inspectable T2/T3/T5/T6, usage and latency separate | T1 Q01/Q21 cross-reader recall; T2 Q02/Q03/Q05 validity; T3 Q04/Q06 conditions/conflict; T4 Q09 failure; T5 Q07/Q08/Q14 matching verifier support; T6 Q10/Q13 abstention; T7 Q11/Q12 scope/instruction-as-data, plus withdrawal/rebuild Q17–Q25. T8 Q09/Q06 reviewed pages. No LLM injection or scientific-validation claim. |
| Data-backed minimal ADR with P0/P1/P2 boundary | ADR 0034 chooses reuse-contract-only, preserves owners, defers model/service adoption and uses existing Automation for any future trigger. |
| No permission/evidence, failure, rebuild and user revoke behavior | Value-level permission/closed-session/budget/review/revoke/rollback tests, real source lifecycle, process failure before checkpoint and fresh-process recovery. Default-off research shell; no Host/UI installation. |

Validation: five value-level tests with behavioral subcases pass; the two isolated
100-outcome runs agree exactly; the four-process review/recovery check passes.
The earlier actual fstools/nativetools race tests remain relevant because their
implementation did not change. No UI/runtime code changed in this acceptance.

All original **research deliverables** are ready for acceptance with explicit
limits. Paid LLM quality, all-candidate deployments, real-session collection,
public benchmark generalization, Host integration and scientific acceptance
remain future adoption work. They are not added as mandatory closure gates.
