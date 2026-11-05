---
kind: verification_report
---

# Native HumanEval+ sample

2026-11-05. Five selected HumanEval+ tasks passed both base and extra tests
through Pero's native ACP agent and DeepSeek Flash on macOS arm64. This run
used no Docker, VM startup or hidden-test feedback. It is a selected function
sample, not a full HumanEval+ score or a new Terminal-Bench score.

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
There is no matched baseline establishing token savings.

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
the standalone Bazel native-tool target pass. There is no post-change model
rerun or new score/token comparison.

Two observations remain open. Reading a settled job with TaskOutput does not
consume its separately queued completion notice, so `sort_array` received an
already-observed failure after its main turn. Also, across the five tasks,
21 responses and 18 tool calls occurred after the final delivery-review prompt,
recording 320,366 tokens (19.0% of the total), with no Edit or Write tool calls.
Those checks may add evidence; the total is not a measured avoidable cost.
Task-relevant review scope and reuse of current verification evidence need a
separate change and acceptance. Guidance compliance and workspace-only scratch
writes also remain empirical limits.

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
