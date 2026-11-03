---
kind: incident
status: active
---

# Align native tools, prompts and provider requests

The tool comparison exposed two reproducible blockers: Bash directory tracking
reopened a workspace-relative sidecar after the command had replaced that
workspace, contaminating the original output; the subagents Bazel library also
omitted its direct shell dependency. Native image Read returns formats and
dimensions the provider rejects, allowing a successful tool result to break the
next request. Text-only tool-image projection already exists and must remain.

Implementation and verification are tracked in
`docs/exec-plans/active/harness-tool-contracts.md`. Reuse the existing workspace,
shell, tool restriction, instruction and session owners. Reference projects are
behavioral comparisons only; no third-party source, prompts or tests are copied.
