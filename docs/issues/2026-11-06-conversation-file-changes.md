---
kind: incident
status: resolved
---

# Conversation outputs omitted workspace code changes

A Native conversation edited README.md and README.zh-CN.md, but the output catalog
still showed zero. The catalog records explicit deliver_artifact calls and manual
saved replies/results only. No owner captured workspace changes around ACP turns,
so code edits had neither a changed-file card nor a recorded diff in the UI.
Counting edit calls or parsing the final answer would not establish actual changes,
and diffing against HEAD would incorrectly attribute earlier uncommitted work to
the current turn.

Reference: local DeepSeek Harness fcc0ad4621, workspace-changes and ui-deliverables.
DSH records a turn-start/turn-end git snapshot, summarizes actual net effects, and
shows its changed-file card separately from explicit present deliveries. It opens
recorded before/after comparisons through the Host rather than rereading current
files as the historical result.

The owner is the existing Rust ACP runtime, under its workspace write
lease. Private Git indexes/object storage preserve the user's index and refs.
Named contract values carry changed-file counts, rename metadata, binary status
and comparison content. The shared Chat output panel consumes those values,
retains explicit document delivery, and offers a compact Diff entry beside
permissions with flat file navigation and unified/side-by-side review. Current worktree review is labeled separately because
old conversations have no reconstructable turn baseline.

Validation and current limits are recorded in docs/fitness/session-artifacts.md.
