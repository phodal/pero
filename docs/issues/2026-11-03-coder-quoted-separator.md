---
kind: incident
status: resolved
---

# Quoted Bash output is rejected by the selected review hook

A real-model coder review of an isolated Git fixture reached the spec gate and
quality reviewers but exhausted its explicit 32-request budget before finishing.
Two reports exist; this attempt is incomplete, not a successful acceptance.

The tool transcript also records four unnecessary denials of ordinary commands
such as `git diff BASE --stat && echo "=== full diff ===" && git diff BASE`.
The denial originates in the plugin's PreToolUse hook, rather than Harness's
Bash executor. Its separator expression treats the optional opening quote as
part of a forbidden echo, contradicting its own advice to quote output data.
This consumes additional model steps without performing the requested reads.

The repair must be an explicit content-addressed package migration. Keep the
original hook's remaining policy, including its existing unquoted-separator
denial, rather than bypassing the hook in Harness. Verify the quoted regression
cases, the original hook tests, and a separately recorded real-model attempt
with a sufficient declared budget. Do not hide or automatically replay the
incomplete first attempt, or claim the hook alone caused budget exhaustion.

The explicit [P03 migration](../../harness/go/plugins/migrations/selected-coder-hook-v1.json)
now removes only the optional-quote match from the echo rule. Eight JavaScript
cases preserve the previous bare-command policy and admit the observed quoted
commands; all twelve original resilience tests pass. The selected clone was
updated explicitly, while the user's original checkout remains untouched.

A separate isolated attempt used the original risk selector's D9/D8/D4 input,
an 80-request cap, and no automatic retries. It completed with 56 real model
requests, four review agents, four parsed pass reports and an approved Workflow
result. Six tests still pass; the source commit, tracked files and selected
plugin contents are unchanged. The first 32-request attempt remains recorded
as incomplete. The [reusable verifier](../../harness/tools/trial/verify_coder.py)
checks the actual source journal and original parsers; full development and
merge orchestration remains outside this review acceptance.
