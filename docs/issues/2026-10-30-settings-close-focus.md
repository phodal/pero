---
kind: incident
status: resolved
---

# Closing Settings leaves workspace keyboard commands without focus

## What

In the actual background Electron release-Wasm snapshot
`pero-content-release-DFPsYM`, the icon theme gate installs and selects Source
Shapes through Settings, then closes Settings with its visible close button.
The immediate Cmd-O does not open the file picker: `settingsOpen` is false,
`activeContent` is null, and no document error or page error is reported.
The gate fails waiting for its temporary `source.rs` to open.

Receipts are that snapshot's `test-results/icon-themes/failure.json`,
`failure.png`, and `result.json`. The test deliberately adds no intervening
click to repair focus. No source data is lost.

## Why and repair

Settings opens from the sidebar's transient dropdown. Kit captures the focused
handle when opening its dialog; that handle can belong to the dropdown that is
subsequently removed. Closing Settings cleared its panel and closed the Kit
dialog, but did not restore a live Workbench/editor handle. Root keyboard
commands therefore had no live Workbench focus path.

The Settings close owner now restores the active document or workspace focus
after closing its dialog. Escape with an empty search uses that same close
owner, avoiding Kit's delayed restoration of the obsolete dropdown handle.
The existing icon gate still sends Cmd-O immediately after observing Settings
closed. On fresh release-Wasm `pero-content-release-L55R4N`, that command opens
the exact temporary Rust file, followed by JSON and unknown-extension files;
admitted theme artwork and dark/light fallback checks also pass. There is no
intervening test click to repair focus. Native compilation passes separately.
The later theme-on-restart failure has its own icon-descriptor repair and does
not invalidate the observed Settings keyboard handoff.

This is separate from the pane-close confirmation incident: the trigger and
close owner are Settings, not the dirty-source close transaction.
