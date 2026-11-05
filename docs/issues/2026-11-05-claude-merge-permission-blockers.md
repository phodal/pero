---
kind: issue
status: resolved
date: 2026-11-05
pull_request: https://github.com/phodal/pero/pull/116
---

# Claude compatibility merge blocked by permission matching

Pre-merge review checked PR #116 at `0117957ed6bee4bf4e4086f8e8539f8293859ccc`
and dependent PR #132 at `cd5010b17044c46341ac7a9fc2daa15ced9e6c15`.
At the initial review, applicable CI checks passed but two unresolved review
findings still reproduced, so neither PR was merged. The repair below is in
Pero; external plugin sources were not changed.

## Original behavior

- The shell read-only classifier returns true for `git branch -D victim`,
  `git tag -d v1`, `git remote set-url origin other`, and `./cat payload`.
  Git subcommands with mutating arguments and arbitrary executables sharing a
  familiar basename can therefore receive the read-only allow exemption.
  Existing review: https://github.com/phodal/pero/pull/116#discussion_r4476610181
- Session deny/ask evaluation reuses `skills.AllowsTool`, whose semantics are
  all-segment preapproval with a read-only exemption. With `Bash(rm *)`, the
  matcher returns true for `rm victim`, false for `rm victim; touch marker`,
  and true for `echo harmless`. This both misses a denied segment in a compound
  command and incorrectly matches unrelated read-only commands. Deny/ask
  matching must not reuse the preapproval exemption or all-segment requirement.
  Existing review: https://github.com/phodal/pero/pull/116#discussion_r4476610190

## Evidence and limits

A temporary Go program called the exported classifier and matcher using the
commands above as inert strings. It did not execute those shell commands.
The three relevant files (`shell/claude_allow.go`, `skills/permissions.go`,
`pluginruntime/hooks_permission.go`) are identical between both reviewed heads.
This establishes the matcher defects; it is not an end-to-end execution test.

## Repairs and regression coverage

All nine unresolved PR #116 findings were inspected and addressed:

- Read-only classification rejects path masquerading, mutating Git ref/remote
  forms, output-file flags and explicit pager/external-transform execution.
- Deny/ask matches any command segment without read-only or prefix preapproval
  exemptions. Unparseable Bash syntax is conservatively restricted when a Bash
  restriction exists; this intentionally may require a simpler command.
- Dynamic skill commands use the registry's existing Before admission pipeline,
  carry actual ToolInput into approval, execute updatedInput and retain typed
  interruption. Tests cover ordinary Bash, slash and Skill entry points under
  session deny, ask and interrupt, including a broad competing allow rule.
- Permission interruption stops undispatched tools and cancels active batch
  operations, records a result for every call and ends the turn. A typed
  ToolInterruptError survives both approval and nested Skill execution.
- MCP tracks exact active calls and declines uncorrelated elicitation when caller
  attribution is ambiguous. Regression covers overlapping callers, unbound
  calls, both completion orders and subsequent sole-caller attribution.
- ServiceStart declares its unsandboxed shell operation to the existing approval
  owner. Read-only and workspace-write modes reject even preapproved startup.
- NotebookEdit rejects non-v4 input before mutation; v3 insert and future/missing
  format regressions preserve original bytes.
- Bash artifact creation validates the original workspace rather than command
  workdir. Explicit and remembered subdirectories retain large output.
- Frontmatter retains asyncRewake and shares the typed timeout conversion with
  JSON hooks; nonpositive, NaN, infinite and overflowing durations are rejected.

The integrated snapshot includes base branch `5f158886` and master `1263c395`.
Full Harness Go race passed; subsequent serial/parallel interruption (including Stop-hook continuation) and remembered
CWD cases passed in the final targeted runs. Full vet, Gazelle diff, all 36 standalone Bazel race targets and CLI build
passed. The execution plan records integration checks; GitHub remains the source
for final-head CI and merge status.

## Integration findings against current master

Base-branch CI run 42013826503 exposed three additional integration failures:
`AgentConfig` test construction omitted the new required-MCP field; the startup
snapshot included operator-only MCP names in public settings events; and Bazel's
npm input-hash cache was stale after root package scripts changed. The repair
keeps public observation limited to managed/required servers while retaining
operator configuration for ACP, fills the test fixture field and regenerates
npm sync metadata. Existing Host persistence/privacy contracts are retained.

The repaired integration passes the four core Rust package suites (286 tests,
one existing ignored test), the real Host build, and unchanged Host MCP settings
and ownership acceptance. Operator servers still reach ACP, while public events
exclude their private names and credentials. Bazel npm sync updated only the root
package input hash; dependencies and pnpm resolutions are unchanged.
