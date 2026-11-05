---
kind: incident
status: resolved
---

# Failed child tool calls must not become parent tool-result content

The real coder continuation exhausted its configured provider request budget
while a fourth plan reviewer was running. The failed Agent receipt correctly
reported BUDGET_EXHAUSTED, but also appended the child's last assistant content,
which was a Bash tool-call block. A tool-result cannot contain a nested tool call.
The parent's next provider conversion failed with unsupported message or
tool-result media/content, masking the original budget failure.

Project failed child output through the existing supported result-content
boundary. Retain the diagnostic and meaningful text without forwarding executable
tool-call content or replaying side effects. Add a managed-child budget failure
regression through a real model continuation before resuming paid verification.

SubagentResult now owns ParentContent, which projects only text and image blocks
into parent results and clones retained media. Assistant tool calls, nested tool
results and reasoning stay in the child transcript. Both selected Claude and
generic synchronous tools use it, as do the legacy parent notice paths. Existing
managed settlement messages retain their narrower text-only presentation.

The actual loopback HTTP regression reproduced the original conversion error.
After the fix, one parent and nineteen child HTTP requests exhaust the shared
cap of twenty; the parent sees the original budget error, with no request beyond
the cap. One actual Write is retained, subsequent Reads do not replay it, and
visible text survives the failed Agent receipt. The fixture explicitly uses
auto-review; it has no interactive approval and is not a human acceptance.
The projection test also preserves images without aliasing the child transcript.
The focused regressions pass three consecutive race-enabled runs; Go full
race/vet and Bazel harness, subagents and complete CLI targets pass.

The historical real-run receipt remains unchanged. This fix prevents new invalid
parent results; it does not silently rewrite previously persisted tool-call
blocks. A later verification must explicitly select its runtime and recovery
context, and continue using the original workflow's authoritative resume step.
