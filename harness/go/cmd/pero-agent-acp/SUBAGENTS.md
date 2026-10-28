# Optional in-process delegation

`--enable-subagents` installs `spawn_agent` and `fork_agent`. Default: disabled. `--max-active-subagents=4` bounds active children per live root (accepted range 1–32). Delegation depth is one; child tools cannot create grandchildren.

Both tools accept only `description` and `prompt`. They wait for a child result, then return it to the parent; cancelling the parent tool requests native child disposal. No independent background scheduler or model-selectable child configuration is exposed. Fork seeds only completed parent turns, excluding the currently running parent turn.

Children use the same adapter, process request cap, selected model route and validated compaction policy. Step and output-token limits inherit the parent's ceiling, including its committed request-header cap; explicit trusted child increases are rejected. Session events do not grant sandbox authority. Existing scope-owned file/shell/MCP checks remain unchanged.

**Children are restrictive:** approval is pinned to `never`, so operations requiring approval are rejected even if the parent can request permission. This is not a promise of autonomous child coding. Children inherit operator-granted MCP capabilities visible in the parent scope. MCP tools that do not require approval can execute, including tools with side effects; `never` is not a read-only guarantee. Child tool restrictions and parent-scope lifetime still apply, and delegation grants no capabilities beyond that inherited scope.

Existing AgentManager/SessionStore own identities and cleanup; native activation capacity, retirement and drain receipts own lifecycle. There are no external child processes, cold continuation provider, Teams/Projects/jobs/scheduler/plugin-host features. The trusted Go API exposes native activation handles for host-owned waiting/disposal, not model authority.
