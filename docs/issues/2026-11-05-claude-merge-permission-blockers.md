---
kind: issue
status: open
date: 2026-11-05
pull_request: https://github.com/phodal/pero/pull/116
---

# Claude compatibility merge blocked by permission matching

Pre-merge review checked PR #116 at `0117957ed6bee4bf4e4086f8e8539f8293859ccc`
and dependent PR #132 at `cd5010b17044c46341ac7a9fc2daa15ced9e6c15`.
Applicable CI checks pass, but two unresolved review findings still reproduce.
Neither PR was merged. No external plugin changes are needed for these bugs.

## Confirmed behavior

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

Other unresolved PR #116 comments remain to be fully dispositioned. The two
confirmed permission defects alone block the conditional merge. Repair belongs
in Pero, followed by behavioral regression coverage and renewed merge checks.
