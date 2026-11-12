# Data semantic light-path verification

Current follow-up: [2026-11-12 real comparison and deployment](data-semantics-real.md)
records real A/B/C usage, OAuth/MCP execution and the actual failed Vault gate.
Earlier pending/not-run statements below describe their dated 2026-11-11 evidence.

Issue [#152](https://github.com/phodal/pero/issues/152) remains open. This delivers
P0 and the offline D reference portion of lightweight P1; A/B/C and P2 are pending.
Commands, ownership, data licenses and the pinned NVIDIA source audit are in the
[study README](../../experiments/data-semantics/README.md).

## Observed 2026-11-11

Executed from clean commit `64682970ec71619fb4cdbd5cb379dfa8349c13b1`, Python 3.14.7,
SQLite 3.53.4. Final evidence is local (ignored, not committed):
`test-results/data-semantics/2026-11-11-final/` in the delivery worktree.
`run.json` records that code commit and clean-tree status;
`verification.json` contains the independent recomputation and every attempt.

| Check | Observed result |
| --- | --- |
| Frozen input hashes | All matched; frozen before first query execution |
| D public questions | 12/12 on each of three attempts |
| D synthetic traps | 8/8 on each attempt: units, weighted denominator, failed seeds, 1:N join inflation, common seeds, F1 variant, compatible run scope, NULL preservation |
| Pre-authored clarification/refusal intents | 5/5 and 5/5 per attempt; no model routing evaluated |
| Answer accuracy variance | 0 across the three deterministic attempts |
| Query duration totals | 0.012967334, 0.002047917, 0.002025127 seconds; variance 0.0000265518 seconds²; local SQL only, not model/API latency |
| Provenance verification | 90/90 receipts checked against original inputs, Data export, exact definitions, complete results and hashes |
| Presentation cap | 150-row answer stored completely; 100 rows presented with explicit truncation |
| Execution/integrity checks | 15/15 passed; see exact outcomes in `safety.json` |
| History | New Data asset and v2/mm definition returned 50.08; old v1/cm result 5.006 and old export remained reproducible |
| Concept tests | 3 tests, covering 14 admission cases, 6 table/column scope cases and unreviewed-definition rejection |
| Existing Data backend tests | 67 passed |
| Checker negative control | Rejected a deliberately wrong weighted mean even after its result hash and visible rows were updated consistently |

The 15 execution/integrity checks comprise DDL, DML, ATTACH, multiple statements,
extension loading, filesystem function, cross-database lookup, schema read,
PRAGMA mutation, VM budget, table scope, column scope, running cancellation,
bound injection text, and unchanged database bytes. Filesystem functions and the
external database were absent in this SQLite environment; their errors are not
claims about a deployed database with extensions or pre-attached databases.
Cancellation waits for an actual VM progress signal, not a timing sleep.

Development attempts are separate from the final evidence. The first invocation
used system Python 3.9 and failed to import the existing Data backend. The first
supported-Python query exposed SQLite's `COUNT(*)` callback with a missing database
name; the grant now permits only that column-less callback on an explicitly
granted table, with a denied-table case in its concept table. No frozen question,
expected answer, definition, denominator or policy changed after execution began.

The full `git diff 561e2850..HEAD --check` reports one deliberate exception:
`fixtures/iris.data:151` has a blank line at EOF. The UCI member ends in two LF
bytes; its frozen SHA-256 is
`6f608b71a7317216319b4d27b4d9bc84e6abd734eda7872b71a458569e2656c0`.
Those original bytes are retained, not reformatted. The diff excluding that
upstream data member has no whitespace errors.

## Evidence boundaries

A/B/C model arms, model cost/tokens, semantic benefit and human maintenance time
are unevaluated. The deterministic D repeats have no stochastic-model implication.
No NVIDIA service, `ask_question`, ingestion or training ran; no external upload,
real model, Paper claim, UI, Electron, Native or production authorization behavior
was validated. Data `projectRef` does not confer tenant permissions. The grant and
derived read-only copy here are research-local only.

Adoption decision: retain the lightweight definition/receipt experiment; defer
service adoption and semantic-benefit claims pending the frozen model comparison
and later product/authorization acceptance.

## Product light path acceptance — 2026-11-11

The previous section describes the first offline-only iteration. The following
additional evidence covers the later product implementation; it does not expand
the original D results into model or upstream-service acceptance.

Code under test: `c0286308` on `codex/data-semantic-product-152`, clean when the
formal Host/browser run started. Host was built offline from base `5072cbc6` with
only the `research_assets.rs` query handoff change, then copied before testing.
Its SHA-256 is
`3a97691cdb5a3f4b73ea84e6cbf504e906166ae91a998da0d4b5dc572252f861`.
The exact changed Rust source hash and build command are in
`test-results/data-semantic-product/bin/identity.json`.

Formal product evidence:
`test-results/data-semantic-product/run-7WBMTO/verification.json`.
The test installs the real Data and Paper Apps into an isolated real Host, reuses
an existing Python 3.12 environment, and serves their built UI through a loopback
test proxy. No model, replacement backend or Agent performs these actions.

Five scenario groups passed:

1. Browser import of a labelled synthetic CSV → fixed projection → explicit
   definition review → authenticated read-only query → Decimal recomputation
   from the original export. Mean 3 cm matched; scientific review remained open.
2. Paper selects the saved query through the existing Host grant, binds an exact
   observed report quotation and the frozen PDF `SourceVersion`, and navigates
   to the actual PDF page with a visible highlighted quotation. The saved source
   file digest matches the real imported PDF bytes.
3. Forged actor/token, private-route direct access, non-Paper caller,
   browser-supplied replacement receipt and disabled Data access were refused.
   These are single-profile local Host boundaries, not production tenant RBAC.
4. A second dataset version and a reviewed mm definition leave the earlier
   cm result, snapshot and definition unchanged.
5. A real Host restart reopens identical saved Data evidence and Paper links;
   the historical UI reads the prior result without executing SQL.

Screenshots inspected at 1280×950 and 760×900:

- `run-7WBMTO/data-query-light.png`: result and units/denominator are primary after
  execution; preparation is reached through New query.
- `run-7WBMTO/paper-query-light.png`: claim, exact quotation, review status and saved
  Data table are visible; identity details use the shared Disclosure.
- `run-7WBMTO/paper-exact-citation.png`: original PDF page and quote highlight.
- `run-7WBMTO/data-history-narrow-dark.png`: actual `pero-dark` context, readable
  wrapping and controls, explicit notice that the result belongs to the older
  fixed version. The existing Data split stacks at the narrow width.

No Electron/Native/package acceptance is claimed. The parent integration chat
also independently rebuilt Data/Paper and passed the same five scenario groups
on its integrated branch at `run-fNSOcv`; that run preceded the final duplicate
SQL-column rejection, whose focused negatives were then rerun there.

### Local verification

- Data: 70 tests passed, including immutable query results, two-table projections,
  failed numeric conversion, full 101-row retention with 100-row presentation,
  unique result names, missing database/export files, independent arithmetic,
  false results, interrupted-intent recovery and definition/history behavior.
- Paper: new frozen Data evidence test passed, plus all five existing manual
  research-record tests. The new case changes the PDF under the same Paper
  metadata and confirms the old link still binds the original frozen PDF.
- Data and Paper TypeScript checks and production App builds passed.
- Original D rerun at `test-results/data-semantic-product/d-final`: 20/20 answers
  per repetition, 90 complete receipts, all 15 engine/integrity probes passed,
  independently recomputed. Cancellation uses observed VM progress and an Event;
  this is an executor check, not a timed UI cancellation claim.
- Comparison driver at `test-results/data-semantic-product/evaluation-final`:
  270 scripted expected-response replays exercise A/B/C orchestration. Its mode
  is `fixture_driver_only`, real comparison is `not_run`, and costs remain null.
  Four evaluation/domain test methods passed. These are **not** A/B/C model scores.
- Fixed upstream review hashes and Docker availability observation:
  `test-results/data-semantic-product/upstream-source-review.json`. No images
  were built/pulled and no upstream service was started.

### #152 DoD mapping at 2026-11-11

| Item | Evidence / remaining boundary |
| --- | --- |
| 1. Fixed versions and supported scope | Public/synthetic dataset, definitions and upstream commit are frozen. Product implementation and binary hashes recorded. Upstream image digests/deployed environment and real model revision are unverified. |
| 2. A/B/C/D denominators, failures and cost | D fully checked. Runnable A/B/C driver retains 30 × 3 attempts per arm and generation overhead, including failures; fixture replay works. Actual A/B/C, measured model cost and human maintenance remain not run. |
| 3. Permission, Vault, outbound, injection and isolation | Local Host negatives and shared read-only engine probes pass. Light path has no remote model/DB/Vault/prediction client. Upstream OAuth revoke/expiry/downgrade, Vault fail-closed and full-stack private ingress remain unverified; source review shows why direct adoption is rejected. |
| 4. Product vertical slice | Real Data → query → Paper exact claim/source → independent recomputation → Host restart/history, observed in Chromium. No Electron/Native claim. |
| 5. Version changes and incomplete outcomes | Fixed data/definition changes preserve history; missing inputs fail, partial results explicitly show truncation, failed query count is unknown, unfinished intents reopen as interrupted without retry. Executor cancellation is signal-tested; process-kill/UI cancellation is not claimed. |
| 6. Decision | [ADR 0035](../adr/0035-data-semantic-contract.md): **reuse-contract-only**. Keep #152 open for real model comparison and upstream deployment hard gates. |

Final UI follow-up: `7e5a54db` derives recomputation availability from the saved
check definition; `244e9234` adds its real UI scenario. Clean-source
`run-SF1e7p/verification.json` passed all previous groups plus this sixth case:
a completed query with no independent checker shows a disabled recompute action
and a visible reason, never a verification verdict. `unsupported-check-dark.png`
was inspected. No Paper source or Host binary changed in this follow-up.
