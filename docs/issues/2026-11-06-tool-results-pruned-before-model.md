---
kind: issue
status: open
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

This record contains analysis only. No runtime repair or new model attempt is
included, and the original scoped acceptance remains unchanged.

Evidence: `/Users/phodal/benchmarks/ai4se/runs/20261106-sol-durability-01/`,
Session `450c4cc6-6bf5-4848-8e52-3c7da4b0e246`; trace SHA-256 and the offline
analysis provenance are in [the trace analysis](../fitness/durability-trace-analysis.md).
