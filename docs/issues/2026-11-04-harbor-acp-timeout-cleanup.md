---
kind: issue
status: resolved
date: 2026-11-04
---

# ACP agent continues after Harbor's Docker execution timeout

In the uncapped Terminal-Bench run, Harbor records the COBOL agent phase ending
at `2026-11-04T11:45:04.807158Z` after its official 900-second timeout. The
verifier runs from `11:45:05.507573Z` to `11:45:24.275993Z`. The native Session
then commits another assistant response and starts a Bash command at
`11:45:29.2368Z`. The original result is reward 1 with `AgentTimeoutError`.

The observed late call performs scratch work in `/tmp/pbk`; no late Edit/Write
of the submitted Python file is observed. Nevertheless, the agent remains
capable of mutation during verification, and its usage extends past the stated
agent phase. The reward is not a proven snapshot of the deadline submission.

Harbor's ACP run awaits a container exec pipeline. Cancelling the host Docker
client does not terminate that pipeline or its agent inside the container.
The current staging adapter does not explicitly terminate the owned ACP agent
before verification. This is an integration lifecycle defect, separate from
model/tool errors and from Pero's queued plugin-notice turn attribution.

Preserve the original trial and audit all completed native journals against
agent/verifier phase timestamps. Do not silently count a time-overlap reward as
a verified deadline result. A corrected adapter must terminate and join its
exact owned agent on cancellation before allowing verification, with a real
container-process control. Keep the running cohort's controls and original
results intact; any corrected follow-up must have separate receipts.

## Resolution and verification

The reusable [Harbor adapter](../../harness/tools/harbor_acp.md) records its exact
agent and runner PIDs. On cancellation it verifies the staged agent argv and
direct runner parent, sends SIGTERM to both, and joins agent termination before
returning to Harbor. Rosetta exposes its interpreter via `/proc/pid/exe`, so
ownership validation uses the launcher PID and staged binary argv instead.
Cleanup failure or SIGKILL escalation remains an explicit failed cleanup.

In the first pinned-agent control, SIGTERM cancelled the pending Bash but the
agent did not exit within ten seconds while its client retained stdin. Closing
that pipe by stopping its owned runner allowed graceful agent exit. A corrected
control with a local provider fixture starts a real Bash, cancels it, confirms
agent exit and observes no delayed file write. The earlier failed controls are
retained, not counted as successful checks.

A separate actual Harbor job uses the same pinned Linux binary and a real
DeepSeek request. A synthetic task's ten-second timeout interrupts a Bash that
would write a file after thirty seconds. Cleanup completes at
`12:08:33.738506Z`; Harbor's agent phase ends at `12:08:33.746919Z` and the
verifier starts at `12:08:34.389050Z`. The verifier confirms the agent is gone
and watches for 35 seconds without a delayed write. Its control reward is 1;
the job correctly retains `AgentTimeoutError`. No assistant response or tool
call is observed after the agent phase. This is a lifecycle control, not a
Terminal-Bench task or an improved benchmark score.

Evidence is retained under the full-04 artifact root in `timeout-control/`,
`timeout-harbor-control/` and `timing-audit.json`. The full suite remains on the
original adapter; its old timeout results still need separately recorded
follow-up. Resolution here describes the new adapter, not retroactive cleanup.
