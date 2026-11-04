---
kind: issue
status: resolved
date: 2026-11-04
---

# Build failures hidden by successful shell pipelines

The uncapped Terminal-Bench `caffe-cifar-10` Session contains two `make -j8`
commands whose output reports `make: *** [...] Error 1`. Both shell commands
return zero because `tail` is the last pipeline command. The trace reporter
preserves that exit code but emits no validation review candidate, so a reader
filtering for failures misses the build errors.

Recognize the terminal GNU Make error summary as a review candidate, including
recursive `make[n]` and `gmake`. Keep it separate from explicit tool failures,
manual review verdicts and the official task reward: printed or expected build
errors can still be quoted evidence. A successful build and a printed source
string containing an error must not match.

The benchmark binary and its submissions stay pinned. Only offline analysis
changes; no score improvement is implied.

## Resolution and verification

The existing validation-signal table now recognizes terminal `make`, recursive
`make[n]` and `gmake` nonzero error summaries. All 21 reporter tests pass;
the behavior table includes successful and quoted-source negative cases. The
signal remains `review_required` and does not change the tool's success state.

Reanalyzing the real Caffe Session changes review candidates from zero to two.
Its 35 responses, 380,379 recorded tokens and two explicit failed tool calls
are unchanged. The two build results have separate source/output-hash-bound
manual reviews in the local run artifacts; they do not alter official reward.
