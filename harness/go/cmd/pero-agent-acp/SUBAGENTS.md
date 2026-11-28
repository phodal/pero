# Optional in-process delegation

`--enable-subagents` installs `spawn_agent`, `fork_agent`, `wait_agent` and `list_agents`. Default: disabled. `--max-active-subagents=4` bounds active children per live root (accepted range 1–32). These one-shot tools have a depth limit of one.

Both delegation tools accept only `description` and `prompt`. They wait for a child result, then return it to the parent; cancelling the parent tool requests native child disposal. No independent background scheduler or model-selectable child configuration is exposed. Fork seeds only completed parent turns, excluding the currently running parent turn.

Children use the same adapter, process request cap, selected model route and validated compaction policy. Step and output-token limits inherit the parent's ceiling, including its committed request-header cap; explicit trusted child increases are rejected. Session events do not grant sandbox authority. Existing scope-owned file/shell/MCP checks remain unchanged.

**Children are restrictive:** approval is pinned to `never`, so operations requiring approval are rejected even if the parent can request permission. This is not a promise of autonomous child coding. Children inherit operator-granted MCP capabilities visible in the parent scope. MCP tools that do not require approval can execute, including tools with side effects; `never` is not a read-only guarantee. Child tool restrictions and parent-scope lifetime still apply, and delegation grants no capabilities beyond that inherited scope.

Existing AgentManager/SessionStore own identities and cleanup; native activation capacity, retirement and drain receipts own lifecycle. This mode does not mount external child processes, a continuable provider, or a distributed scheduler. The trusted Go API exposes native activation handles for host-owned waiting/disposal, not model authority.

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
with an unnamed ancestor keep Session IDs. Managed activations reserve sibling
names before startup, write them on successful catalog commit, and retain them
after settlement and restart. This changes neither existing single-use
`spawn_agent` / `fork_agent` nor Team owner selectors. The read-only `list_agents` tool shows the root,
continuable members and branch diagnostics; it does not make a child
continuable or authorize a later action.

## Optional DSH continuations

Pass `--enable-dsh-continuations` alongside `--enable-subagents` in ACP mode.
This adds `subagent` and `subagent_fork` with `description`, `prompt` and
optional sibling `name`. They return Session and initial message IDs without
awaiting the child. The root prompt stays open until the progressing tree
settles and any final root turn caused by a child notice has reached the ACP
client. Unrelated roots and parked, non-progressing input do not block it.
The continuable depth limit is two; the existing one-shot tools keep their
limits and permissions. A managed native child keeps its journal and can
resume through the existing exact-parent service when the saved route and
current parent policy still agree.

The same switch mounts `send_message({agent, message})` and
`interrupt_agent({agent})`. Use `list_agents` for addresses. A sender can
deliver to live members of the same managed tree, including siblings;
interruption requires an exact live ancestor. The interrupt receipt confirms
that the request was accepted, not that a turn has settled. Pending local input
stays parked until a later explicit wake. The tool does not start an inactive
target. A cold send can restore a target across levels through its original live
creator and the same saved-route checks. It cannot yet restore a target with
an offline creator. Host delivery and
interrupt authority are unchanged.
