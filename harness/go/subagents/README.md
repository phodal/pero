# In-process delegation profiles

The legacy subset reuses Point's exact Agent/Session ownership and native subagent registry. It does not introduce a separate coordinator or store.

## Legacy spawn and fork

The host must boot with `EnableSubagents: true`, mount `MountInProcess` and/or `MountForkInProcess`, then explicitly mount `MountTool`. No provider or model-facing tool is enabled by default. Providers only call the same registered adapter; there are no external processes or provider credentials here.

Model tool arguments are only `description` and `prompt`. The tool waits for the child result; canceling its parent call revokes the native activation. Native registry cleanup receipts remain owned through teardown. The default trusted depth is one; native activation capacity is also enforced. The trusted API retains native activation Result/RequestDispose/Dispose/Wait handles.

Children retain exact parent scope and completed-turn fork boundaries. They cannot change CWD/model route or increase step/output budgets; output limits include the latest committed parent request-header cap. Existing shared provider request limits still apply. Child permission-requiring operations are denied (`ApprovalNever`), not escalated or silently approved. Workspace/sandbox authority remains immutable launch configuration; session events never widen it. Trusted compaction configuration may be copied from the same launch policy. No preset, continuation, root reopening, Teams, Projects, jobs, scheduler or plugin-host surface is provided.

`SOURCE.json` describes the source revision and deliberate compatibility narrowing. Legacy model responses use fixtures; the selected-profile execution checks below use real HTTP and filesystem effects.

## Selected Claude agents and continuation

MountClaude now registers a managed continuation provider for general-purpose
and selected custom agents. Agent.resume retains its old plugin spelling;
SendMessage with to=agent ID and a text message is the current continuation
entry. Optional summary remains in the normal tool argument journal. Legacy
Agent.resume still requires description/prompt and preserves the original
model/definition; supplying subagent_type/model during resume is rejected.
Names, team protocol and cross-session messaging remain unsupported here.

Each new managed child records its selected definition, effective route, persona
and declared tool restriction before execution. Resume uses the same child
ID and Session conversation, then reconstructs scoped execution with the
current parent, depth/capacity, route validation, budget and approval policy.
The selected definition must still exist. Its current tools are intersected
with the original declared restriction; inherited tools still resolve through
the current exact parent scope. Current parent permission mode
is read when reconstructing the child. Filesystem/sandbox authority stays with
the existing parent scope. Original tools and file effects are not re-executed.

The same runtime can restore a completed child from SessionStore. With the
explicit persistence option, a fresh runtime can load the child's JSONL and
continue with its complete prior conversation. This includes prior tool calls,
results and closing messages. Resuming a running child queues into its existing
activation; the shared epoch result is observed once. SendMessage enables a
parent completion notice for that activation. Existing TaskOutput/TaskStop
ownership and cancellation remain in force.

Explore and Plan use the separate one-shot provider. Calls that carry arbitrary
trusted ConfigureChild callbacks also stay one-shot: such callbacks can mount
policy that cannot be reconstructed from a descriptor. This preserves WebFetch
extraction isolation, skill-fork configuration and Workflow helper restrictions.
They are explicitly non-resumable rather than restored without their policy.
Managed structured output uses a fresh exact-child admission gate; its schema
and capture belong to that activation, not a later resumed turn.

Trusted `ClaudeOptions.MemoryPresentation: subagents.MemoryAsContext` keeps
MEMORY.md text out of the system persona. Only memory usage rules remain there;
the bounded UTF-8 body enters an attributed runtime user context with scope,
path and a digest of the rendered body. Context refreshes from the selected
memory file on requests and is restored after compaction. New children journal
the typed binding, so managed continuation and JSONL reload preserve this mode
even when the later launcher uses legacy defaults. Resume revalidates the
binding against the current selected scope and path. A changed binding requires
a new child. Existing children without this marker retain their original
persona; no string-based migration is attempted. The zero option preserves
legacy rendering for newly created children.

Tests use real loopback HTTP, native Write/Read, permission denial, a queued
message on an active child, managed structured output and one-shot boundaries.
A JSONL test creates a file with one approval, destroys the original runtime,
and resumes the same ID through fresh persistence/runtime objects with narrower
tools. It reads the existing file without another Write or approval. Unrelated
parents cannot resume the child, including when no task is in the live cache.
No paid model request was made. This proves completed-conversation continuation,
not revival of an in-flight model request, detached process or JavaScript stack.
Running-task cold recovery remains separate work.

## Background Bash activity

Selected managed background agents retain an explicit activity for each native
background Bash command, including an already-started foreground command that
promotes. An idle turn does not settle that activation while its activity is
unfinished. Its task remains running and the same child may receive messages.
Foreground children still stop their commands when their run ends.

After persisting the actual terminal result, Bash publishes its task receipt
before admitting a bounded completion notice into the original child's inbox.
The activity stays retained through admission, then releases once. A running
child receives next-step input; an idle child starts a continuation turn. Only
after that work settles can the parent's task receive the final child result.
Structured output refuses unfinished activities and unprocessed messages.
Completion persistence/delivery failure fails the activation rather than
silently returning its earlier answer. Task lookup remains exact-owner scoped.

TaskStop, archive stop and parent retirement revoke the original activation and
join command cleanup. Shutdown does not preserve or relaunch its processes.
The selected profile opts into retention per activation, including SendMessage
continuations; one-shot/internal configured children do not acquire it.
Real FIFO-blocked process tests cover turn residency, completion/history,
same-PID promotion, resumed background conversations, one command/approval,
foreground cleanup, TaskStop, archive stop and parent retirement. Models use
loopback HTTP. This is live-process residency, not process cold recovery.

Official behavior reference: [resume subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents).
Command ownership reference: [when a background command stops](https://code.claude.com/docs/en/tools-reference#when-a-background-command-stops).
