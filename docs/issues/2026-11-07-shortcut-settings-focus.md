---
kind: incident
status: resolved
date: 2026-11-07
---

# Native shortcut settings initially selected Appearance

During real macOS Native verification, Cmd+/ opened Settings but displayed
Appearance instead of Keyboard shortcuts. The new panel's initial tree render
queued a selection notification before the Workbench attached the requested
section. That old selection subsequently overwrote the requested section.

`SettingsPanel::select` now updates the observed tree selection together with
the selected section. Repeating first-open Cmd+/ and opening it from the
Scientific Viewer WebView both displayed Keyboard shortcuts in the real Native
window. Recording Cmd+Shift+N, saving and restoring Cmd+N also succeeded.

Saving removed the editor's focus target, so the acknowledged save now asks the
Settings render to restore its search focus. This uses the existing focus path.
See the [verification record](../fitness/keyboard-shortcuts.md) for evidence and
remaining surface/platform limits. No external GitHub issue was opened.
