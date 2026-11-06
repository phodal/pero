---
kind: analysis
date: 2026-11-06
---

# Durability trace optimization analysis

The three frozen [feature attempts](agentic-coding-durability.md) expose one
confirmed context defect and several optimization candidates. Fix fresh-result
visibility first, then measure complete conversation retention and diagnostic
noise. The evidence does not justify treating all 2,166,073 reported tokens as
waste, skipping regression checks or claiming an efficiency improvement.

This is an offline analysis of the original 99 responses and 152 tool calls.
No model request, submission repair or runtime change is made. An independent
Python replay reconstructs the selected tool-result surface and Responses
serialization; its byte total matches the recorded `tool_result_message_bytes`
at all 99 request boundaries. Assistant item sizes are reconstructed from the
typed replay metadata used by `responses_encode.go`. They are byte categories,
not provider token attribution. The residual includes system/user/developer
content, envelope and array punctuation; the full request digest is not replayed.

## Context composition

| Serialized request component, summed across requests | Bytes | Share |
| --- | ---: | ---: |
| Tool-result items | 3,292,986 | 39.70% |
| Assistant function-call items, including earlier Write/Edit arguments | 2,037,591 | 24.57% |
| Assistant reasoning replay items | 1,281,785 | 15.45% |
| Tool declarations | 773,244 | 9.32% |
| Assistant message items | 225,839 | 2.72% |
| Remaining payload | 682,612 | 8.23% |
| Total | 8,294,057 | 100% |

Tool-history clearing operates on tool results. It does not bound the earlier
function-call arguments or encrypted reasoning retained by the stateless
Responses conversation. The latter two categories together occupy 40.02% of
serialized payload. The reasoning data is opaque protocol state, not text to
trim independently. Preserve protocol items and call/result balance when using
the existing conversation compactor.

| Project | First / last request input tokens, including cache | Returned native read lines | Lines returned previously at the same digest |
| --- | ---: | ---: | ---: |
| Gin | 5,101 / 38,790 | 1,319 | 8 |
| FastAPI | 5,084 / 28,075 | 362 | 0 |
| OpenManus | 5,027 / 24,420 | 2,537 | 874 |

The read-line totals sum returned native text windows, including partial reads.
They are not a count of unique files or proof the model observed every line.
The cache-read fraction is 272,896 / 2,137,542 input tokens, or 12.77%.
The trace alone cannot separate provider cache policy, routing, timing and
prefix changes. Cache billing or hypothetical savings cannot be inferred.

## Priority 1: preserve fresh results before clearing history

OpenManus results 81/82 return the lower halves of `web_search.py` and
`config.py`. They are cleared at replacements 107/109, before request 113,
which is the first next request. No earlier request had consumed those windows.
The model later reads overlapping ranges from the unchanged files.

`harness/loop.go:206` clears history before building the request.
`tool/pruner.go:377` protects four recent results by count, while this batch
contains eight results. The history watermarks are exceeded and two fresh
windows are eligible for clearing. This is independent of output truncation:
the batch-output budget is met and all original text remains in the journal.

Protect results created since the preceding model request through their first
request, then apply normal history retention to consumed results. Keep the rule
in the existing pruner/request boundary. The
[canonical open record](../issues/2026-11-06-tool-results-pruned-before-model.md)
states the required behavior and focused regression. Fixing it may reduce
recovery reads; only a subsequent matched run can measure that effect.

## Priority 2: budget the entire conversation

The experiment has model compaction disabled because the endpoint's context
capacity is unknown. Tool-history projection is active, with 56 replacements,
but the assistant call arguments and replay state keep growing. Gin's final
request alone carries 57,300 bytes of assistant function-call items and 42,772
bytes of reasoning replay, versus 50,509 bytes of tool-result items.

Once context capacity is explicitly established, evaluate the existing
`--context-window`, `--compaction-trigger-tokens` and
`--compaction-retain-tokens` configuration with a fixed task set. Count summary
requests and usage in the same budget. Retain the current two-turn Gin flow to
verify that JWT requirements and implementation survive compaction. The
observation supports testing this existing mechanism; it does not establish a
safe context capacity or a proven savings percentage.

## Priority 3: retain current diagnostic evidence compactly

FastAPI's failed tool-result items account for 391,244 bytes across requests,
or 14.13% of its payload and 33.40% of its retained tool-result bytes. Its first
full Ruff and ty logs each appear in the following 17 requests, contributing
343,774 bytes together. At the last request, failed results still contribute
26,734 of 49,586 tool-result bytes, or 53.91%.

