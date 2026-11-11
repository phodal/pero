# 0035: Reuse the semantic definition and query receipt contract

Date: 2026-11-11

Status: implementation decision for #152; full-service adoption rejected for this iteration

## Decision

**reuse-contract-only**. Keep reviewed definitions and immutable query receipts in
Data, and reference them from Paper through the existing Host `research-assets`
capability. Do not deploy or embed NVIDIA AutoOntology, introduce a second
Catalog/Agent/Run, or infer scientific acceptance from successful SQL.

Data owns explicit projections of its existing immutable exports, reviewed SQL,
bound parameters, the read-only SQLite executor and saved results. Definitions,
snapshots and results have separate content hashes. Historical reading never
queries again. Paper reuses `ResearchClaim` and `retrieval.SourceVersion`: the
claim's frozen intent identifies the original PDF, rather than whichever PDF is
currently newest for that paper. Paper stores Data object references, not a
second query state machine. Host resolves both private backends and their tokens;
the browser supplies only a query ID and claim selection.

The first UI exposes one fixed table named `sample`; the Data entry point supports
up to five explicit projections. Numbers require explicit conversion to SQLite REAL (double precision), empty/null
values become SQL NULL, and conversion failures stop preparation. Independent
whole-table count/sum/mean use the original export and Decimal arithmetic, not
SQL execution. Unsupported checks remain unavailable. Each result remains
`needs_review`; a local reviewer name is a declaration, not an authenticated
researcher identity or scientific approval.

## Evidence and rejected alternatives

The pinned upstream is `NVIDIA/AutoOntology` commit
`fc43a82600e18b19d159c52023f54f5572f537ac` (Apache-2.0). Its `uv.lock` is recorded,
but no image digest or deployed upstream environment has been verified. The
existing compose uses `auto-ontology:latest`, `auto-ontology-frontend:latest`,
`dpage/pgadmin4:latest` and `pgvector/pgvector:pg17`; these are not immutable image
identities. Docker was unavailable during this iteration. No real database
credentials, OAuth account or Vault instance were provisioned.

Source review at that exact commit establishes why direct adoption is premature:

| Owning source | Observation, not a deployment acceptance result |
| --- | --- |
| `auto_ontology/server/identity.py` | `resolve_internal_user` trusts the forwarded `x-auto-ontology-user-id`; it explicitly requires a private trusted gateway. |
| `docker-compose.yml` | Backend 3001 and ingestion 3002 have host port mappings. Private reachability and forged-header bypass rejection require separate deployment verification. |
| `auto_ontology/connectors/vault.py` and `server/connections/service.py` | All four Vault variables are required. Partial configuration returns false and connection JSON is persisted without Vault. No real credentials may be admitted into this unverified path. |
| `auto_ontology/retrieval/text_to_sql/text_to_sql_graph.py` | The actual `_prediction_enabled()` checks **KUMO_RFM_API_URL**, not API_KEY. URL alone enables graph construction; the key can be optional. `.env.example` and `main.py` comments still describe a key-based gate. |
| `auto_ontology/connectors/sqlite.py` | Ordinary SQLite connection creation is not the product's read-only boundary. Pero's shared executor opens `mode=ro`, enables `query_only`, disables extensions and restricts actions/functions/columns. |

The light path imports none of the upstream services and has no prediction,
Vault, remote database or outbound model client. The evaluation driver accepts
only a credential-free loopback model endpoint and the frozen public/synthetic
study inputs. This is deliberately a local experiment boundary; it does not
establish production tenant RBAC, MCP OAuth expiry/revocation/downgrade handling,
full-service isolation or an outbound gateway policy.

The offline D reference still independently reproduces 20/20 answers in each of
three repetitions, with 90 provenance-complete receipts and 15/15 execution
checks. A/B/C's 270 scripted fixture responses only exercise the new driver.
No actual model comparison, model cost, human maintenance reduction or semantic
benefit has been measured. These are reasons to retain the bounded contract,
not evidence to adopt the service.

## Verification and next decision

The real Host and Chromium flow covers Data import, definition review, query,
independent recalculation, Paper claim binding, PDF page/quote navigation, new
versions, authorization negatives and reopening after Host restart. Native,
Electron, packaged installation and researcher acceptance are not established.
See [the evidence record](../fitness/data-semantics.md).

Reconsider `adopt` only after the frozen A/B/C comparison and deployment hard gates
have real evidence. Choose `stop` if the predefined benefit threshold is missed,
maintenance costs outweigh benefit, or required isolation cannot be made real.
Keep #152's unverified comparison and upstream acceptance visible rather than
reclassifying fixture scores or local Host authorization as those results.
