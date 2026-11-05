---
kind: incident
status: resolved
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

The reproducible blockers above are resolved: directory observation no longer
contaminates command output; Bazel declares the direct dependency; Read normalizes
images and invalid historical payloads remain recoverable. Per-request guidance,
regex/glob, multi-file patches, planning, scoped instructions, catalog search,
Skill denials and notebook reading now have behavioral coverage. MessageDisplay's
separate notification deadlock is recorded in its own resolved incident.

Final verification: all Go race tests and vet passed, all 34 Harness Bazel tests
passed. Full-suite load also exposed an invalid assertion in the Bash recovery
test: Dispose can legitimately return ErrHarnessDisposalInProgress while its
owned callbacks settle. The test now accepts that receipt and still checks Drain,
no command replay and one recovered notice; ten consecutive race runs passed.
The execution plan retains deferred product capabilities and model evaluation;
this incident resolution does not declare every comparison feature implemented.
