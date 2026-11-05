---
kind: incident
status: resolved
---

# Explicit repository worktree cleanup fails before Git

An actual selected-plugin CLI/ACP regression created two Git worktrees through
the original script, delegated real native Read/Write to a child, committed the
changes on the isolated branch, and resolved the original registry from inside
a worktree. Cleanup with an explicit --repos list then failed with Node's
`paths[2]` type error, leaving both directories behind.

The plugin calls `args.repos.map(resolve)`. Array.map passes value, index and
the array; node:path.resolve accepts variadic string paths. This is a plugin
callback-arity bug, not a Harness workspace rejection. Status, conversion and
cleanup share the faulty expression. Repair the exact source snapshot through
an explicit migration, and rerun the real multi-repository lifecycle without
dropping the supported --repos parameter to hide the error.

The exact-snapshot `selected-coder-worktree-v1.json` migration now replaces the
callback with `path => resolve(path)`, with before/after digests and an
idempotent preflight. The regression first reproduces the original Node error,
then checks both paths, including spaces, after transformation.

The actual CLI/ACP lifecycle passed three consecutive race-enabled runs:
two repositories, five parent and four child loopback model requests, and five
real tool approvals per run. It creates both worktrees, delegates Read/Write,
commits on the isolated branch, resumes the original registry from inside a
worktree, and cleans up using the explicit repository list. Original repository
files remain unchanged; both feature commits survive cleanup. The package's
eight original worktree/branch-merge tests also pass. This verifies this
lifecycle, rather than the full development and merge orchestration.
