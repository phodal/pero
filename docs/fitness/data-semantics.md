# Data semantic light-path verification

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
