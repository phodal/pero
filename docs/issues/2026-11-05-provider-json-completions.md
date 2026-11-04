---
kind: issue
status: resolved
date: 2026-11-05
---

# Compatible provider exposes JSON completions but no streaming channel

Two native sol trials fail on their first request with HTTP 503 and no usage.
Direct probes isolate the boundary: identical minimal requests sent together
return HTTP 200 with a normal Chat completion for `stream: false`, and HTTP
503 `NO_AVAILABLE_CHANNEL` for `stream: true`. A separate streamed tool probe
also fails before a tool result exists. These observations describe the
operator's endpoint at this time, not all providers or the model itself.

The adapter always requests SSE and rejects JSON success responses. Add an
explicit disable-streaming option. Map a complete Chat response into the same
assembly/validation path as streamed responses, preserving tool arguments,
usage, output truncation, cancellation, timeout and shared request budgets.
The operator chooses transport before submission; do not automatically replay
a failed streaming request as a JSON request. Keep the frozen DeepSeek cohort
and corrective binary unchanged.

The explicit JSON Chat transport passed provider and native CLI tests,
including malformed/truncated arguments, usage and cancellation. Direct sol
text-only requests succeed with JSON, while a function still returns 503.
The separately selected Responses protocol completed the real tool task.
There is no automatic fallback between protocols or streaming modes.
