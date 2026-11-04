# Offline Session report

Summarize native Pero Session JSONL without a model request or additional Python
dependencies. Run it after the agent processes close:

```sh
python3 harness/tools/session_report/report.py /absolute/session-directory \
  --output /absolute/trace-summary
```

Inputs may be multiple explicit files or directories. Directory discovery is
recursive and selects the native `{"header":...}` format; unrelated journals
are skipped. Exact duplicate Session copies are counted once. Conflicting
snapshots with the same ID are rejected: select one snapshot explicitly.
Malformed physical JSONL records fail with their file and line rather than
silently dropping evidence. The tool reads source files and never replays tools.

`summary.json` retains each response's reported usage, context catalog snapshots,
tool-call/result pairing, final process state, command and output previews,
source hashes and seq/line references. `summary.md` lists token consumption,
failed/interrupted calls, zero-exit validation candidates and tool traffic.
These are private local diagnostics; commands and paths retain source data.

The existing trial runner automatically writes `<records>/trace-summary` after
cleanup and adds `trace_summary` to its JSON receipt. The benchmark runner can
use the same CLI for per-task and aggregate reports. A diagnostic report error
is recorded separately and does not overwrite the original acceptance result.

## Token accounting

- Count only committed `assistant/message.data.usage`. Streaming chunks,
  tool lanes, JSON receipts and failed attempts are not added again.
- Pero normalizes cached reads separately: prompt tokens are `input_tokens +
  cache_read_tokens`. Cache writes are descriptive subsets; reasoning is included
  in output. Neither is an additional lane.
- `total_tokens` sums the provider's recorded totals, or stays null if a response
  lacks a total/usage. `known_total_tokens` preserves the reported subtotal.
  `derived_total_tokens` is the sum of observed prompt/output components, not an
  estimate for missing responses.
- `committed_response_usage_complete` describes the committed response records.
  `usage_complete` also becomes false when failed/interrupted `assistant/attempt`
  records expose a usage gap. Even a complete trace is not an invoice.
- Exact per-tool, system/schema/history token attribution is not present in the
  native trace. Recorded compact UTF-8 bytes are **not** provider tokens or exact
  HTTP wire bytes. Costs remain null; no pricing is assumed.

## Failure evidence

Explicit tool errors, nonzero process exits and owner-reported lifecycle failures
overlap and are counted as one failed invocation. Owner status, diagnostic and
cleanup uncertainty remain separate from protocol errors and the original exit
code; an exit of zero does not erase an owner failure. A running Bash receipt is resolved using
`shell-task/started.call_id → task_id → shell-task/ended`. Interrupted, running
and missing results remain separate. TaskOutput/TaskStop observe another task;
they do not create a second aborted Bash invocation.

Interactive terminals use `terminal/intent.call_id → terminal_id →
terminal/ended.state.result`. Final process status and observed PTY output are
associated with the original TerminalOpen; TerminalRead remains an observation
of that process. A completed TerminalOpen receipt's process result remains usable
when no terminal/ended event was retained. Missing final results stay unobserved, and truncated output
remains marked. Reused call IDs in later completed steps are paired by their
pending occurrence; overlapping unresolved IDs are rejected as ambiguous.

Subagent Sessions retain native parent/origin/depth metadata. Their committed
usage is counted once when included in the explicit input scope, without adding
the parent's Agent tool receipt again. Empty ToolSearch results are warnings,
not protocol failures.

Zero-exit output containing unittest failures, an uncaught Python traceback,
pytest failures, GNU Make error summaries or a printed nonzero exit creates
**review candidates**. Recursive `make[n]` and `gmake` summaries are included.
`exit=N` markers are recognized without case sensitivity (`EXIT=1` also matches).
Quoted source and expected exceptions can produce false positives. No regex establishes
an independent test verdict or root cause; original tool status is preserved.
Final benchmark acceptance still belongs to the external judge.

Turn records retain `turn/start.source` (`human`, `plugin`, or null when its
start is absent). `turn_errors_by_source` groups the original native errors;
it does not infer whether a plugin error was caused by shutdown. A human
prompt can finish normally before a queued background notice starts another
turn. Keep these native turns separate from the ACP prompt's stop reason and
the independent benchmark verdict.

Empty unittest, doctest and pytest suites also produce review candidates.
An exit of zero after running zero tests supplies no validation coverage; it
does not itself establish an implementation defect. These candidates retain
the `empty_test_suite` kind and never change the tool's successful status.

Optionally provide reviewed annotations:

```json
[
  {
    "source_sha256": "sha256 of the complete native JSONL",
    "result_seq": 100,
    "stdout_sha256": "sha256 of the exact observed stdout UTF-8 bytes",
    "verdict": "failed",
    "reason": "Independent review of the command, output and recovery"
  }
]
```

Use `--reviews /absolute/reviews.json`. Matching source/seq with a stale stdout
hash is rejected; changed source hashes do not apply the annotation. A
`not-failure` verdict can preserve a reviewed false positive. Confirmed manual
failures are counted separately from automatic candidates and protocol failures.

Repeated calls and unused declarations are optimization evidence, not proof of
waste. File edits and changing process state can justify repeated arguments.
Use the existing ACP `--defer-tool-loading` flag in a separately labeled run to
measure smaller tool declarations and changed guidance, discovery calls, token
usage and acceptance together. Preserve critical check exit codes when filtering
output or doing cleanup.

## Tool efficiency measurements

Repeated arguments now include `repeated_result`: `changed`, `unchanged`, or
`unknown` when a return is missing, spilled or truncated. This compares the
returned observation, including errors; a later process terminal fact does not
rewrite the original observation. It does not classify repeated calls as waste.

Each committed response inherits its actual declaration header. Schema exposure
sums compact declared JSON bytes per response, with a separate contribution from
tools never invoked in that Session. These bytes are not provider tokens.

New OpenAI Sessions include `request/wire-size`: the actual serialized payload
length/digest, declared tools size, and serialized tool-result message bytes in
the selected request, after replacement/compaction. These are **prepared for
HTTP**, not confirmation of sending, provider acceptance or billing. Failed
preparations are kept separately from committed usage. Historical Sessions
without boundary records have unobserved wire/history cost; raw results are
never summed as if they had all remained in subsequent requests.

`tool/batch-budget` records combined text before/after projection, saved-result
count and whether the budget was met. Storage failure preserves evidence and
reports `met: false`. Native CLI output is saved privately under the configured
Session directory's `tool-output/`; discover `ReadToolOutput` for Session-owned
byte pagination. Ordinary workspace Read authority does not expand.

## Better Harness UI

[inspector.mjs](inspector.md) optionally renders the summary using the existing
Better Harness Inspector without a new host adapter or Better Harness changes:

```sh
node harness/tools/session_report/inspector.mjs \
  --summary /absolute/trace-summary/summary.json \
  --better-harness /absolute/better-harness \
  --output /absolute/trace-summary/inspector.html
```

This produces self-contained HTML, its actual Inspector report JSON, and a
companion source index. Session navigation, failed tools and usage progression
use the original renderer. Context occupancy stays unobserved; original dialogue
is not fabricated from a summary.

For a single command that generates both summaries and the UI, pass
`--better-harness /absolute/better-harness` to `report.py`. Python-only summary
generation does not require Node. Inspector export errors leave the summaries
available and return an explicit failure.

## Verification

```sh
python3 -m unittest discover -s harness/tools/session_report -p 'test_*.py' -v
```

Tests use temporary native traces and actual report behavior, without network
or model requests. The trial runtime fixture additionally verifies automatic
report generation after a real ACP subprocess exits.
