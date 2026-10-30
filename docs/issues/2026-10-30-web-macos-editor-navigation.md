---
kind: incident
status: resolved
---

# Browser-hosted editor misses macOS document and word navigation

## What

In actual macOS Electron, Cmd-Up did not move the source cursor to the document
start. The 100k-file checkpoint/restart/save workflow inserted its test space at
the clicked field's byte offset instead of the requested start. The draft journal
and saved file preserved that actual edit exactly; this is a navigation failure.
The receipt is the `pero-content-release-T4HKhB` snapshot's
`test-results/workspace-file-references/failure.json` and the invocation log at
`test-results/content-reader/file-reference-gate.log`.

## Why

Kit registers these shortcuts under `cfg(target_os = "macos")`. Wasm compiles
for an unknown OS, so those bindings never enter its keymap. Pero's shared Web
platform already restores macOS copy, Undo and line-navigation conventions from
the actual browser platform; document and word navigation were missing.

The Workbench also duplicated the Web platform initializer instead of calling
the shared one. Commit `874882a` removes that duplicate and uses the shared
initializer for document/word navigation across embedded GPUI surfaces. Native
retains Kit's platform bindings. The actual file test verifies the zero-byte
cursor before typing, so a regression fails before persistence comparisons.

## Actual verification

The fresh release-Wasm `pero-content-release-tYZGeN` build passes the actual
100k-file edit/checkpoint/crash/restart/Save/Save As workflow. Cmd-Up places the
cursor at byte zero, and both saved files exactly match the original source plus
the leading space. The source is 13,688,892 bytes, checkpoint metadata 3,144 bytes,
and edit journal 653 bytes; every recorded reference command is below 4 KiB.
The local receipt is `test-results/workspace-file-references/result.json`.
