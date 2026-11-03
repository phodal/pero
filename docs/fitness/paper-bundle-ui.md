---
kind: verification_report
date: 2026-11-03
---

# Paper resource details UI

The resource page now uses the paper title once, followed by compact resource
rows with their version, current availability and action. Approved PDF/source
resources are rendered by their existing acquisition components rather than
being repeated in a reference list. Source discovery warnings remain in the
historical discovery record; successful byte acquisition supplies the current
state. A failed status query displays “状态未确认”, and missing local bytes never
appear as downloaded.

Source files open in the SDK Dialog with the existing resizable Split. PDF
comparison, evidence reports, original URLs, exact hashes and parser limitations
remain accessible through disclosures. Main page, download and report controls
use the App locale. Raw provenance and backend diagnostics retain their original
content. Download approval, queues, cache paths and evidence owners are unchanged.

## Captured journey

1. **Open resources — pass.** Captured the original duplicate headings and
   conflicting discovery/download statuses, then verified one title and one row
   for each representation. The actual approved arXiv 2610.27435v1 archive still
   contains 12 files, including one TeX member, and reports 7.4 MiB.
2. **Inspect source — pass.** Opened the real `rsi_harness.tex`, read lines 1–95,
   and checked desktop and 490×840 layouts. At 490px the page width/scroll width
   are both 490px, and dialog width/scroll width are both 454px. The file panes
   stack without a horizontal separator. Escape closes the dialog and returns
   focus to its trigger. Native Preview also opens and dismisses the dialog.
3. **Recover availability — pass in explicit UI fixtures.** Checked query
   failure, refresh recovery to the real available source, missing local bytes,
   not-started, failed and running states. Appropriate refresh, restore,
   download, retry and cancel controls remain visible. Fixture request traces
   contain only status requests; no automatic download or restore was started.
4. **Read and report — pass.** The read action opens the corresponding saved
   source snapshot, retaining its abstract limitation. Created a report from the
   exact source-line observation in an isolated data copy; its saved result
   preserves the unresolved-interpretation notice. No user report was changed.

Screenshots and fixture traces are in `test-results/paper-bundle-ui/`: original
`01-before.png`, dark `02-after-dark.png`, source `03-source-dialog-dark.png`,
narrow `04-narrow.png`, light `05-after-light.png`, error/missing `06`/`07`,
Native `08-native-light.png` and `09-native-source-dialog.png`, narrow dialog
`10-narrow-dialog.png`, and report result `12-report-saved.png`.

TypeScript checking, the Paper App build, `git diff --check`, and the three
existing library availability/approval-scope checks pass. Browser checks used
the actual App build and Python backend against a temporary copy of saved data;
error/availability variants were explicitly simulated by the preview adapter.
Native verification used an isolated profile and the real Host. This is local
macOS verification, not full Electron, accessibility or cross-platform acceptance.
No new experiment, TeX compilation, network acquisition or HTML/PDF alignment
claim is made by this UI change.
