# Explicit workspace instructions

`Mount(ctx, h, Options{Workspace: absolutePath})` opts in to loading exactly
`Workspace/AGENTS.md` before model steps. Close the returned App after Harness
Dispose/Drain. The host must validate session CWD with `App.CheckCWD`; each step
also checks the same descriptor-backed workspace authority.

By default no home, parent, nested, `CLAUDE.md`, local override, script, network, or product
profile discovery is performed. A missing file is optional. Symlinks, replaced
roots, invalid text and files over the existing 1 MiB reader bound are errors.
Rendered context is bounded to 64 KiB by default (configurable 1–64 KiB), with
UTF-8-safe truncation and an omission marker.

The file is untrusted user-role task guidance, not permission. Existing approvals
and filesystem policy remain authoritative. Changed or removed content produces
a replacement baseline; unchanged content is deduplicated from durable session
messages, including after JSONL reload. No extra database or mutable cache is
used. This remains narrower than Point's dynamic instruction loader;
see SOURCE.json for reused renderer provenance and adaptations.

`Options{Workspace: absolutePath, Hierarchical: true}` (CLI:
`--enable-hierarchical-instructions --workspace PATH`) additionally loads
workspace-contained `CLAUDE.md` then `AGENTS.md` at root and along paths touched
by file tools, including both endpoints of patch moves. Broad directories appear
first, with more specific guidance taking precedence; each block names its scope.
No home or ancestors above the selected workspace are consulted. At most 64
directories participate; the existing combined rendering budget still applies.

Before a native file mutation, the current target's hierarchy must match the
baseline already delivered to the model. A new or changed instruction blocks
that call with a retry message; the next model step receives the refreshed
baseline. This covers a first write into an unread directory and instruction
edits/removals between steps. Discovery and refresh derive from durable tool-call
events and message digests, so JSONL restore requires no mutable cache. Shell
commands do not expose their file targets and are outside this file-tool gate.
When native root-worktree tools are mounted, the instruction reader follows only
the current root session's typed, active worktree lease and verified descriptor.
Returning to the original workspace replaces the baseline again. Existing
children keep their retained worktree context. Generic added-directory bindings
and a bare working-directory event do not grant instruction authority.
