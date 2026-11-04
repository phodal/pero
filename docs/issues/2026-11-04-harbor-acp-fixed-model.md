---
kind: verification_report
status: resolved
date: 2026-11-04
---

# Harbor ACP fixed-model integration

The initial Terminal-Bench `cancel-async-tasks` trial uses native Pero source
`bf6f6fb8` and Harbor `8c6bdacc`. Harbor's job configuration supplies
`model_name=deepseek/deepseek-flash`, but the Pero launcher already fixes
`--model deepseek-flash` and advertises no model-selection capability with only
one model. Harbor's ACP runner refuses the requested selection before sending
`session/prompt`: `ACP agent did not advertise a model-selection mechanism`.

The native Session contains its header and controller/permission setup records,
with no assistant response; the HTTP attempt audit is empty.
Harbor records an agent exception and subsequently gives the empty workspace
reward 0. This is a preserved integration failure with zero model requests;
it is not evidence about the model's coding ability. The reference and no-op
controls passed 6/6 and failed 6/6 respectively with unchanged official tests.

Use Harbor's supported fixed-agent configuration without `model_name`; the
existing launcher continues to select DeepSeek Flash explicitly. Preserve the
initial job and run the corrected configuration as a separate job. No provider,
model, test, task instruction or production ACP behavior changes.

The corrected job successfully completes 26 provider requests and 25 paired
tool calls, writes native Session/ACP/ATIF records, and ends normally. The
official verdict is reward 0 with 1/6 tests passed: the model implemented a
synchronous API instead of the required async API. The integration defect is
resolved; the coding failure remains preserved in the
[smoke-run report](../fitness/terminal-bench-smoke.md).

Local evidence is under the analysis workspace's
`reports/coding-benchmark-2026-11-04/terminal-bench2-01/`.
