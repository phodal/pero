---
kind: issue
status: resolved
date: 2026-11-11
---

# Notebook UI hides everyday actions and overexposes setup details

The current browser audit at `b1b95293` found nine related usability problems:
invisible draft persistence status, clipped narrow title/status, oversized Insert
menus, hidden view navigation, premature input-table validation, technical evidence
entry, procedure setup preceding steps, mixed notebook-library/property ownership,
and tool emphasis disconnected from everyday work.

The changes keep the existing document, draft, revision, evidence and Host owners.
Shared SDK controls remain the interaction owners. Draft storage and explicit
revisions must remain distinct; existing scientific snapshots must remain fixed.

## Repair and migration

- Replace the clipped status and bottom-only save icon with visible persistence
  feedback and a named revision action. Expose core view tabs and current view.
- Preserve author popup sizing while the shared Popover clamps to the viewport;
  group Notebook insertion by task and retain mounted dialog state.
- Reflow titles and status at narrow widths, retaining long editable titles.
- Show neutral incomplete input drafts, reserve errors for invalid supplied values,
  and distinguish input tables from catalog registration.
- Put procedure steps before optional setup; keep meaningful existing data visible.
- Search notebooks in their navigation; separate current-entry properties and
  provenance from the notebook library.
- Select real fixed sources from saved notebooks, retaining file import and manual
  reference entry. Do not introduce cross-App permissions or invented evidence.

## Verification

Implementation: `2dbb72f8`, `290ee078`, `0399c488`, `2f7c30b4`, `7e2a2151`.

- `npm --prefix apps/notebook run typecheck`, Notebook build, SDK typecheck,
  and root `npm run check`: passed.
- All Notebook editor tests: **109/109 passed**, with the Python dependencies
  declared in `apps/notebook/app.json` installed in an isolated temporary venv.
- Shared Popover tests: **8/8 passed**. Notebook reference-control tests: **4/4 passed**.
- Updated regression selectors for the multiline title, visible tabs, disclosed
  step insertion and Properties. Corrected the stale Ctrl+Shift+S expectation:
  the existing command owner deliberately leaves this key unhandled; its code
  is unchanged from `b1b95293`.

The real built Notebook frontend and Python backend ran with isolated temporary
SQLite data. CUA browser checks covered:

1. A long Chinese title at 440 × 900 wraps completely; title, entry ID, status
   and Save revision remain readable. Desktop was checked at 1280 × 900.
2. Draft storage feedback is visible; Save revision produces a new revision and
   disables after success; reload retains table cells, evidence and procedure text.
3. Insert and More blocks stay at 280px width (expanded menu 560px high), rather
   than filling most of the viewport. Core tabs remain directly accessible.
4. An empty input table has neutral guidance. Visiting and leaving an empty
   required cell shows its error; valid input removes it. Registration gates
   still use all domain validation issues.
5. Saved-evidence selection previews a real saved revision and requires Attach.
   API comparison after revision 4 confirmed exact source/snapshot equality with
   the source notebook's revision 1, which remained unchanged. The component
   test covers both Paper snapshots and Control receipts, excluding unpinned ones.
6. New procedures expose Add step before introduction, parameters and materials.
   Optional formatting and image/table tools remain available through disclosure.
7. Sidebar search filters entries while retaining the current editor. Properties
   contains current-entry labels and disclosed provenance, without another library.
8. English/light and Chinese/dark rendering were visually inspected. The empty
   body prompt and direct Templates action were checked during initial editing.

Screenshots (local artifacts, not repository binaries):
`/Users/phodal/.codex/visualizations/2026/11/11/01a1ca08-09d0-7da3-a2fa-adeedd24cf8b/notebook-fixes/`:
`notebook-light.png`, `notebook-dark-zh.png`, `narrow-dark-zh.png`,
`insert-menu.png`, `saved-snapshot-picker.png`, `procedure-steps.png`,
`properties.png`. The first `narrow-title.png` precedes the final sidebar-height
adjustment. The original audit is in the adjacent `notebook-audit` directory;
these are workflow verification shots, not identical-data pixel comparisons.

Scope: browser frontend and isolated backend only. Packaged Pero Electron,
Native embedding, actual Host project association and cross-App opening were not
retested. Saved snapshot selection is explicitly scoped to Notebook revisions;
JSON import remains available for external reports. No scientific acceptance is
implied. One console exception during iframe theme verification was traced to the
browser's injected Electron preload, not a Notebook source script.

## CI follow-up: migrated navigation and nested dialogs

