# Data semantic definitions: offline reference study (#152)

This is the P0 freeze plus a deterministic, lightweight part of P1. It exercises
reviewed definitions over an immutable **Data export** in a disposable SQLite
copy. It is not a shipped Data query feature, an NL2SQL evaluation, a new Catalog,
an Agent, or an NVIDIA Auto Ontology deployment.

## Reproduce

Use Python **3.10+** with its standard-library SQLite. The existing Data backend
also requires that Python version. macOS `/usr/bin/python3` 3.9 cannot import it;
the recorded run used `/opt/homebrew/bin/python3` 3.14.7 and SQLite 3.53.4.
No network, model key, package install, service or Electron is needed.

```sh
python3 -m unittest discover -s experiments/data-semantics -p 'test_*.py' -v
python3 experiments/data-semantics/study.py --output /tmp/pero-semantic-study-152
python3 experiments/data-semantics/recompute.py /tmp/pero-semantic-study-152 \
  --report /tmp/pero-semantic-study-152/verification.json
python3 -m unittest discover -s apps/data/test -p 'test_*.py'
```

Choose a new output directory for each run; existing evidence is never replaced.
The checker uses original CSV and Decimal arithmetic, imports no executor code,
and executes no SQL. The report retains all three attempts and their variance.
The command fails on changed frozen inputs or mismatched results/provenance.

## Frozen material and ownership

`freeze.json` hashes inputs, definitions, DDL, manual plans and scoring policy.
The source/definition freeze is commit `fb348c11`; the 30-question/denominator
freeze is `fce56377`, both before any SQL execution. `sources.json` records the
upstream commit and the hashes/URLs of inspected official files.

- Public data: [UCI Iris](https://archive.ics.uci.edu/dataset/53/iris), 150 rows,
  four measurements in cm, CC-BY-4.0. Attribution: Fisher, R. (1936), *Iris
  [Dataset]*, UCI Machine Learning Repository,
  [doi:10.24432/C56C76](https://doi.org/10.24432/C56C76).
  `fixtures/iris.data` retains the downloaded member's exact original bytes.
  This is the UCI version; its publisher documents differences from the original
  Fisher paper. It must not be presented as a transcription of Table III.
- `fixtures/synthetic.json` contains explicitly invented runs/metrics (CC0-1.0).
  No model training or scientific experiment produced these numbers.
- `schema.sql` defines five tables: `dataset_version`, `sample`, `annotation`,
  `run`, `metric`. PK/FK/unique keys make the stated join cardinalities explicit.
- `definitions.v1.json` gives each of 19 locally reviewed definitions its SQL,
  typed bindings, grain, unit, denominator, joins, missing-value and seed policy.
  Reviewer is Codex; this is neither a human scientific review nor arm C evidence.
- `questions.json` freezes 12 basic/public, 8 synthetic-trap, 5 clarification and
  5 refusal cases. `calibration.json` is separate and unscored.
  `manual-plans.json` supplies pre-authored structured intents; no question text is
  automatically understood or routed. Thus clarification/refusal fixture passes
  are **not** model ambiguity, refusal or prompt-injection accuracy.
- `policy.json` keeps proposed adoption thresholds separate from local results.
  A/B/C model configurations and measured usage are absent because none ran.

`semantics.py` owns selected-definition admission and the local read grant.
`study.py` is the I/O shell: existing `Catalog.import_file` and `Analysis.export`
remain the data owners. The study reads exported string cells with explicit
numeric conversion, then creates the derived database. This does not change
Data's parser or infer column types in the product. A Data `projectRef` is
organizational metadata, not a tenant grant: this experiment's fixed local grant
is a separate test boundary, not a production authorization integration.

## Execution and receipts

The engine opens SQLite with `mode=ro`, enables `query_only`, and installs an
allowlist authorizer for SELECT, granted columns and six aggregate/scalar
functions. Parameter values are bound. Non-SELECT operations, schema reads,
unknown functions and ATTACH are denied; SQLite rejects multiple statements.
A deterministic 100,000-VM-instruction budget bounds work; cancellation is checked
on observed VM progress. These are local engine limits, not a service timeout SLA.

Each receipt stores its definition/version, SQL, parameters, local actor/grant,
Data dataset and immutable asset IDs/hashes, export hash, original source hash,
DDL/synthetic/definition hashes, SQLite version, duration and full result hash.
`run.json` anchors them to the frozen question/plans policy and code revision.
The visible prefix is at most 100 rows; full row count, truncation and the complete
result file remain explicit. B12 proves that the 100-row prefix never becomes the
150-row population denominator.

`v2` is a deliberately synthetic amendment of the first sepal-length value plus
a versioned cm-to-mm definition change. It is not a correction to the UCI data.
The actual Data dataset gains a second asset. Reopening Catalog reproduces the
old export; replay reads the old receipt without executing SQL. Historical
results, original asset bytes and both definition revisions remain available.
This proves local storage/reopen behavior, not a full Desktop process restart.

## Source audit and adoption decision

Pinned official NVIDIA repository commit:
[`fc43a82600e18b19d159c52023f54f5572f537ac`](https://github.com/NVIDIA/auto-ontology/tree/fc43a82600e18b19d159c52023f54f5572f537ac),
Apache-2.0. No upstream runtime/code was vendored into this implementation.

| Inspected official source | Observation and implication |
| --- | --- |
| `mcp/auto_ontology_mcp/chat.py`, `docs/mcp.md` | `ask_question` streams the complete model-backed agent via `/api/chat/completions`. Its result retains SQL, row count and truncation while returning at most 100 rows. It is not a cheap SQL utility. |
| `mcp/auto_ontology_mcp/readiness.py` | Semantic-layer and live database readiness are distinct. Neither establishes scientific correctness. |
| `mcp/auto_ontology_mcp/auto_ontology_auth.py`, `server.py` | The MCP verifies opaque tokens through user info and forwards the verified caller token; it strips competing API-key/bearer headers. Actual deployment isolation remains untested here. |
| `docs/connections.md`, `docs/authentication.md` | Vault needs all four documented configuration values; partial configuration falls back to plaintext credentials with a warning. UI/env connection precedence also differs by entry point. Deployment credential handling needs its own acceptance. |
| `auto_ontology/connectors/sqlite.py` | The connector uses ordinary `sqlite3.connect(path)` and offers statement progress/deadline handling. The connection itself is not a read-only boundary; this observation does not establish whether other upstream layers constrain writes. |
| `.env.example` | Default model endpoints use NVIDIA-hosted `integrate.api.nvidia.com/v1`. No default model, ingestion, prediction, OAuth or Vault path was executed. |

**Decision for this iteration:** reuse the versioned definition/receipt contract
for bounded experiments and defer full-service adoption. There is no evidence yet
that generated or reviewed semantic layers outperform schema-only NL2SQL, or
reduce human effort. D's correct SQL is a correctness reference only.

The next P1 comparison needs separately frozen equal model/budget settings,
A schema-only, B automatic/unreviewed and C reviewed semantics, all attempts and
at least three relevant repeats. It must measure actual usage/latency and review
maintenance time, retain the frozen ambiguity/refusal denominators, and evaluate
scope/injection behavior at the model boundary. P2 Data → query → Paper claim →
independent recomputation and historical UI reopening is still unimplemented.
Production tenant isolation, Vault, outbound access, Native/Electron, packaging,
large datasets and researcher acceptance remain outside this local evidence.

See [verification record](../../docs/fitness/data-semantics.md) and the
[canonical active issue record](../../docs/issues/2026-11-11-data-semantic-light-path.md).
