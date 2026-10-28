# Explicit bounded in-process delegation

This subset reuses Point's exact Agent/Session ownership and native subagent registry. It does not introduce a separate coordinator or store.

The host must boot with `EnableSubagents: true`, mount `MountInProcess` and/or `MountForkInProcess`, then explicitly mount `MountTool`. No provider or model-facing tool is enabled by default. Providers only call the same registered adapter; there are no external processes or provider credentials here.

Model tool arguments are only `description` and `prompt`. The tool waits for the child result; canceling its parent call revokes the native activation. Native registry cleanup receipts remain owned through teardown. The default trusted depth is one; native activation capacity is also enforced. The trusted API retains native activation Result/RequestDispose/Dispose/Wait handles.

Children retain exact parent scope and completed-turn fork boundaries. They cannot change CWD/model route or increase step/output budgets; output limits include the latest committed parent request-header cap. Existing shared provider request limits still apply. Child permission-requiring operations are denied (`ApprovalNever`), not escalated or silently approved. Workspace/sandbox authority remains immutable launch configuration; session events never widen it. Trusted compaction configuration may be copied from the same launch policy. No preset, continuation, root reopening, Teams, Projects, jobs, scheduler or plugin-host surface is provided.

`SOURCE.json` describes the source revision and deliberate compatibility narrowing. Tests are entirely synthetic.
