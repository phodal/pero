---
kind: issue
status: resolved
github_issue: 118
github_state: closed
github_url: https://github.com/phodal/pero/issues/118
---

# Text import from search preview saves without opening the new paper

Maintainer scope confirmation: [welcome to PR](https://github.com/phodal/pero/issues/118#issuecomment-6602609930).
The fix targets `master@5a092c8e7e10570b6564ea887874856d4b266462`.
Merged in [PR #122](https://github.com/phodal/pero/pull/122) as `399d2c35`.
Issue #118 was closed on 2026-11-03.

## Reproduction

Reproduced twice on unchanged `master@d608a49dc73a96e4d683e885425dc3088068da16`
on 2026-11-03. The rebuilt Paper App runs in a macOS browser preview against
the actual Python backend and a fresh, isolated persistent data directory.
Only synthetic text and example.org metadata URLs are used; no provider,
model, source download or research execution is involved.

1. From Library, choose Add papers -> Import text. Save title `Preview alpha`,
   URL `https://example.org/preview-alpha`, Full text, with this content:

   ```text
   # Alpha
   previewalpha is the saved source.
   ```

2. Back to library. Search `previewalpha` and open the `Preview alpha` hit.
   Search results and the highlighted original are now shown side by side.
3. In the search pane, choose Add papers -> Import text. Save title
   `Preview beta`, URL `https://example.org/preview-beta`, Full text:

   ```text
   # Beta
   previewbeta is the newly imported source.
   ```

Actual: the import request succeeds and GET /api/library contains Preview beta,
but the import form stays open beside Preview alpha. The save button returns
to enabled; neither the new original nor a success confirmation appears.
Repeating with Preview delta has the same result.

Control: leave the preview using the reader's Back to library, choose Add papers,
and save Regular gamma. Its original opens immediately. No backend change is
needed to distinguish the two paths.

Expected: entering Add papers from search preview should activate a usable
import screen, and completing text import should have the same successful
opening behavior as the ordinary library path.

## Cause

In `ui-src/index.tsx`, the Add papers action changes only `libraryScreen`.
Search preview retains `screen === 'reading'` and `hitPreview === true`, which
keeps the library/import pane visible. However, ImportPanel's active prop
requires `screen === 'library'` as well as `libraryScreen === 'import'`.
`ui-src/library.tsx` passes that false activity flag to `onAdded`, so the
parent refreshes saved data but skips `read(paper)`.

This is a visible-panel/activity mismatch, not a failed save or lost document.
Research URL draft polling also uses the same active flag; that consequence
is source-derived and has not been claimed as a live network reproduction.

## Scope and fix

Reviewed open and closed GitHub issues/PRs, local incident records, #68, #79,
#101, #114 and the current #115 changes. Searches include search preview,
hitPreview, import + active and Add papers. No matching report was found.
#115 is merged. Its reader navigation work is now in draft #121, which does
not change the import activity mismatch. Both touch the parent component;
the import fix does not depend on the reader/PDF repair.

Entering the importer uses the existing return-to-library transition to clear
the search preview and activate the import screen. All import entry points
share that transition. Successful imports open the new saved original.

ImportPanel supplies a live activity predicate to `added`, which evaluates it
after refreshing the library. Leaving the importer during either the save or
the refresh keeps the user's navigation and still retains the saved paper.
The existing parent mounted/App-active checks remain in effect.

`tests/e2e/paper-import-flow.mjs` is part of `npm run test:paper`. It covers
ordinary import, import from a search hit, the actual saved paper ID/text,
and leaving during save delivery or library refresh. Deferred responses hold
real backend results; they do not replace persistence or use timed sleeps.

## Evidence and boundary

Learning workspace evidence outside the contribution tree:

- `evidence/paper-fourth/preview-import-repeat.png` and matching UI text:
  save complete, new title in the form, previous paper in the reader.
- `evidence/paper-fourth/regular-import-opens.png`: normal-path control.
- `evidence/paper-fourth/library-after-repeat.json`: actual persisted IDs.
- `lab-fourth/preview.log`: real import and library request sequence.

## Verification

- Paper App TypeScript and App bundle build passed; existing Reader assets
  were reused for the build.
- The new flow fails on the unchanged baseline at the still-visible reader
  after Add papers. It passes with the fix using the built App in an Electron
  iframe and the real Python backend with isolated persistent data.
- Ordinary import, preview import, leaving during save and leaving during
  refresh all pass; the new original's saved ID and text are asserted.
- Light 1280px and dark 760px import/reader screenshots inspected; keyboard
  activation works and neither state has horizontal document overflow.
- Library availability tests: 3 passed. Manual evidence tests: 5 passed.
- Reader, document reopen and refresh component tests: 29 passed.
- Independent core TypeScript check passed.
- Theme, design, locale and generated contract checks passed.

The focused local runner replaces only Desktop static serving/transport and
Host context. This is not a full `npm run test:paper` Rust Host/Desktop pass.
The root `npm run check` cannot complete in this checkout because generated
`web/src/reader-wasm/pero_reader_web` is absent; no stub was substituted.
No model or external source service was exercised.

## Reopened importer follow-up

The [review finding](https://github.com/phodal/pero/pull/122#discussion_r4454318687)
identifies a further no-focus-stealing case: leave Add papers during a save
or refresh, reopen it and edit another draft before the response arrives.
On merged `master@399d2c35`, the old response opens its paper because activity
is true again. The deferred-response regression reproduces this with the real
Python backend; the previous saved document replaces the reopened import form.

Each import now captures its importer session before saving. Losing activity
or unmounting invalidates that session, so reentering cannot authorize a
previous visit's navigation. Saved data still refreshes, the new draft stays
visible and editable, and saving that draft opens its own original.

The existing import flow covers both leaving and leaving/reopening during
save delivery and library refresh. It asserts that the old document persists,
the current draft remains intact, and a subsequent save opens correctly.
All six navigation scenarios pass in the focused Electron/real-backend runner.
Paper and independent core typechecks, 32 reader component tests, 3 library
availability tests and 5 manual evidence tests pass. Light/dark, narrow layout
and keyboard import checks also pass. Full Rust Host/Desktop acceptance was
not rerun locally for this follow-up.

For the already-merged #122 head `6b1725eb`, both
[Linux CI](https://github.com/phodal/pero/actions/runs/41645057412) and
[full-platform CI](https://github.com/phodal/pero/actions/runs/41645057070)
passed, including `paper-reading` and `paper-research-import` Desktop acceptance.
Those results cover #122, not this follow-up.