These calls are useful: ty diagnostics fall from 18 to 13 to 11 as new code is
fixed. Final independent controls confirm all remaining 11 diagnostics exist
in the baseline. Ruff similarly finishes at seven inherited diagnostics versus
eight baseline diagnostics. Do not suppress the checks or classify their exits
as successes.

Use concise diagnostic output from the first invocation and record baseline
versus changed-code findings. For history retention, evaluate a current check
summary plus original-result readback, bound to check/input identity and still
marked failed or inherited. The present duplicate-error policy requires exact
arguments and complete diagnostic equality, so verbose/concise invocations and
changing error sets preserve multiple long protected logs. Any replacement
must keep new/unknown diagnostics visible and preserve full raw evidence.

## Priority 4: focus discovery, then reassess read reuse

OpenManus makes nine requests and consumes 113,754 reported tokens before its
first file edit, about 30.47% of that project's usage. It reads 2,537 lines;
874, or 34.45%, were returned earlier at the same file digest. Only one of those
overlapping lines is still present as an original read window in the request
that leads to the repeated call. History clearing accounts for the missing
windows; a blanket claim that the model ignored visible content is unsupported.

Start with the search engine-order function, its execution/retry path and the
search settings/configuration loader. Existing Grep and ranged Read can locate
those owners without reading broad README, sandbox-test and unrelated base
code upfront. The existing exploration reminder fires after 16 consecutive
discovery operations; it is advisory and counts calls, not retained evidence.
Its activation does not prove it prevents the observed recovery reads.

Native read reuse currently admits only a complete implicit full-file read;
explicit/partial windows intentionally remain full. First repair fresh-result
visibility and rerun. Use the remaining overlap evidence to decide whether a
range-coverage mechanism is warranted, rather than adding that complexity now.

## Priority 5: batch independent edits after interfaces are clear

FastAPI steps 5 through 16 each make one call: eleven file mutations and one
database update command. The model already batches discovery and verification,
so the runtime supports multiple tool calls. Some file creation can share a
response once model/repository/route interfaces are decided. Preserve sequential
dependencies, especially edits to the same file and checks after changed inputs.
This is a trajectory/prompt experiment, not evidence to add another scheduler
or automatically parallelize effectful commands.

## Checks to retain and lower-priority work

Gin repeats vet/build and removes the executable after its second feature.
Those calls follow new source and dependency edits, so identical commands or
empty successful outputs do not establish wasted checks. FastAPI's type-fix
iterations and OpenManus's retry/error-case tests also add validation evidence.
The failed SQLite self-check compared raw schema metadata too strictly; the
model later normalizes SQLite's integer-primary-key nullability semantics.
Keep semantic schema/persistence checks while avoiding that false alarm.

Deferred discovery uses one search per project and has no empty searches.
Compact schema exposure from tools never used is 71,550 bytes across all
Sessions; this is a separate measurement from serialized declarations. Further
catalog tuning has less immediate evidence than fresh-result visibility and
conversation/diagnostic retention. No new retry, continuation, task-specific
cleanup or automatic model routing is warranted by these traces.

Run the first repair against the existing offline behavior suites, then compare
matched serial model trials with frozen acceptance. Record first-use visibility,
overlap/recovery reads, all usage lanes, compaction overhead and unchanged
functional results. These analysis candidates are not implemented savings.

## Evidence

Derived metrics and the rerunnable analyzer live at
`/Users/phodal/benchmarks/ai4se/analyses/20261106-sol-durability-trace-01/`.
Original Sessions remain in the prior run directory and retain these hashes:

| Project | Session | SHA-256 |
| --- | --- | --- |
| Gin | `6215aeed-03cf-4ae5-b6e0-afd8624eee56` | 82a79a38d9d2674bff5d956e6abf0e735d131aebddc4971e2cfb879f157e3b4a |
| FastAPI | `ca901e4b-da49-44d8-abad-6be1c46d25e6` | 0093b4806d4ab780ed27e360258e6abdf813afac1c0ce60378a7aab2ec4863b8 |
| OpenManus | `450c4cc6-6bf5-4848-8e52-3c7da4b0e246` | bf9c8e65067060c1ac8fcfb337de40cbbb47615e10bb63497b38a9c39ce96e2c |

Metrics SHA-256: `15be2b95c2e1965b9ed95e659cea3f99f6f62fb779d23d80f77cd6adca8f8aa9`.
Analyzer SHA-256: `9ff353484b745c3b0746e57370d5af2658548c8ac14c21c0417807caad993ffc`.
