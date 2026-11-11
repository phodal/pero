# Bounded memory recall experiment (#161)

This runs real Pero `fstools.Search`/`Read` and a pinned external Engram MCP
process against **synthetic** exports. It is an engineering contract experiment,
not an LLM answering benchmark or an installed Transcript Search product.
No runtime wiring, private sessions, credentials or model calls are needed.

## Reproduce

From the repository root, use Go (including the toolchain required by Engram)
and Python 3.12. The first build downloads normal public Go dependencies.
The following directory names must be unused; keep all generated artifacts in
the ignored `test-results/` directory. Never point this experiment at user data.

```sh
mkdir -p test-results/issue-161/vendor
git clone --depth 1 --branch v1.20.0 https://github.com/Gentleman-Programming/engram.git test-results/issue-161/vendor/engram
git -C test-results/issue-161/vendor/engram rev-parse HEAD
# Required: ba9e46ced152c37a7cb9e576153c41995873e2fc
(cd test-results/issue-161/vendor/engram && GOWORK=off go build -trimpath -ldflags='-X main.version=1.20.0' -o ../../engram ./cmd/engram)
GOWORK=off go -C harness/go build -trimpath -o ../../test-results/issue-161/search-files ../../scripts/memory-eval/search.go
python3.12 -m unittest discover -s scripts/memory-eval -p 'test_*.py' -v
GOWORK=off go -C harness/go test -race -count=1 ./fstools ./nativetools
python3.12 scripts/memory-eval/evaluate.py --engram test-results/issue-161/engram --search-binary test-results/issue-161/search-files --output test-results/issue-161/replay-a
python3.12 scripts/memory-eval/evaluate.py --engram test-results/issue-161/engram --search-binary test-results/issue-161/search-files --output test-results/issue-161/replay-b
python3.12 scripts/memory-eval/check_results.py test-results/issue-161/replay-a/report.json test-results/issue-161/replay-b/report.json
```

The runner rejects a modified or differently versioned Engram executable using
Go build metadata. Each output directory must be new. Logs, complete raw
reference/hash receipts, lifecycle receipts, binary hashes, environment and
metrics are saved in it. The process receives only PATH, the unchanged HOME and
explicit Engram configuration; its database is under the experiment directory.
It does not receive API credentials. The pinned executable resolves HOME before
applying `ENGRAM_DATA_DIR`; this does not authorize reading any existing store.

## What is compared

- `no_memory`: no retrieved references, so every question abstains. It matches
  13 absence cases trivially and answers none of the 12 positive cases.
- `search_files`: the current product tool's implementation owner, invoked by
  `search.go`. Exports are one canonical JSON record per file. The bridge reads
  the matched line through `Read`/`FormatRead`; a search preview is insufficient.
  This is not sidebar Session Search, which currently filters session titles.
- `engram`: fresh producer and reader processes, separate alpha/beta data
  directories, `all_projects=true` to test the directory boundary, then full
  `mem_get_observation` readback. No `topic_key` overwrite and no prompt capture.

`fixtures.json` freezes 15 records, 25 questions, 12 positive expectations,
their literal query plan, conditions and as-of times. Both retrieval arms use
the same query and at most 20 hits, with no query expansion, retries or ranking
model. Pero's underlying search also has its existing scan limits; the runner
rejects truncation. Golden expected fields never enter backend notes or queries.

`Claim`, `Source`, `Question`, `Retrieved`, `Receipt` and `Decision` name the
evaluation concepts. `assess` is a pure gate over **authored annotations**:
re-read bytes/hash, scope, revocation, observation/validity time, conditions,
explicit correction/conflict and supporting synthetic verifier receipts.
It cannot infer facts, validity or verification from natural language. The
shell supplies actual current source bytes. This gate is evaluation code only;
it is not an existing Host protection or a new production memory owner.

Lifecycle phases revoke an authorized source, remove another source, delete its
Engram note, restart the reader, change a third source, and rebuild a fresh
derived store from currently available authorized exports. `mem_delete` is
enabled only for this isolated experiment; Host's admission policy is unchanged.
Old synthetic databases remain as audit evidence. No forensic erasure, backup
deletion or production retention guarantee is claimed.

