# Notebook verification

Local development verification on 2026-11-08, from
`8b4906e1` with the Notebook changes on `codex/notebook-blocks`.
The App appears in the Workbench. The package and its backend use isolated
test data.

| Check | Evidence |
| --- | --- |
| Formula and workbook | `npm run test:notebook` covers recalculation, named worksheets, errors and cross-sheet cycles, worksheet renaming, lookup and linear regression, relative and absolute fill, XLSX formula source and literal types, and out-of-bounds import. |
| Persistence and Agent writes | The backend test covers immutable SQLite revisions, competing saves, scoped reads, atomic edit batches, and retention of cell units and evidence. It rejects a mismatched Paper reference and changed values in a Control Lab receipt. An isolated installed App also passed through the existing Desktop write adapter and Pero Host. |
| Owner evidence import | The parser tests read exports produced by the actual Paper and Control Lab stores. Paper uses a synthetic PDF. Control Lab uses a deterministic solver fixture. The tests check exact quotes, stored trial and observation identity, check values and digests, and reject altered source data. |
| Browser App | `npm --prefix apps/notebook run test:browser` uses built App files and the real Python backend. It imports and renames a worksheet, verifies dependent formulas still calculate, imports both owner exports, links them to a Finding, saves, reloads and exports. It also verifies stale-draft recovery and immutable history. |
| macOS development Electron | `npm run test:notebook:desktop` opens Notebook via the Workbench, enters and recalculates a formula, saves through the Host, and attaches the saved revision to the shared Chat draft. The light Desktop and narrow dark browser layouts were inspected. |
| Source reopening in Electron | With `PERO_NOTEBOOK_OWNER_FIXTURES=1` and the pinned App dependencies, the test imports owner-generated reports, opens the PDF on page 2 at the selected quote, and opens Control Lab on the exact saved trial. The report and trial IDs match the exported receipt. Both screenshots were inspected. |

The screenshots are local test output in `test-results/notebook/`. The browser
and Electron flows use fixture inputs. Source opening was compiled for Native
GPUI. Live Agent execution, physical validation, packaged distributions, and
running the Native GPUI surface were outside this verification.

## PR 181 completion checks

The completion changes based on `48e9980` were checked on Linux on 2026-11-08.
They add revision-pinned block discovery and complete large-content reads,
strict persisted schema checks, clipboard citation remapping, 1904-date-system
imports, and aggregate error propagation.

- `npm run test:notebook`: 17 package tests, one editor identity test, and nine
  Python tests passed. These include Unicode chunk reconstruction, paginated
  nested block discovery, competing revision reads, refusal of unsupported
  persisted documents without rewriting them, clipboard identity/citation
  preservation, both Excel date systems, and selected formula error values.
  Ordered lists starting at zero or negative values also survive save/reopen;
  dimensions, headings and revisions retain their existing positive bounds.
- `npm --prefix apps/notebook run typecheck` and `npm --prefix apps/notebook run
  build` passed. Notebook no longer builds or bundles the unused Reader runtime.
- `npx tsc -p scripts/ci/tsconfig.core.json` and nine CI/source-navigation tests
  passed. Theme, design, App token, locale and protocol-generation checks passed.
- `bazel run @npm//:sync` regenerated the workspace lock and action cache;
  `bazel test --config=ci //:checks` passed all seven tests with frozen inputs.
- Full `npm run check` requires the generated Reader Wasm module; the icon check
  additionally requires the pinned GPUI Kit source. Neither was present in this
  isolated checkout. Rust/Desktop/Native acceptance was not rerun here.
- Local Chromium could not launch because the runtime disallowed its
  ProcessSingleton socket. The new browser regression is therefore not counted
  as locally passed. It exercises real copy serialization, cross-notebook paste,
  undo/redo, save and reopen, scalar comma pastes without neighboring-cell
  overwrites, and block exports retaining cross-sheet dependencies, with light
  and narrow-dark screenshots.

