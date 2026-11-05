---
kind: local_issue
status: resolved
date: 2026-11-05
---

# Artifact preview reported insertion before Composer admission

The Viewer received a successful compose acknowledgement when Host returned an
artifact context and Chat queued its insertion. Composer had not yet checked
the complete attachment set or the active Agent's image capability. A valid
individual snapshot could therefore display “Added to prompt” even when the
actual insertion was refused. The existing limits must remain in force.

The acknowledgement must follow actual Composer admission. A refused insertion
must keep the draft unchanged and return the same visible rejection to Viewer.
The fix uses the existing pending insertion and reply path; it does not retry a
delivery or create another task or execution state machine.

Resolved by admitting the complete proposed ComposerDraft before UI edits and
replying after actual application. The existing edit/undo APIs remain in use.
Surface requests report failure only in Viewer; manual artifact insertion uses
the outer artifact error, and ordinary Composer insertion uses its global error.

The shared Chat unit suite passes 23 cases, including aggregate 70KB + 70KB
rejection, unsupported images, and unchanged original draft on rejection.
Actual isolated Native/Host testing imported two 70,000-byte Markdown snapshots:
quoting B while A was attached returned one Viewer error and left the draft
unchanged. Removing A and retrying inserted the selected text and exact B v1
reference, cleared the error and returned success. Screenshots are
`test-results/session-artifact-finder-native/capacity-rejected-final.png` and
`capacity-recovered-final.png`; tested binary identities are in
`binaries-accepted.json`. See `docs/fitness/session-artifacts.md` for scope.
No GitHub issue was created.
