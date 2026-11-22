---
kind: issue
status: resolved
date: 2026-11-22
updated: 2026-11-22
---

# Notebook App Canvas block menu dismisses immediately in Native

In the macOS Native Preview, open a Notebook with a live Automations App Canvas.
Click the canvas header's Block actions button. The menu flashes and the live
App reappears, leaving the canvas commands inaccessible.

The menu should stay open until a command or normal dismissal, then restore
the live App with its current state.

## Repair and verification

Opening the Notebook menu occludes the Automations WebView. GPUI Kit's hide
operation transferred the window's first responder to the native parent even
when the Notebook WebView already held focus. The focus leaving Notebook
dismissed the menu and brought Automations back. The macOS patch transfers
focus only when the hidden WebView contains the first responder.

On macOS 27.2.1, using `31a70c5c4` plus this change, the same isolated profile
and installed Notebook and Automations assets reproduced the failure before the
fix and passed with the rebuilt Native binary. The menu stayed visible and
uncropped in the Chinese light-theme window. Escape returned focus to Block
actions. Clicking outside also dismissed the menu. Clicking Collapse and then
using Down and Enter to expand showed the same Automations calendar selection.
The Native build and Kit patch-cache test passed. Signed distributions and
other operating systems were outside this check.