Runs [43003026881](https://github.com/phodal/pero/actions/runs/43003026881)
and [43007150844](https://github.com/phodal/pero/actions/runs/43007150844)
failed at the same two assertions: the shortcut test assumed Ctrl+Shift+S was
unhandled by every editor, and the browser test searched for View in the old
command row. On Linux, Tiptap legitimately handles Mod+Shift+S as strikethrough.
The test must verify the native edit and absence of a Notebook export, on both
Mac and Linux. Navigation now exposes five tabs and retains View in the workspace
navigation row; the browser contract must check that actual arrangement.
Later in the journey, the Properties label fields have native datalists and
therefore combobox semantics, not a fixed textbox role. Select them by their
associated labels while preserving save, reload and exact metadata assertions.

Continuing the full browser journey then exposed a real nested-dialog defect:
Insert → source excerpt → Source attachment rendered the Select list in the
outer Popover, behind the native modal. The shared popup-container resolver
preferred an ancestor popup marker even when a closer open dialog owned the
trigger. Preserve explicit containers and popup containers inside dialogs, but
keep a dialog's controls above an enclosing menu. The affected real consumer is
the source-excerpt composer; its existing pointer-selection and retained-source
checks are the browser regression path. Test-alignment commit: `ff19e977`.

Verification on base `68c62816` plus this repair, macOS, Node 26.8.1,
Python 3.12.11 and real Chromium with isolated SQLite:

- `NOTEBOOK_REAL_OCR=1 npm run test:notebook`: 269 core and 110 editor tests
  passed; Python ran 151 tests, 150 passed and the Linux-only virtual-address
  limit case skipped. Real image/PDF OCR and limited-parser OCR passed.
- `npm --prefix apps/notebook run test:browser`: 7/7 passed, including all 15
  follow-on scenarios in the workbook journey. No forced clicks or skipped
  assertions. Source attachment selection uses a real pointer click, then
  checks exact text/hash, published revisions and retained download bytes.
- Shared Select, Popover and Dialog: 22/22 passed. The existing portal table
  now covers a dialog inside a popup and a popup inside a dialog; explicit
  container, Escape and focus behavior remain covered.
- Packaged parser/citation tests: 2/2; installed App/Canvas owner tests: 21/21.
- Notebook build, Notebook typecheck and SDK typecheck passed.

Local logs: `/Users/phodal/workspaces/pero-notebook-ci-430030/test-results/ci-notebook/`
(`notebook-tests.log`, `fixed-browser.log`, `popup-tests.log`,
`packaged-parser-tests.log`, `owner-tests.log`, `build.log`, `typecheck.log`,
`sdk-typecheck.log`). Browser artifacts remain in the sibling `notebook/`
directory. Visually inspected `copied-notebook.png`,
`source-excerpt-picker-light.png`, `source-excerpt-light.png`, and
`source-excerpt-retained-narrow-dark.png`; the picker is visible above the modal
and the saved/retained excerpt is readable in both themes. The failure screenshot
is retained as `ci-notebook/baseline-source-excerpt.png`.

The shortcut cases explicitly set Mac/Linux navigator platforms within the test;
this is not a Linux OS run. Latest Linux CI must run after integration. No
Electron, Native, paid model or scientific acceptance was performed here.

## Follow-up: reduce persistent controls

User feedback: the interface remains cluttered and exposes too many operations.
The first repair fixed individual access/layout defects but did not sufficiently
reduce visual density. A fresh browser capture at 440px found 31 visible editor
chrome controls and the title beginning at y=458px. Normal procedure steps expose
structural editing controls alongside execution. Evidence and table metadata
precede their main content.

Continue with progressive disclosure: keep insertion/save/content access direct;
make formatting, library administration and step settings explicit optional tools;
move table configuration after its data; consolidate evidence provenance and move
snapshot replacement into block actions. Preserve all data, warnings, keyboard
commands and active step properties. Table view selection and active filters stay
directly accessible; schema and new-column configuration sit below the data.

Verification on the archive integration branch, macOS with the declared Python
dependencies: Notebook typecheck/build, 110 editor tests and all 7 browser suites
passed. Existing browser journeys now open Format, File → Properties, reference
Block actions and Step settings through their visible controls; persistence, exact
snapshots, printing, procedure kinds and nested dialogs retain their assertions.
Visually inspected the current light desktop, narrow dark document and dark
Properties dialog in `test-results/notebook/{copied-notebook.png,
copied-notebook-narrow-dark.png,notebook-home-narrow-dark.png}`. Packaged Electron
and Native embedding were not retested.
