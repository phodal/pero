---
kind: incident
status: resolved
---

# Dynamic skill commands must require the agent's Bash tool

Permission-mode verification found that ExpandSkill constructs a shell executor
and asks the approval broker directly without resolving Bash in the invoking
agent's tool scope. An allowed-tools grant or explicit auto-review could therefore
execute a dynamic command even when the host did not expose Bash, or the agent's
tool restriction removed it. A permission grant must not manufacture a tool.

The [official injected-command contract](https://code.claude.com/docs/en/skills#permission-checks-on-injected-commands)
requires the invocation to abort when the session lacks its shell tool. Reproduce
the missing-tool case through the actual CLI, then check scoped Bash availability
before command approval or any command side effect. Preserve ordinary static
skills and the existing permission decision owner.

The actual CLI regression reproduced the failure: with shell disabled and
auto-review explicitly selected, dynamic context expanded and both reports were
written. ExpandSkill now queries the registry's existing SchemasForAgent view
before command planning and approval. Missing or restricted Bash returns
ErrSkillCommandDenied without executing the command. The registry remains the
single owner of tool visibility; permission policy is unchanged.

The scoped regression denies Bash while retaining the skill's Bash preapproval,
in both full-access and auto-review. No file side effect or interactive approval
occurs, and static skills still load. The CLI regression now checks all three
cases: manual shell-enabled refusal, explicit auto-review shell-enabled success,
and auto-review shell-disabled refusal before any model request. Trial's sixteen
tests and the pluginruntime race tests pass.