The `Notebook revisions, workbook and browser contracts` GitHub Actions job now
runs the unit tests, typecheck, standalone build and real backend/browser flow
on every PR, retaining `test-results/notebook/` as a workflow artifact. The
aggregate CI gate requires this job. Consult the PR's exact-head CI results for
remote browser evidence rather than treating the earlier Desktop screenshots
as verification of these completion changes.

## Abstraction follow-up

On 2026-11-08, the follow-up based on `5201bf5` moved shared reference status and
worksheet rename rules into the Notebook package, reused one editor evidence
projection, switched consumers to package exports, and distinguished stored
revision errors from invalid requests. TypeScript and Python now run the same
29 portable snapshot cases, including Unicode, numeric and identifier boundaries.

- `npm run test:notebook`: 21 package tests, two editor tests and ten Python tests
  passed. The new pure rename cases preserve input values and stable IDs, update
  all unambiguous formulas, and reject duplicate or invalid names. The backend
  retains original stored bytes and history after unreadable-revision errors.
- Notebook typecheck and standalone build passed, as did core TypeScript and the
  nine CI/source-navigation checks. Public package imports resolve in the actual
  build, including the new worksheet and spreadsheet-range exports.
  Full root `npm run check` still stops at the absent generated Reader Wasm
  module; the focused Notebook and core checks do not replace that aggregate.
- The browser regression additionally checks that worksheet rename and all of
  its dependent formulas undo/redo together without undoing the preceding cell
  edit. Dark-theme capture now sends the actual App SDK context and asserts the
  applied theme, instead of only emulating the OS preference. The old capture
  did not establish dark-theme rendering. Copied references are captured after
  scrolling them into view. Local Chromium remained blocked at launch by the ProcessSingleton socket
  restriction, before the App loaded. Exact-head CI owns that runtime evidence.
- No new Desktop, Native, packaged distribution, live owner or multiplayer
  acceptance is claimed by this refactor.

## Notebook workspace follow-up

The UI follow-up on 2026-11-09 compares Notebook concepts with the requested
`phodal/benchling-notebook-lab` reference at `8fd07848`. Its source and recorded
browser verification describe document chrome, continuous paper and disclosed
metadata. No published preview was found, and the recorded
`evidence/notebook-desktop.png` is absent at that commit. The reference was not
rerun and no pixel-level match is claimed. No reference source, production CSS or
artwork was copied; implementation uses Pero App SDK components and tokens.

