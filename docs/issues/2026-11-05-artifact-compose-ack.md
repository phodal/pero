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

## PR #135 review corrections

The first admission check omitted the final message length, and its unique-ID
attachment budget differed from the outgoing token-derived list. A 70,000-character
quotation could report success but could not be sent. Adding A (70 KB), B (1 byte),
then A again admitted 70,001 bytes but sent 140,001 bytes after clearing the draft.

Composer now uses one unique-ID projection for tokens, admission and submission,
and shares the complete 64,000-character budget with Host. Invalid submission
reports an error without clearing the draft. Native-feature Chat tests cover
nonadjacent repeated IDs, the 16-reference boundary, existing text plus selection
and token-label overflow, replacement and Unicode character counts.

The same review fixed related delivery and presentation defects:

- Product Chat now forwards successful `artifact_context` receipts.
- Gallery file navigation only handles events from artifact options and respects
  handled events, leaving chart arrows and axis selectors with their controls.
- Sessions separator arrows start at the actual displayed width in a narrow
  window, preserving the saved preference when the separator cannot move.
- Artifact file import rejects nonregular paths, opens Unix files with
  `O_NONBLOCK`, and checks the opened descriptor. A regular path replaced by a
  FIFO after the path check therefore cannot block the Host command loop.
  The regression covers both an initial FIFO and replacement after admission.
- The artifact view no longer creates an unrendered duplicate ContentReader,
  its subscription or its copied document. The shared Viewer and chart remain.

These fixes were integrated with master `951fb071`, retaining upstream session
history, user questions and Windows support. On the stable integrated code,
Native-feature Chat unit tests passed 25/25, default Rust library tests passed
258 with one ignored, the full `npm test` Rust suite passed 336 with one ignored,
Desktop tests passed 36/36, and the real Host/MCP fixture
acceptance passed. Full Wasm build and `npm run check` passed. The Viewer DOM
regression passed against the actual components; full Chromium acceptance was
blocked before browser startup by the execution environment's Unix-socket policy.
See the current verification section in `docs/fitness/session-artifacts.md`.

The integrated CI also exposed stale Host stdio fixture expectations: they omitted
the new `sessions_width` and `artifact_view` fields from strict preference
comparisons. The fixture now checks default migration (`280`, `icons`), explicit
`360`/`gallery` persistence across restart, and rejection of out-of-range widths
or unknown views without replacing saved settings. No assertion was relaxed.
