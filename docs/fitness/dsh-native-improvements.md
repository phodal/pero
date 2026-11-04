---
kind: verification_report
---

# Native coding follow-up from DSH, Pi and Qwen

2026-11-04, macOS arm64. This follow-up targets three observed problems in
the [previous four-task sample](coding-benchmark-followup.md): empty capability
searches, repeated relative `cd`, and expensive or incorrectly reported local
validation. It changes the native contracts and capability-scoped guidance.
The optional engineering profile remains off unless explicitly selected.

## Pinned source comparison

Local source repositories under `/Users/phodal/ai` were read only.

| Reference | Revision | Mechanism used |
| --- | --- | --- |
| deepseek-harness | `8bd073392eef6f54e921a093b95076248eb08cbb` | `packages/shell/tool-bash/src/index.ts`: explicit invocation workdir resolved from Session cwd; actual exit status and separate execution guidance |
| pi-mono | `90b42bca6ed161b8e7ee40ceda9755205c2882ec` | `packages/coding-agent/src/extensions/tool-search/tool.ts`: authorized metadata, keyword coverage/name ranking and bounded discovery |
| qwen-code | `6fe83a82457def9ab8daa43bf833b4cfdf192bd2` | `packages/core/src/core/prompts.ts`: project-defined checks, diagnose before retry, report failed/unrun checks faithfully |

The referenced recovered Qoder templates are under
`workforce/openstar-agents/reports/qoder-prompts-2026-11-03`. The named G51
implementation identifies GPT51, not GLM51; the files do not establish a
GLM51 system prompt. G51/G54's focused verification guidance is a behavior
reference. The earlier engineering contracts, skills budgets and memory
attribution are already merged and are not reimplemented here. No recovered
third-party prompt body is included in Pero.

## Contract changes

- ToolSearch retains all-keyword matches when available. Otherwise it returns
  explicitly marked partial matches ordered by keyword coverage, then name
  matches. Exact selection, caller filtering, page/schema budgets and exact
  next-request activation remain with the existing owners. This is a small
  literal matcher, not Pi's full BM25 implementation.
- Claude Bash accepts optional `workdir`. Relative values resolve from the
  Session workspace, and explicit values neither read nor update remembered
  cwd. Foreground/background execution and durable identity use the same rule.
  A trusted `WithSessionWorkingDirectory` check retains its Session anchor.
- Execution guidance prioritizes project checks and focused verification,
  distinguishes self-test expectations from specifications, explains empty
  coverage, and makes pipeline status preservation concrete. Bash job guidance
  is present only when Bash, TaskOutput and TaskStop are all declared.
  No printed-output classifier or automatic command rewriting is introduced.

## Local verification

The complete Harness Go race suite passed in 35 packages; `go vet ./...` and
`git diff --check` passed. The existing cold-shell-recovery test twice rejected
the documented pending Dispose sentinel before reaching Drain. Its lifecycle
assertion now accepts only that sentinel and still requires successful Drain.
The corrected recovery table passed 30 consecutive race runs. Production
shutdown semantics, effect assertions and timing are unchanged.

Search tests cover partial results through actual provider HTTP declarations,
successful next-request calls, permission/retirement filtering and pagination.
Directory tests cover foreground/background, explicit/remembered paths,
invalid directory admission, trusted anchors and durable call identity.
Guidance tests cover capability withdrawal. These checks establish runtime
behavior, not token savings or model adherence.