Before-change browser evidence is the `7787ed09` artifact from
[CI run 42537103399](https://github.com/phodal/pero/actions/runs/42537103399/artifacts/13640115778).
The default Notebook surface is now a focused document workspace: save/history
and formatting tools are outside the reading surface, the real notebook list
can be folded, and actual worksheet/reference names replace repeated type
headings. Sheet tools/help and reference replacement are disclosed on demand.
Formulas, imported excerpts/results, citation status, errors and missing sources
remain visible. No new experiment/date model, fake hierarchy or execution state
is introduced; the date shown belongs to the saved revision.

The browser regression exercises edit/read-only exports through the block menu,
Escape focus recovery, worksheet controls, failed replacement-import retention,
collapsed navigation, width bounds and real App SDK dark-theme transitions. It
retains desktop and narrow-screen screenshots plus scrolled scientific-reference
views in light and dark themes. Use the PR's latest exact-head CI and screenshot
artifact for the executed result; source changes alone do not establish visual
or Desktop/Native acceptance.

## Expanded component coverage: current source scope

The 2026-11-09 re-audit covers the expanded PR 181 working tree, not a released
or exact-head browser-accepted build. The pinned reference mapping and remaining
work are in [Notebook component parity](../design/notebook-component-parity.md).
All 94 reference interaction groups remain mapped, including reference stubs;
recovered families are tracked separately rather than counted as working UI.

New source and test scope:

| Capability | Implementation | Relevant test files (not a new run claim) |
| --- | --- | --- |
| Recoverable drafts | `frame.tsx`, `backend/drafts.py` and SQLite store separate debounced recovery drafts from published immutable revisions; corrupt/stale recovery is explicit. | `apps/notebook/test/test_drafts.py` |
| Whole-document history and restoration | `packages/notebook/src/document-history.ts` owns Notes/title/metadata/procedure undo/redo; saved revision restoration creates a draft which explicit Save publishes as a new revision. | `packages/notebook/test/document-history.test.ts`, `apps/notebook/test/document-history-editor.test.ts` |
| Six procedure kinds | `procedure-step-editor.tsx` and `workspace.ts` provide rich step content, table/image insertion, level/reorder/flags, manual completion, planned totals and wall-clock timers. | `apps/notebook/test/procedure-steps.test.ts`, `test_procedure_steps.py`, `packages/notebook/test/workspace.test.ts` |
| Rich content | `code-block.tsx`, `text-tools.tsx`, `reference-mention.tsx` and `raster-edit.tsx` provide language-aware non-executing code, background marks, pinned mentions and bounded derived image edits. | `apps/notebook/test/content-editing.test.ts`, `content-editing-browser.mjs`, `editor-schema.test.ts`, `packages/app-sdk/test/code-editor-language.test.ts` |
| Local sample intake | `sample-intake.tsx` and `backend/sample_intake.py` handle manual/scanner-keyboard/worklist/table/plate input, exact local-catalog resolution, duplicate/ambiguous/truncated results and pinned bindings. | `packages/notebook/test/sample-intake.test.ts`, `apps/notebook/test/test_sample_intake.py` |
| Formula diagnostics | `formula-sandbox.tsx`, `formula-inspection.ts` and `formula-syntax.ts` reuse the worksheet engine for preview, typed results/errors, dependencies, engine tokens, lexical grouping and snapshots. Grouping is not an AST. | `packages/notebook/test/formula-sandbox.test.ts`, `formula-inspection.test.ts` |
| Canvas navigation | `app-canvas.tsx` is mounted by `editor-extensions.ts`, persists a checked binding and calls Host navigation. No inline embedding, cross-App action or execution receipt is claimed. | `packages/notebook/test/app-canvas.test.ts`, `apps/notebook/test/test_app_canvas.py` |
| Host AI proposals | `ai-tools.tsx` uses real Host availability/start/events/cancel, freezes request inputs and routes parsed candidates through review/stale checks. It inserts new literal-text rows, not typed existing-cell autofill. | `packages/notebook/test/ai-generation.test.ts`, `science-review.test.ts`, `apps/notebook/test/science-tools.test.ts` |
| Templates, tables, mixtures and review | Versioned templates/search, local catalog registration/lookup, planned versus recorded mixtures, anchored comments/tasks, fixed-revision local review and comparison have UI/core/backend owners. | `test_templates_search.py`, `test_catalog.py`, `test_mixture.py`, `test_reviews.py`, `review-panel.test.ts`, package domain tests |

UI paths above are under `apps/notebook/ui-src/` unless otherwise qualified.
Unqualified Python/UI test filenames are under `apps/notebook/test/`; unqualified
package test filenames in a package row share its `packages/notebook/test/` root.

**Exact-head browser acceptance is pending.** This documentation audit inspected
source and relevant test definitions; it did not execute the expanded suite.
The browser scenarios `notebook-browser.mjs`, `notebook-components-scenario.mjs`,
`grid-browser-scenario.mjs` and `content-editing-browser.mjs` must pass against the
final integrated build and real temporary backend. jsdom coverage does not prove
Chromium rendering, focus, layout or canvas pixels. Earlier `b358` screenshots
are historical evidence only and do not verify these new controls. Earlier
workspace/Desktop screenshots and passing CI likewise cannot be promoted to
current exact-head acceptance. Record the final commit, test outcome and actual
artifact links once available.

Live configured-model completion/cancellation and Host navigation need actual
owner runtime evidence. Inline Canvas/actions, typed AI autofill/extraction,
collections/source workflows and other remaining capabilities are implementation
work, not automatically external blockers. Multi-user identity, compliant
signatures, remote registry/inventory and physical instrument outcomes require
actual owners and separate acceptance; local records must not claim those events.
