---
kind: verification_report
---

# Native HumanEval+ sample

2026-11-05. The first five-task native HumanEval+ sample passed 5/5; the matched
follow-up at `671897f7` passes **4/5**, with fewer requests but one correctness
regression. Both use Pero's native ACP agent and DeepSeek Flash on macOS arm64,
without Docker, VM startup or hidden-test feedback. These are selected function
samples, not full HumanEval+ scores or new Terminal-Bench scores.

## Provenance and controls

The native binary was built from `f564607736ed09325a9d475116141d8a5c7aeffa`.
The shared Python trial adapter additionally needs `67674ae9`, which accepts
explicit `max_requests: 0`, matching the CLI. Its default remains 64. All
21 trial tests pass, including the existing real-runtime test with zero cap.
The original rejected configuration made no agent/model request.

EvalPlus v0.3.1 is pinned at
`e5d0ed0bab96280b60b637ec7f15b5e4841b0cb2`; HumanEvalPlus v0.1.10 has
upstream full-data MD5 `fe585eb4df8c88d844eeb463ea4d0302`. The evaluator is
unmodified. The default `RLIMIT_AS` fails on this macOS host, so the supported
`EVALPLUS_MAX_MEMORY_BYTES=-1` option disables its memory limit. Official
per-test defaults remain a one-second minimum and a 4x reference-time factor.

All five reference implementations pass base/plus, and all five empty
implementations fail both. Before any model request, `find_zero` was replaced
by `sort_array`: the upstream `find_zero` branch continues before updating
progress/details, so its reference base control fails; its reference also
has numerical plus mismatches locally. Original controls and selection are
retained. No judge assertion was weakened.

Each task started with only the public prompt/signature/docstring and `pass`
in `solution.py`, in a separate temporary workspace. Full selected records,
reference solutions and tests stayed in a separate judge directory. One
submission per task used `deepseek-flash`, thinking disabled, 8192 output
tokens, no request/step cap, no HTTP retries, deferred tools, engineering
feedback and a 900-second Session / 240-second idle timeout. These Session
timeouts are run settings; EvalPlus supplies no agent Session time limit.
Frozen binary, source, input, evaluator and runner hashes are retained.

## Independent results and recorded usage

All five ACP prompts ended with `end_turn`, with confirmed successful cleanup.
The official evaluator checked 35 base inputs and 2,846 additional inputs.

| Task | Function | Base / plus | HTTP attempts | Tool calls | Failed calls | Recorded tokens |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| HumanEval/115 | max_fill | pass / pass | 10 | 10 | 0 | 58,153 |
| HumanEval/116 | sort_array | pass / pass | 79 | 77 | 18 | 1,418,081 |
| HumanEval/123 | get_odd_collatz | pass / pass | 11 | 10 | 0 | 63,344 |
| HumanEval/128 | prod_signs | pass / pass | 11 | 10 | 1 | 59,733 |
| HumanEval/129 | minPath | pass / pass | 13 | 13 | 0 | 90,957 |

The 124 responses record **1,690,268 tokens**: 64,007 uncached input,
1,598,720 cached input and 27,541 output. All responses have usage; HTTP
attempt counts reconcile and no failed/interrupted provider attempt is
observed. Recorded totals include cache reads and are not an invoice.
These totals belong to the first sample; the follow-up below compares the same
tasks without establishing causal savings.

## Failure observations

- **Timeout units:** `sort_array` supplied 15–90 as Bash `timeout` in 32
  calls; the unit is milliseconds. The first failure is seq 729/result 735.
  Eleven Bash processes timed out and two other Bash calls exited nonzero.
  Five TaskOutput calls read failed jobs, giving 18 failed tool invocations,
  not 18 independent failed processes. The model diagnosed Python installation
  problems, searched host interpreter directories and repeatedly changed its
  checks. This task accounts for 83.9% of recorded tokens. State the unit and
  an example directly on the timeout property; silently reinterpreting short
  values would change the API.
- **Masked check failure:** `get_odd_collatz` seq 833 ran a script in `/tmp`
  without the workspace import path. Python raised `ModuleNotFoundError`, but
  a trailing `echo` made Bash exit zero. The existing analyzer found traceback
  and printed-exit candidates. A source/result/stdout-hash-bound review confirms
  this additional validation failure; it is separate from the 19 explicit
  failed calls. Seq 974 moved the script into the workspace and passed.
