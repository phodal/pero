# Optional in-process delegation

`--enable-subagents` installs `spawn_agent`, `fork_agent` and `wait_agent`. Default: disabled. `--max-active-subagents=4` bounds active children per live root (accepted range 1–32). Delegation depth is one; child tools cannot create grandchildren.

Both delegation tools accept only `description` and `prompt`. They wait for a child result, then return it to the parent; cancelling the parent tool requests native child disposal. No independent background scheduler or model-selectable child configuration is exposed. Fork seeds only completed parent turns, excluding the currently running parent turn.

Children use the same adapter, process request cap, selected model route and validated compaction policy. Step and output-token limits inherit the parent's ceiling, including its committed request-header cap; explicit trusted child increases are rejected. Session events do not grant sandbox authority. Existing scope-owned file/shell/MCP checks remain unchanged.

**Children are restrictive:** approval is pinned to `never`, so operations requiring approval are rejected even if the parent can request permission. This is not a promise of autonomous child coding. Children inherit operator-granted MCP capabilities visible in the parent scope. MCP tools that do not require approval can execute, including tools with side effects; `never` is not a read-only guarantee. Child tool restrictions and parent-scope lifetime still apply, and delegation grants no capabilities beyond that inherited scope.

Existing AgentManager/SessionStore own identities and cleanup; native activation capacity, retirement and drain receipts own lifecycle. There are no external child processes, cold continuation provider, or distributed Projects/jobs/scheduler/plugin-host features. The trusted Go API exposes native activation handles for host-owned waiting/disposal, not model authority.

`wait_agent` observes only the caller's next-step input (including steering
and active-turn notices); it does not claim input or wait for a child to
finish. It returns `{"timedOut":false}` for new pending input or
`{"timedOut":true}` after `timeout_ms` (default 30000; 10000–3600000).
Another wait inside the same root tool execution ignores already-reported
message IDs. Next-turn work and other agents' messages do not release the
wait. The existing delegation tools still return results to the caller.

## Optional Team board

Add `--enable-team` alongside `--enable-subagents` in ACP mode. Use the host’s `commands/execute` with `line: "/team on"` to enable the shared task board for a durable root session. `/team off` hides its tools without deleting tasks. This adds revision-checked task claims, not new execution powers or background workers. See the [DSH alignment notes](../../../../docs/fitness/dsh-alpha2-alignment.md#team-task-board-opt-in-native-slice) for limits.

The ACP composition also mounts a read-only DSH session-catalog query. It uses
parent-owned journal entries and reads cold journals without loading Agents or
publishing Sessions. A reachable one-shot session can lead to a continuable
grandchild; unreadable branches stop locally and ordinary forks have separate
catalogs. The query understands the v3 catalog format and resolves root-relative
paths such as `verify/checker` without crossing into unrelated branches. Logs
with an unnamed ancestor keep Session IDs. Native child creation does not yet
reserve and write those names, and model-facing `list_agents` is not yet exposed.
