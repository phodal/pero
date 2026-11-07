---
kind: verification_report
date: 2026-11-06
---

# Tool-result visibility through the first response

Repair `6dc2c921` prevents history clearing from removing newly produced results
before the next model response. Both fresh OpenManus trials retain every result
through its first request, and existing history clearing still runs. The
[visibility issue](../issues/2026-11-06-tool-results-pruned-before-model.md) is
resolved. These runs do not demonstrate a token reduction.

## References and selected rule

Local source snapshots under `/Users/phodal/ai` were inspected at these revisions.
Exact inspected file paths and SHA-256 values are in the retained
`reference-sources.json`; the Claude source is an extracted snapshot.

| Project | Revision | Relevant behavior |
| --- | --- | --- |
| Qwen Code | `6fe83a82457d` | `microcompact.ts:639`: pending content counts toward pressure but cannot be cleared; recent protection applies separately to committed history |
| Claude Code extracted | `1dbf34de9b86` | `cluster-11/4196.js:52`: retain the latest three eligible tool results; save cleared text for readback; count alone does not establish pending-batch protection |
| Pi | `90b42bca6ed1` | `compaction.ts:389`: valid cuts preserve assistant tool-call/result groups rather than starting at a tool result |
| Codex | `fc39cfcacd8c` | `context_manager/history.rs:543`: truncate live tool history while retaining original rollout payloads |
| DeepSeek Harness | `8bd073392eef` | `compaction-tool-result-pruner/src/index.ts:136`: project per-result text from one stable surface, retaining originals and replacement provenance |

Pero adopts Qwen's separation between pending results and consumed history.
The existing `ToolResultPruner` derives the boundary from the latest durable
`assistant/message`: a response acknowledges the preceding request. All later
results remain protected, including pending duplicate errors. They do not spend
the `keepRecent` slots belonging to consumed results. After the response they
become eligible for normal history clearing. A failed request without a response
leaves them protected. No additional state, journal event or loop hook is needed,
and restoring a Session derives the same boundary from its existing log.

Watermarks remain soft targets: fresh results and protected errors can exceed
them. Explicit tool/batch output limits, legacy per-result projection, raw
readback, call/result pairing and unique-error protection retain their behavior.

## Deterministic checks

Four added rows fail against the old pruner and pass with the repair: no response
yet, a pending batch of eight exceeding the recent count, pending results with
zero recent protection, and pending duplicate errors. Existing consumed-history
watermark, failure and replay/readback cases remain. The batch test also checks
that a pending-batch member becomes prunable after a response.

`go test -race ./...` passes in `harness/go`, covering 36 packages. A subsequent
stronger assertion on consumed-batch membership passes the focused tool race
suite as well.

A separate offline Go replay restores each original Session immediately before
the first clearing operation at five affected boundaries: original request 113,
r2 requests 117/157/200 and r3 request 109. The new pruner retains all six Read
results originally lost there and clears 4/4/2/1/3 other consumed results.
This checks the recorded failure inputs; it does not rerun those old model
responses or infer counterfactual tokens.

## Fresh model verification

Run `20261106-sol-durability-first-use-01` builds a clean macOS arm64 binary from
`6dc2c921ec7808769ecd9fd5b4de970908c9aecc` using Go 1.27.3 and `CGO_ENABLED=0`.
Binary SHA-256:
`85077aef8a7a9c8a1c7cf39486294b2be5a816dfa2f29646e5b0b4f6d99c9e7e`.
Publication incorporates master `ada90a7c`; its Harness and Trial trees equal
the evaluated revision, before the additional test assertion.

Two fresh source clones use the same original prompt, frozen package versions,
preconfigured search-only environment and byte-identical independent judge.
Controls still pass default fallback and reject the absent Google-only feature.
Serial runs keep `gpt-6.1-sol`, the configured Responses endpoint, nonstreaming,
zero retries/continuations, deferred tools, feedback profile and the same request,
time and 48,000/24,000-character/four-recent history limits. Model compaction
remains disabled. No earlier candidate output or independent feedback enters
either prompt, and no submission is repaired after independent verification.

| Trial | Requests | Tools / failed | Reported tokens | History results cleared before first request | Ordinary history replacements |
| --- | ---: | ---: | ---: | ---: | ---: |
| OpenManus-r4 | 34 | 56 / 5 | 632,066 | 0 | 37 |
| OpenManus-r5 | 22 | 49 / 4 | 428,967 | 0 | 29 |
| Total | 56 | 105 / 9 | 1,061,033 | 0 | 66 |

The independent tool-result wire replay matches all 56 request boundaries.
An additional visibility audit covers every tool-result type: the three old
traces contain 2/3/1 fresh omissions, versus 0/0 in these new traces. All responses
report usage, every call has a result and both native processes end normally
with zero exit and no cleanup errors. No request deadline or batch-budget miss
is recorded. Nine failed calls remain retained evidence, including missing
optional tools/imports/paths and candidate tests subsequently corrected.

Both submissions document a default-false `google_only` switch in the existing
engine-order owner. All four frozen TOML/search behavior cases pass, as do 9
and 7 scoped candidate tests. R4 ordinary pytest collection is blocked by missing
`browser_use`; r5's tests bypass the unrelated package barrel themselves and its
ordinary command passes. Full application/browser/LLM/live search is unverified.
Source review and a separate default-exception probe confirm both preserve the
baseline `RetryError` behavior, unlike the prior r3's extra fallback change.

This fixes context correctness, while other efficiency findings remain. R4
uses more requests and tokens than the old attempts; r5 remains within their
token range. Unchanged-digest read overlap is still 1,202/2,909 and 772/2,593
returned native lines. Only 1/0 overlap lines remain as original windows before
the repeated calls. Most rereads still follow normal old-history clearing.
These stochastic runs do not establish a token saving. Diagnostic retention,
whole-conversation compaction and focused discovery require separate changes
and measurements.

The [machine report](../design-docs/harness-tool-result-first-use-verification.json)
records runtime/source identities, usage, checks and evidence hashes. Raw inputs,
Sessions, manifests, judges, logs and post-run probes stay under
`/Users/phodal/benchmarks/ai4se/runs/20261106-sol-durability-first-use-01/`;
replay scripts and metrics stay under the matching `analyses/` directory.
Final audits confirm pristine source clones, unchanged frozen inputs/judges and
primary postprocessors, zero credential-literal matches and no owned native
processes. No raw trace, binary or SQLite file is committed to Pero.