## Interpreting results

Positive retrieval coverage counts all expected IDs present in raw hits. Gate
agreement compares explicit metadata decisions with the fixture; it is **not
answer accuracy**. Raw readback validity counts reference/hash matches and does
not establish truth, current validity or scientific support. A verifier receipt
must also support the same source and value; these receipts are synthetic.

Response bytes are received JSONL UTF-8 bytes for queries and full readbacks,
not tokens. Tool operations count search plus each readback. Native operations
are transported in one bridge request while MCP uses separate requests.
Retrieval latency excludes export, source-snapshot re-reading and gate execution;
native opens a workspace per query while Engram keeps a process/store open.
Tiny local-corpus medians/p95 are diagnostic, not a production speed ranking.
Startup/ingestion and final on-disk sizes are reported separately. CPU cost,
embedding cost, model tokens and paid-service cost are not estimated from bytes.

The deliberately semantic Q15 misses in both arms. Engram Q22 returns a stale
hash after a source change and the gate abstains until rebuild. The replay check
retains these limitations rather than silently optimizing the frozen questions.
The injection record is treated as data; no model is asked to resist it, so this
does not establish LLM prompt-injection resilience.

See [the evaluation and decision record](../../docs/fitness/memory-recall-evaluation-2026-11-11.md)
and [pinned source manifest](sources.json). Hindsight, LangMem and Graphiti are
source-reviewed candidates in that original run; the extended acceptance below executes their APIs. Dreaming/Wiki quality,
real-session QA, retention at scale and benchmark generalization remain unknown.

## Extended acceptance: three candidate APIs and reviewed projections

The later #161 acceptance run at Pero `5072cbc6` executes Hindsight as a fourth
arm and actual LangMem/Graphiti APIs. See `acceptance-results.json` and ADR 0034.
The earlier source-review-only statement above describes the original run.

Use a separate ignored root and exact revisions in `sources.json`. This setup
checks out official source pins; it does not substitute floating main or a
package release. If a clone already exists, check its HEAD and clean worktree
instead of rerunning setup into that directory.

```sh
python3.12 - <<'PYCODE'
import json
from pathlib import Path
import subprocess
manifest = json.loads(Path("scripts/memory-eval/sources.json").read_text())
root = Path("test-results/issue-161-acceptance")
root.mkdir(parents=True, exist_ok=True)
for candidate in manifest["candidates"][:3]:
    target = root / candidate["repository"].split("/")[-1]
    target.mkdir()
    subprocess.run(["git", "init", str(target)], check=True)
    subprocess.run(["git", "-C", str(target), "remote", "add", "origin", "https://github.com/" + candidate["repository"] + ".git"], check=True)
    subprocess.run(["git", "-C", str(target), "fetch", "--depth", "1", "origin", candidate["revision"]], check=True)
    subprocess.run(["git", "-C", str(target), "checkout", "--detach", "FETCH_HEAD"], check=True)
    assert subprocess.check_output(["git", "-C", str(target), "rev-parse", "HEAD"], text=True).strip() == candidate["revision"]
PYCODE
```

