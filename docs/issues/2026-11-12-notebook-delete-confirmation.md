---
kind: issue
status: resolved
date: 2026-11-12
updated: 2026-11-12
---

# Notebook deletion silently stops before sending the request

The notebook list's Delete item calls `window.confirm` before the existing
DELETE endpoint. Workbench App frames intentionally omit `allow-modals`
(`web/src/apps.ts`), so the browser suppresses this native dialog and returns
false. The menu closes without a confirmation or a deletion request.

Replace only this confirmation with the shared SDK Dialog. Show the target's
current title and entry code, focus Cancel initially, retain the target and
show failures inside the dialog so the user can retry. Preserve the existing
backend deletion owner and irreversible-delete warning. Successful deletion
removes the list item and local draft and selects a remaining notebook or
shows the empty library. Do not depend on one React state updater running
before another to choose the next notebook.

## Verification

Based on `c1d8b0d1b` plus this fix, 2026-11-12:

- The new sandbox browser regression fails before the fix: the menu closes,
  but no in-App confirmation appears. It passes after the fix using the built
  frontend and real temporary SQLite backend.
- Cancel and Escape send no DELETE request. Failure keeps the dialog, entry and
  current editor, and retry succeeds. Deleting a selected entry selects another;
  deleting another entry preserves the current selection. Deleting the last
  entry shows the empty library. Reload and backend reads confirm removal.
- Notebook typecheck/build pass on the current workspace, including concurrent
  AI-tool removal changes. The focused backend suite passes 4/4, including
  deletion of all revisions and missing-entry behavior.
- Visually inspected `test-results/notebook/delete-confirm-light.png` and
  `delete-failure-light.png` at 1280 × 900: target title/code, irreversible-delete
  warning, Cancel/Delete and local failure are visible.

Native was observed with the earlier installed UI. This fix has not been
reloaded or exercised in Native, Electron or a signed distribution; the browser
sandbox result does not establish those acceptance levels. No user entry was
removed during verification.
