---
kind: incident
status: resolved
date: 2026-11-04
---

# Request budget exhaustion becomes an ACP transport failure

The 89-task Terminal-Bench diagnostic run uses an explicit 32-request cap.
When it is reached, the provider returns the structured `BUDGET_EXHAUSTED`
failure. ACP propagates this expected limit as a JSON-RPC error. Harbor's
generic ACP client consequently exits with code 1, records
`NonZeroAgentExitCodeError`, and marks its reward invalid even when the
official verifier passes the submitted artifact. Both `build-pmars` and
`build-pov-ray` demonstrate this distinction in the pinned full-03 run.

ACP supports `max_turn_requests` for this termination. The actual Python
client schema installed in the benchmark environment accepts that value.
Map the typed request-budget failure to that stop reason at the ACP boundary;
preserve the native Session error and all other provider failures. The cap
still stops execution and must not become a successful `end_turn`.

The running full-03 cohort stays pinned to `2f02e684` and its original binary.
A protocol fix cannot retroactively change its recorded Harbor exceptions,
verifier results, or model success rate.

The ACP boundary now maps the shared typed request-budget code to
`max_turn_requests`. Native `turn/end` retains the original failure. The
regression table covers ordinary completion, output limit, refusal, direct and
wrapped budget failures, unrelated transport failure and untyped lookalike
text. It failed on both budget cases before the fix. ACP, OpenAI provider and
LLM Go race suites, their three Bazel targets and targeted `go vet` pass.

The user subsequently requested a fresh full suite without the 32-request cap.
That separately labeled full-04 run uses the same pinned binary with
`--max-requests 0` and the official task timeouts. The protocol fix is validated
offline and is not part of either cohort's binary.
