---
kind: analysis
status: open
---

# Floating workspace quick-launch panel (design reference)

## What

pero has no persistent, draggable floating entry point for spinning up a
terminal, a scratch Markdown note, or a browser tab without going through the
main workspace chrome. Competing product BioBase (Electron, bundle id
`bio.infera.biobase`, internal naming still `orca`) ships one in the bottom
right corner: a small round toggle button that expands into a resizable
"floating workspace" panel.

Observed behavior from its unpacked `app.asar`
(`out-biobase/renderer/assets/floating-terminal-panel-view-state-*.js`,
`FloatingTerminalPanel-*.js`, `FloatingTerminalIconContextMenu-*.js`):

- 36x36 toggle button, default anchored bottom-right (24px/72px gaps),
  draggable with a 4px move threshold, snaps to the nearest viewport corner
  on release, position persisted to `localStorage` as anchor+offset (not
  absolute pixels) so it survives window resizes.
- Unread-activity dot on the toggle when the panel has new content.
  Right-click gives "Move to Status Bar" / "Hide Floating Workspace".
- Expanded panel has its own min/maximize controls and edge/corner resize
  handles, bounds also persisted and reconciled against viewport.
- Empty state offers five actions, each with a global shortcut hint: New
  Terminal, New Markdown Note, Open Markdown Note, New Browser, Minimize.
- Once populated, it becomes a small multi-tab workspace (terminal / markdown
  editor with dirty-file + unsaved-changes dialog / browser tab) backed by the
  same app-wide tab store as the main window, not a separate state tree.

## Why this matters for pero

Not a decision yet — captured as a reference so the UX/placement tradeoffs
(separate floating window state vs. reusing the existing pane/tab model,
anchor-based persistence, shortcut surface) can be considered later against
pero's own workspace/pane architecture before any design is proposed.

## Next step

No action planned yet. Revisit when there's a concrete proposal for what a
pero equivalent (if any) should do and how it maps onto the existing
pane/workspace model instead of introducing a parallel one.
