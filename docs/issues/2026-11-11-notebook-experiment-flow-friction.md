---
kind: incident
status: resolved
date: 2026-11-11
---

# Notebook experiment flow hides required save and rebind transitions

## What failed

A current local browser walkthrough completed a real PI experiment and cited its independent verification trial in a saved Finding, but two transitions exposed confusing recovery states:

1. Saving a new Canvas binding immediately mounts it against the prior saved revision. The view shows `Error: Error: App refused the scoped request (400 Bad Request)`. Saving the Notebook revision resolves the error, but the error does not identify that action.
2. Changing a pinned table input correctly invalidates the procedure parameter and removes experiment creation. Canvas asks for rebinding, yet its parameter selector contains only `—`, Save binding is disabled, and it offers no route to the stale procedure parameter. The user must discover View → Procedures and rebind there first.

Additionally, the procedure field selector puts a row UUID before the column/value. At 440px two different fields in the same row display indistinguishable truncated labels.

## Why

`AppCanvasView` immediately renders `DeclaredAppCanvas` after changing the draft binding while its context revision still names the prior saved revision. Host/Notebook saved-source admission correctly rejects the mismatch. The helper text describing this requirement is in block help, not beside the failure.

`controlParameterOptions` excludes stale/unresolvable procedure parameters, leaving no sample choice. Canvas can explain its own binding invalidation but does not direct the user to the upstream stale table pin.

`procedure-parameters.tsx` constructs field labels as table name, row ID, column name and raw value. The bounded selector truncates the useful distinguishing suffix.

## Scope and evidence

Source head `7c6f02f0`; rebuilt Notebook and Control Lab App bundles; existing real Rust debug Host and isolated SQLite data; actual in-app browser UI. Trusted-shell approval was test-driven. Desktop deep links and approval sheets were not assessed.

Full walkthrough, priorities, screenshots and preserved Notebook/Control exports: [audit report](../../test-results/notebook-flow-audit-2026-11-11/README.md). The completed chain is saved in revision 8; revision 9 restores the input after a supplementary stale-input probe. The original verification snapshot and Finding were retained correctly.

## Repair and validation

Verified product source: `6ad36911`, with four separate implementation commits.

- Draft Canvas bindings wait for their matching saved document. An inline Save revision action enables the view; no speculative mount produces the previous 400.
- Stale table-backed parameters retain their name and offer Review directly to the existing procedure parameter. After explicit repinning, the researcher applies a new Canvas binding and saves its revision. Old evidence is not rewritten.
- Owner projections can return up to eight inert selectable results within the existing 64 KiB read limit. Control Lab supplies bounded completed verification receipts, with the same snapshot numbers and export hash as its existing export. Notebook validates the selected source/trial/report identity and inserts an ordinary Experiment reference in editor history. No file handling or new execution permission is involved.
- Field options show column/value first and table/row display context underneath. Raw source identifiers are available in parameter details. The UI pass removed duplicate explanation paragraphs and stacked validation messages; the existing actions and field states communicate the next step.

Rebuilt Notebook, Control Lab and the real Rust Host. Ran the complete blank-entry → table → pinned parameters → experiment → actual search/verification → direct snapshot → cited Finding flow at 8 s / 1001 samples. After the copy review, replayed the authored setup on the final bundles, changed to 2001 samples, followed Review Samples, repinned, saved and executed the new specification. Both independent verification runs passed all eight checks. Final revision 5 retained its evidence and Finding after reload, with no browser errors. Both directly attached snapshots matched `readControlEvidence` of the real owner export exactly.

Evidence: `test-results/notebook-flow-fixed-2026-11-11/` (blank-entry run and narrow field picker); `test-results/notebook-flow-final-ui-2026-11-11/` (final concise UI, recovery and second complete execution). Final ledger: `verification.json`; importable document: `notebook-final.json`.

Checks: root `npm run check`, Notebook and App SDK typechecks, App builds, 149 Notebook package tests, focused SDK/Notebook UI checks and two Host Canvas unit tests passed. Notebook Python: 121 tests, three skips; Control Lab Python: 54 tests, one skip. The final serial editor suite passed 82/83: the scoped-keyboard assertion also fails on clean baseline `7c6f02f0`. An earlier parallel pass exposed a formula-completion assertion also reproduced on baseline, and intermittent document-history teardown activity; the final serial run had neither failure.

The browser run used isolated SQLite data and test-driven trusted-shell approval. Electron/Native approval sheets, packaged releases, deep-link navigation and physical hardware were outside this verification. The updated `notebook-control-canvas.mjs` regression uses direct attachment and compares it with the integrity-checked export; actual browser acceptance in this session used the in-app browser.