- **Example format:** `prod_signs` seq 347/result 353 ran doctest against
  comparison examples without expected-output lines. `Expected nothing / Got
  True` is a test-format failure; subsequent explicit checks and the official
  evaluator pass. Public examples need interpretation before using doctest.
- **Feedback and lifecycle:** two progress reviews and a final review did
  not stop the `sort_array` cycle. Other tasks also repeated delivery checks.
  All 12 repeated-call observations changed; they are not automatically waste.
  After its successful main turn, `sort_array` received an old background-job
  failure notice. The resulting plugin turn was cancelled by Session close,
  without another provider response. Keep that separate from main-task status.
- **Workspace compliance:** four tasks wrote scratch scripts under `/tmp`
  despite the workspace-only prompt. Review of 120 tool arguments and scripts
  found no judge-path references or observed external-solution retrieval.
  The shell is unsandboxed; directory separation and this trace review do not
  establish OS filesystem/network isolation.

The reporter retains 19 unresolved strict operation-recovery windows. A changed
check can pass without closing an identical-operation window; these are not
19 failed benchmark tasks. Official acceptance is independently 5/5.

## Guidance correction after the sample

The Bash timeout property now names milliseconds and gives `30000 = 30 seconds`.
The bounded-check prompt uses the same example and asks the agent to inspect
its selected budget before diagnosing a timeout as an environment failure.
Existing native guidance also supplies an exit-status preservation example,
explains workspace-local Python imports and asks for expected-output format
checks before running illustrative docstrings as doctests. These changes
address missing/ambiguous instructions; they do not rewrite timeout values or
enforce arbitrary shell program exit codes. Native package race tests, vet and
the standalone Bazel native-tool target pass. The follow-up below includes
these instructions together with the notice and review changes.

Two observations motivated the follow-up. Reading a settled job with TaskOutput
did not consume its separately queued completion notice, so `sort_array` received an
already-observed failure after its main turn. Also, across the five tasks,
21 responses and 18 tool calls occurred after the final delivery-review prompt,
recording 320,366 tokens (19.0% of the total), with no Edit or Write tool calls.
Those checks may add evidence; the total is not a measured avoidable cost.
The following changes address notice acknowledgement and review scope.
Guidance compliance and workspace-only scratch writes remain empirical limits.

## Follow-up: notice acknowledgement and evidence reuse

The new binary is built from clean commit
`671897f73c9a5a39692406c3c616c4f419a0b02b`, including `0117957e` (timeout/check
guidance), `edcd04f6` (observed notices) and `671897f7` (review scope).
A committed TaskOutput/TaskStop terminal receipt now acknowledges the exact
stable completion notice in the existing durable inbox. Failed execution with
successful retrieval also counts; running/timeout/mismatched receipts do not.
Queued and later publication, unrelated FIFO work, interruption, real successful/
failed/stopped processes and disk resume have regression coverage. The actual
ACP CLI verifies one turn after a terminal read and a second turn for an unread
completion. Six related Go race suites, vet and four standalone Bazel targets pass.

Final and unbound progress reviews now compare task requirements with existing
evidence, reuse passed checks on unchanged inputs, and request another check only
for a concrete gap, failure or changed input. Machine acceptance stays independent.

The same five tasks started in fresh public-prompt-only workspaces. The runner,
public prompts, selected judge records, evaluator and provider/run settings are
unchanged; binary/wrapper/workspace receipts identify the new run. References
pass 5/5 and empty controls fail 5/5 again. Each task has one original submission;
no hidden feedback, answer repair or model retry was used. All five ACP prompts
end normally and cleanup succeeds.

| Task | Base / plus | Requests | Tool calls | Explicit failed calls | Reviewed masked failures | Recorded tokens |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| HumanEval/115 | pass / pass | 7 | 5 | 0 | 0 | 31,852 |
| HumanEval/116 | fail / pass | 22 | 21 | 0 | 7 | 196,852 |
| HumanEval/123 | pass / pass | 7 | 6 | 0 | 0 | 32,657 |
| HumanEval/128 | pass / pass | 8 | 7 | 0 | 0 | 38,158 |
| HumanEval/129 | pass / pass | 17 | 16 | 0 | 2 | 133,509 |

| Metric | First sample | Follow-up |
| --- | ---: | ---: |
| Pass both base and plus | 5/5 | **4/5** |
| Provider responses / HTTP attempts | 124 | 61 |
| Tool calls | 120 | 55 |
| Explicit failed tool calls | 19 | 0 |
| Reviewed zero-exit validation failures | 1 | 9 |
| Recorded tokens | 1,690,268 | 433,028 |
| Responses after final review | 21 | 5 |
| Tools after final review | 18 | 0 |
| Tokens after final review | 320,366 | 45,988 |

