# Pinned Pero ACP diagnostics with Harbor

[harbor_acp.py](harbor_acp.py) stages a supplied Linux Pero ACP binary and a
neutral Claude plugin through Harbor's installed ACP agent. Harbor is an
optional external dependency; it is not vendored or imported by the offline
Session reporter.

Add this directory to `PYTHONPATH` when invoking the Harbor Python environment.
Use this agent configuration in a Harbor job:

```json
{
  "import_path": "harbor_acp:PinnedPeroACP",
  "env": {"DEEPSEEK_API_KEY": "${DEEPSEEK_API_KEY}"},
  "kwargs": {"binary_path": "/absolute/path/to/pero-agent-acp-linux-amd64"}
}
```

The launcher fixes DeepSeek Flash, thinking disabled, deferred tools, 8,192
output tokens per response, zero HTTP retries, no provider-request cap and
`--max-turn-steps 0`. The latter explicitly removes the otherwise independent
512-step turn ceiling; cancellation and provider budgets remain effective.
It uses the container's actual cwd and exports native Session JSONL and HTTP
attempt records into the trial's agent logs. Do not request Harbor ACP model
negotiation for this fixed route. Supply credentials through the environment,
never command arguments. The binary must match the task container architecture
and support `--max-turn-steps` (available from source `561febe7`). Older binaries
retain a hidden step ceiling even when `--max-requests 0` is supplied.

`image_input: true` additionally declares bounded PNG/JPEG input through the
existing ACP CLI flag. The default is false; record this capability in reports.
A provider's advertised support does not establish a successful image task.

On host cancellation, the adapter signals the exact agent PID written by its
exec launcher and its confirmed direct ACP runner parent. Stopping the runner
closes the agent's stdin pipe. It waits for agent exit before returning control
to Harbor. Cleanup failure or forced SIGKILL escalation fails the trial and
retains an explicit receipt rather than claiming graceful termination.
`pero-timeout-cleanup.json` is separate from ACP summary and judge results;
terminating the runner can prevent its usual ACP summary from being written.

The real-process control and actual Harbor cancellation verification are
documented in [the timeout incident](../../docs/issues/2026-11-04-harbor-acp-timeout-cleanup.md).
This adapter does not repair or relabel trials made with the earlier staging
adapter. Retain those native traces and raw rewards, audit phase overlap and
use separately recorded corrected trials where deadline termination matters.
