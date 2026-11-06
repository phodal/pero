---
kind: issue
status: resolved
date: 2026-11-06
---

# Fresh tool results can be cleared before their first model request

The frozen OpenManus durability attempt at `5e87d45a` returns eight results in
step 5. The history policy clears two newly returned source windows before
step 6 prepares its first request containing that batch. Their raw text remains
recoverable in the Session, but the model receives omission locators instead
of either source window. This is an observed model-context defect, even though
the final scoped feature checks pass.

The exact native sequence is:

| Event | Observation |
| --- | --- |
| Calls 72/73 | Read `app/tool/web_search.py` from line 201 and `app/config.py` from line 201 |
| Results 81/82 | Return 218 and 172 lines, respectively |
| Prunes 106/108; replacements 107/109 | Replace these results with history omission locators |
| Request 113 | First subsequent prepared request; step 6 |
| Calls 116, 126, 127, 128, 147, 173 | Re-read overlapping windows at unchanged file digests |

There is no prepared request between results 81/82 and their replacements.
Only the initial halves of these files were available in earlier requests.
The source files are unchanged until call 182. The later overlapping reads do
not prove an exact counterfactual request/token saving, but the fresh-content
loss itself is directly recorded.

The policy uses a 48,000-character threshold, 24,000-character low watermark
and four protected recent results. `harness/loop.go` invokes the pruner before
constructing the next model request. `tool/pruner.go` counts recent results;
it does not protect every result produced since the last model request. A
batch larger than four can therefore lose fresh results under pressure.
The batch-output budget was met, so this is not its explicit projection path.

The required behavior is that successful results produced after the previous
request remain available for their first model request, subject to the existing
explicit output/batch bounds. Older consumed history can still be cleared with
durable readback. Use the existing request/result ownership and pruner; do not
add a separate cache or change tool effects. A focused regression should cover
a batch larger than `keepRecent` under pressure and subsequent pruning after
the first request. Failure evidence and call/result pairing must survive.

The analysis and repetitions above preceded the runtime repair below. Original
attempts and their scoped acceptance remain unchanged.

Evidence: `/Users/phodal/benchmarks/ai4se/runs/20261106-sol-durability-01/`,
Session `450c4cc6-6bf5-4848-8e52-3c7da4b0e246`; trace SHA-256 and the offline
analysis provenance are in [the trace analysis](../fitness/durability-trace-analysis.md).

## Fresh repetitions

Run `20261106-sol-durability-repeat-01` uses clean master `2a667adf`, whose
Harness and Trial trees equal the original evaluated revision. Fresh clones,
venvs and unchanged prompts/judges run serially, without earlier candidate
outputs or hidden acceptance feedback. Both additional OpenManus attempts
reproduce the defect, with no batch-budget miss:

| Attempt | Original result | Omission replacement | First subsequent prepared request |
| --- | ---: | ---: | ---: |
| OpenManus-r2 | 88, `web_search.py` lower window | 113 | 117 |
| OpenManus-r2 | 131, `web_search.py` upper window | 153 | 157 |
| OpenManus-r2 | 179, README window | 196 | 200 |
| OpenManus-r3 | 82, `web_search.py` lower window | 105 | 109 |

No request occurs between any original result and its replacement. The offline
replay matches tool-result wire sizes at all 81 request boundaries across the
three new trials. Including the original attempt, three observed OpenManus
traces contain this defect; this is not a population-rate estimate.

Scoped Google-only checks still pass. R3 also changes default exception
behavior outside the frozen judge coverage, recorded separately in the
[repeat report](../fitness/durability-repeat-verification.md). Those successful
feature checks alone did not repair first-use visibility.

## Repair

The history pruner now derives its consumption boundary from the latest durable
`assistant/message`. All later results survive until a response acknowledges
the next request; they do not use the recent-result slots reserved for consumed
history. This also protects pending duplicate errors before deduplication can
clear them. After a response, ordinary watermarks and error protection apply.
The per-result projection and explicit tool/batch output limits are unchanged.
History watermarks remain soft targets when protected content exceeds them.

The approach follows Qwen's separation of pending content and committed history
in `packages/core/src/services/microcompaction/microcompact.ts` at
`6fe83a82457def9ab8daa43bf833b4cfdf192bd2`. Pero uses its existing durable
response event, so no additional Session state or journal event is needed.

Four added table rows fail before the repair and pass after it: no acknowledged
response, a pending batch larger than the recent count, no recent protection,
and pending duplicate errors. The tests also confirm the batch becomes eligible
after a response, consumed recent results survive, and original readback/replay
is retained. `go test -race ./...` passes in `harness/go` (36 packages).

Repair `6dc2c921` also retains all six originally lost Read results when replaying
the five affected historical boundaries. Two fresh serial OpenManus trials
record zero history results cleared before their first request, while still
performing 37 and 29 ordinary history replacements. Four frozen search behavior
checks and 9/7 scoped candidate tests pass. Full application startup remains
unverified. This closes the visibility defect, without claiming reduced token
usage or resolving other context-efficiency findings. Evidence and source
comparisons: [first-use verification](../fitness/tool-result-first-use.md).
