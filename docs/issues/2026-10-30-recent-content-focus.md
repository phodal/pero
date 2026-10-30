---
kind: incident
status: resolved
---

# Recent content preview lets a late source read steal picker focus

## What

In the macOS arm64 background Electron release-Wasm snapshot
`pero-content-release-tYZGeN`, Cmd-P opens Recent content and previews
`third.txt`. ArrowDown leaves `third.txt` selected instead of previewing
`second.txt`. The background editor selection moves to byte 17, the end of its
source. No file data is lost. This blocks the real keyboard quick-open workflow.

`tests/e2e/recent-content.mjs:51` reproduces the failure. Receipts are copied to
`test-results/recent-content/failure.json`, `failure.png` and `result.json`;
the invocation log is `test-results/content-reader/final-recent-gate.log`.
The separate eight-workflow Zed pane suite and 100k File reference gate passed
on this snapshot.

## Why

The picker previews a source through ordinary pane navigation. A previously
closed source needs an asynchronous Host read. The list restores search-input
focus after selecting its preview, but the later read completion materializes
the document. Both `open_document` and `activate_route` then call
`ContentReader::focus`, displacing the active dialog's search input. Kit's focus
trap confines Tab traversal; it does not block an explicit programmatic focus
request. ArrowDown therefore reaches the background editor.

## Fix and verification

The workspace reader's existing `focus` entry point now leaves focus with an
active Kit dialog. This covers source creation and subsequent activation without
adding a second picker focus state or delaying input. Inline readers retain
normal focus behavior. Enter/Cancel close the dialog before focusing the editor,
so that normal handoff remains available.

The fresh release-Wasm `pero-content-release-DFPsYM` build passes all five actual
keyboard workflows in the unchanged script: ArrowDown replaces its transient
preview, Escape restores the original view, typed search filters sources, Enter
keeps and focuses the editor, and a later preview preserves the dirty retained
tab. No page errors are reported. Native compile and 14 core tests also pass.
The receipt is `test-results/recent-content/result.json`.
