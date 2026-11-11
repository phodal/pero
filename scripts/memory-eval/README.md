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
source-reviewed candidates, not executed comparison arms. Dreaming/Wiki quality,
real-session QA, retention at scale and benchmark generalization remain unknown.
