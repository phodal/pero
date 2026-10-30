---
kind: incident
status: resolved
---

# Cancelling pane close can leave its next keyboard close ineffective

## What

In actual background Electron on macOS arm64, open two dirty files in one pane.
Close the pane, save the first file, then cancel at the second file. Both tabs
remain and the second draft stays dirty, as intended. Pressing Cmd-Shift-W again
does not open the next save confirmation: `pendingClose` stays null.

The fresh release-Wasm source snapshot is `pero-content-release-f8ITjl`.
`tests/e2e/workspace-close.mjs:35` reproduces the failure. Captures and state are
in that snapshot's `test-results/workspace-close/failure.png` and `failure.json`;
the invocation log is `test-results/content-reader/close-gate.log`.
Earlier clone-close, last-view Save/Cancel and closed-item reopen checks reached
this step successfully. Neither file content was lost.

## Why

Kit deferred dialog teardown for 250 ms and then restored the previous focus
handle. During Save followed by a second prompt that handle could belong to the
dialog that had just closed. Its later restoration displaced the editor focus.
Commit `96b4318` closes this prompt synchronously and returns false from Kit's
default close callbacks. Save, Don't Save and Cancel share one handler that
restores the active editor/workspace focus before applying the close decision.

## Actual verification

On the fresh `pero-content-release-T4HKhB` release-Wasm build, the real background
Electron suite repeats Cmd-Shift-W immediately after Escape/Cancel without an
extra click, saves the remaining source, and observes the Host acknowledgement
before tabs close. All six close workflows pass. The separate actual OS window
close/reload suite also passes Save/Cancel, acknowledged restart, Don't Save with
external disk changes, and conflict preservation. Receipts are copied to
`test-results/workspace-close/` and `test-results/workspace-window-close/`.

Failure cleanup destroys only the disposable test's windows and is not counted
as evidence for the close behavior. Physical native OS-panel/IME and installed
package acceptance remain separate.
