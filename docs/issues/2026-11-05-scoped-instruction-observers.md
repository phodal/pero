---
kind: incident
status: resolved
---

# InstructionsLoaded must consider the owning agent's scoped hooks

The admission shortcut checked package hooks only. A declaration in agent
frontmatter or an activated skill mounted successfully but never observed
CLAUDE.md loads unless an unrelated package-level observer existed.

Use the existing HookAttribution and hooksFor selection to decide whether the
owning agent has an InstructionsLoaded observer. This shares the same scope
selection as dispatch; no new registry or fallback global hook is introduced.
A skill activated after an earlier unobserved baseline receives the currently
admitted baseline. Existing unchanged-baseline deduplication still applies.

The existing actual-context test now covers package, skill and real child-agent
scopes without a package-level fallback. It verifies child/root attribution,
late skill activation, root/nested loads, ignored observer decisions and
unchanged-baseline deduplication. Plugin runtime race/vet and its Bazel target
pass; direct coder/new_code CLI opt-ins also pass with the actual plugin paths.
