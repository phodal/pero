# Optional Better Harness Inspector bridge

`inspector.mjs` renders a `report.py` JSON summary with the existing Better
Harness Inspector. It imports the public report and usage builders from a local
Better Harness checkout. No package installation, host adapter, model API, raw
Session rewrite or Better Harness source modification is required.

Verified with Better Harness revision
`b605532fcf1014bcb48d3e6940a5bc64e80cddd5`. Other revisions must expose the same
public builder and renderer contracts.

```sh
node harness/tools/session_report/inspector.mjs \
  --summary /absolute/path/summary.json \
  --better-harness /absolute/path/better-harness \
  --output /absolute/path/inspector.html
```

The command writes four files and returns their exact paths as one JSON object:

| File | Purpose |
| --- | --- |
| `inspector.html` | Existing self-contained Inspector: Session navigation, tool failure markers, usage progression and read-only evidence playback |
| `inspector.report.json` | Actual `HarnessInspectorReportV1` consumed by the page |
| `inspector.sources.json` | Input summary data with stable Inspector call IDs, original commands and source references |
| `inspector.sources.md` | Session/usage deep links and JSONL seq/line lookup |

Open the HTML directly, or serve its directory over loopback. A Session can be
opened with `?view=session&session=<id>`; adding `&session-mode=usage` opens its
usage view. The source Markdown contains complete links with each declared
Session feature scope.

## Input and accounting

The input has `schema_version: 1` and `sessions[]` as emitted by `report.py`.
Each Session supplies `id`, `label`, `source.path/sha256`, timestamps, `usage`,
`responses[]`, `calls[]` and optional `findings[]`. The bridge reads only this
JSON. It does not discover sessions, read credentials, execute saved commands,
recalculate the analyzer's failure signals or estimate tokens.

- Aggregate `input_tokens` maps to uncached input. `cache_read_tokens` is a
  separate input lane. Per-response `inputTokens`, `cacheReadTokens`,
  `outputTokens` and `totalTokens` retain provider values.
- Cache writes are informational subsets, so they remain in the source index
  and are not mapped to Better Harness's additive cache-creation lane.
- Reasoning tokens are included in output; they are never added again.
- Usage progression has one point per retained completion, including completions
  without usage. Missing usage stays unobserved and partial totals stay partial.
- Processed usage uses provider `totalTokens`. Context occupancy and window
  limits are unobserved; bytes and cumulative token totals cannot establish them.
- Tool `protocol_error`, `execution_failure`, `lifecycle_failure` or explicit `status: failed`
  produces the Inspector failure marker. Other states remain named in call
  details. `validation_signals` are candidates and do not change a call's status.

The Inspector's Model calls and Processed coverage describe retained committed
responses, not all request attempts. If every committed response reports usage
but a failed/interrupted attempt does not, Processed coverage can remain
`observed` while Session Coverage is `partial`. The latter appears inside the
collapsed **Evidence & methodology → Observability → Coverage** section, not as
a warning beside the headline totals. The existing renderer has no specific
request-gap warning field; consult the summary/source index for the missing
attempts and their references. The bridge never adds a phantom completion to
make the usage chart represent those attempts.

The summary omits original user prompt and assistant response bodies. The
bridge therefore leaves tool activity unplaced instead of inventing dialogue
Turns. The Feature Tree is a navigation list whose explicit references bind
report labels to observed Session IDs; its labels are not source prompts or
claims of task completion.

## Evidence boundary

Inspector applies its existing bounded privacy projection. Tool details retain
short seq/line references and command excerpts; full commands, output previews,
usage records and finding refs stay in the companion source index. Original
Session paths and hashes remain unchanged. These are local diagnostic artifacts,
not a public-report publication workflow. Copying only the HTML does not copy
the complete source index.

The bridge preserves protocol/process failures separately from semantic
validation candidates. It does not import an external benchmark judge, infer
root causes, declare a repair successful or close an Episode.