```sh
uv venv --python python3.12 test-results/issue-161-acceptance/hindsight-venv
uv pip install --python test-results/issue-161-acceptance/hindsight-venv/bin/python -c scripts/memory-eval/constraints-hindsight.txt -e test-results/issue-161-acceptance/hindsight/hindsight-api-slim pg0-embedded==0.15.2
uv venv --python python3.12 test-results/issue-161-acceptance/langmem-venv
uv pip install --python test-results/issue-161-acceptance/langmem-venv/bin/python -c scripts/memory-eval/constraints-langmem.txt -e test-results/issue-161-acceptance/langmem
uv venv --python python3.12 test-results/issue-161-acceptance/graphiti-venv
uv pip install --python test-results/issue-161-acceptance/graphiti-venv/bin/python -c scripts/memory-eval/constraints-graphiti.txt -e test-results/issue-161-acceptance/graphiti httpx==0.28.1
env -i HOME="$HOME" PATH="$PATH" test-results/issue-161-acceptance/langmem-venv/bin/python scripts/memory-eval/probe_components.py langmem --output test-results/issue-161-acceptance/langmem-api.json
env -i HOME="$HOME" PATH="$PATH" test-results/issue-161-acceptance/graphiti-venv/bin/python scripts/memory-eval/probe_components.py graphiti --output test-results/issue-161-acceptance/graphiti-api.json
python3.12 scripts/memory-eval/evaluate.py --engram test-results/issue-161/engram --search-binary test-results/issue-161/search-files --hindsight-python test-results/issue-161-acceptance/hindsight-venv/bin/python --output test-results/issue-161-acceptance/compare-a
python3.12 scripts/memory-eval/evaluate.py --engram test-results/issue-161/engram --search-binary test-results/issue-161/search-files --hindsight-python test-results/issue-161-acceptance/hindsight-venv/bin/python --output test-results/issue-161-acceptance/compare-b
python3.12 scripts/memory-eval/check_results.py test-results/issue-161-acceptance/compare-a/report.json test-results/issue-161-acceptance/compare-b/report.json
python3.12 scripts/memory-eval/check_review.py --search-binary test-results/issue-161/search-files --output test-results/issue-161-acceptance/review-replay
```

Constraints record the observed Python 3.12/macOS arm64 environment, not universal
cross-platform compatibility. Graphiti's initial import lacked `httpx`; explicitly
installing 0.28.1 repaired that environment. No upstream source was patched.
All three environments install editable pinned source; dependency metadata and
unknown licenses are saved by the probes or recorded acceptance inventory.

Hindsight starts an owned Pg0 PostgreSQL/pgvector instance in the output directory
on an automatically chosen loopback port. It uses real retain/recall/document
read/delete APIs, chunks extraction, RRF and an explicitly synthetic 64-dimensional
hash embedding. There is no downloaded ML model or LLM credential. The same
queries and 20-document cap apply; its internal recall budget is 4096. Closing the process
and starting a new one exercises persistent database recovery; Engram also
exercises producer/reader process restarts. Rebuild writes a fresh bank from
current authorized exports. Old stores are retained as synthetic audit evidence.

Hindsight JSONL byte counts contain only projected refs/hashes after internal
full document reads; Engram's wire includes the full MCP content. Do not compare
these transport byte counts as context or token savings. Query/read operations
and returned candidates are reported separately. `caller_selected_beta_bank`
proves an unconfigured caller can choose beta: bank filtering is not an ACL.
Reflect is actually attempted and reports `LLMNotAvailableError`, with no score.
LangMem proves CRUD/namespace behavior in InMemoryStore, not persistence or model
reflection. Graphiti proves temporal-filter/episode APIs; its reserved non-listening
loopback driver probe demonstrates the service dependency, not a failed deployed
Graphiti server. No graph service or extraction model was configured.

`ReviewState`, `Draft` and `Page` are the evaluation's reviewed-projection concepts.
`review.py` uses the same `assess` rule for analysis, publication, rollback and
bounded context. The analyzer reads authored synthetic exports, not natural-language
LLM facts. It accepts explicit closed/permitted inputs, a byte budget and watermark;
a narrow secret-field filter is not general DLP. No automatic trigger is installed.
`review_run.py` is default-off; its explicit `--approve` applies only to synthetic
artifacts. `check_review.py` verifies an interrupted write before checkpoint,
fresh-process retry and exactly one active version. The two T8 Markdown examples
and `_index.md` are comparison artifacts, separate from the Q01 checkpoint.
Revocation hides current context; archived Markdown is retained for audit.

Every read still checks current sources, validity and conditions. A small context
budget returns no context rather than partial unsupported facts. Unit cases cover
permission, unfinished session, no evidence, injection-as-data, source change,
revocation, rollback, cancellation, watermark and review conflicts. The process
check compares real search_files results with single-source and conflicting
cross-document Markdown. These are deterministic contract and file-I/O checks;
LLM Dreaming quality, Wiki answer accuracy and model tokens remain `null`.