Recorded token lanes are 38,437 uncached input, 378,496 cache reads and 16,095
output; usage is complete and response counts reconcile. The observed total
falls 74.4%, requests 50.8% and tool calls 54.2%, while acceptance falls by one
task. Several changes and stochastic single samples are combined, so these
are observed deltas, not repeatable or causal savings. `minPath` costs more than
before because it repairs its own tests. Cached reads remain included, not billed cost.

Each final review uses one response and no tools. No model call supplies a tiny
timeout; `sort_array` uses the default instead of 15–90 milliseconds. No timeout
or plugin turn occurs. The follow-up has no background jobs or TaskOutput calls,
so it does **not** exercise notice suppression; the real-process and recovery
regressions above establish that behavior.

### Remaining failure evidence

`sort_array` initially writes general popcount/value ordering at seq 402, then
rewrites it at seq 1491 to sort negatives separately while keeping negative
positions fixed. That rule is absent from the specification. The public prose
restricts inputs to nonnegative integers, but includes a negative example;
its printed example outputs also conflict with popcount sorting. The official
reference applies popcount/value ordering to all values. For the retained base
failure `[-2, -3, -4, -5, -6]`, it expects `[-4, -2, -6, -5, -3]`; the submitted
special rule returns `[-6, -5, -4, -3, -2]`. Plus tests pass, but the combined task
verdict remains failed. The original implementation's form matches the reference
rule; it is not a second graded submission or a replacement score.

All nine zero-exit candidates were reviewed against commands and actual output
and bound to source/result/stdout hashes. Seven are `sort_array` self-test
assertions, including incorrect tuple ordering and conflicting negative rules;
one invocation also runs illustrative examples through doctest. `minPath` adds
an incorrect assertion that the path values must be globally sorted, then calls
a test helper before defining it. Both are repaired locally and its independent
verdict passes. Trailing `echo`/filters hide the failing check exits in all nine
cases. Therefore zero explicit tool failures does not mean zero validation
failures: prompt guidance has not eliminated masking or invented test expectations.

Three tasks still use `/tmp` scratch, and four inspect `.pero` output directories.
Review of all 55 tool arguments and embedded scripts finds no judge-path access
or external-solution retrieval. This remains an unsandboxed trace observation.
The next improvement needs to preserve source-backed requirements when tests
conflict and expose masked validation evidence during execution; another generic
instruction alone has not demonstrated that behavior. No benchmark-specific
negative-number rule or hidden oracle was added to the harness.

Follow-up artifacts are in sibling root `evalplus-native-20261105-02`:
`manifest.json`, `binary-build.json`, `runner-preflight.json`, original
`judge/samples_eval_results.json`, `complete.json`, `comparison.json`/`.md`,
`analyze.py`, nine bound `reviews.json` entries, `tool-access-review.json` and
`final-audit.json`. The aggregate report includes those annotations and its
existing Better Harness Inspector loads all five Sessions. The Inspector's
explicit failure counter excludes masked failures; the reviewed count and judge
verdicts are in the summary/comparison. Frozen inputs remain unchanged, and the
credential-literal audit has zero matches. Raw traces/binary/judge records stay
outside Git.

## Retained artifacts

Root:
`/Users/phodal/workforce/openstar-agents/reports/coding-benchmark-2026-11-04/evalplus-native-20261105-01`.

- `manifest.json`, `runner-preflight.json`, `judge/preflight-initial/`: fixed
  inputs, setup failures and initial controls.
- `complete.json`, `comparison.json`, `comparison.md`: results and analysis.
- `judge/*_eval_results.json`: reference, empty and candidate official verdicts.
- `tasks/*/agent/sessions/*.jsonl`: native Sessions, explicitly redirected with
  `--session-dir`; this run does not use `~/.pero/sessions`.
- `all-sessions/summary.md`, `inspector.html` and source index: offline summary
  and existing Better Harness UI. The generated Inspector loads locally and
  lists all five Sessions; it does not import the official judge's verdicts.
- `reviews.json`, `tool-access-review.json`: bound masked-failure review and
  access evidence limitations.

Frozen inputs were unchanged at completion. The credential-literal scan found
zero matches. Binaries, raw traces and dataset/test records remain outside Git.

Related: [benchmark candidates](coding-benchmark-candidates.md),
[Session reporting](../../harness/tools/session_report/README.md).
