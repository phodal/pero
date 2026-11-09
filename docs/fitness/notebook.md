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

## Expanded checkpoint coverage: source scope

The first 2026-11-09 re-audit covers the expanded PR 181 checkpoint, not a released
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

**Checkpoint browser acceptance was pending at this audit.** This documentation audit inspected
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

## Wave 2 source integration and current acceptance boundary

This section supersedes the earlier checkpoint's capability limitations where
explicitly noted. Base checkpoint: `9f9b247f` (expanded baseline plus CI repairs). The following
wave 2 work was frozen separately from in-progress Canvas and review workflows
for validation. Integrated exact-head browser acceptance remains pending.

| Wave 2 capability | Concrete source owner | Relevant tests / scenarios |
| --- | --- | --- |
| Template organization and table workflows | `template-collections.tsx`, `table-workflows.tsx`, `table-source.tsx`, `catalog-archive.tsx`; Python collection/workflow/archive modules own SQLite revisioned organization, view definitions, mappings/resync receipts and archive events. | `test_table_workflows.py`, `table-workflow-tools.test.ts`, `packages/notebook/test/table-workflows.test.ts`, `table-workflow-browser-scenario.mjs` |
| Scientific designs | `plate-design-library.tsx`, `scientific-content.tsx`, `molecular-graph.tsx`, `backend/scientific_designs.py`, `packages/notebook/src/scientific-designs.ts`: immutable plate metadata/layout designs and structural molecular/reaction records, edit/revise, chemical extraction and MOL export. | `test_scientific_designs.py`, `scientific-content.test.ts`, `packages/notebook/test/scientific-designs.test.ts`, `scientific-content-scenario.mjs` |
| Typed AI sources and recovery | `ai-tools.tsx`, `ai-cell-review.tsx`, `ai-history.tsx`, `ai-recovery.ts`, `backend/ai_proposals.py`; package `ai-proposals.ts`, `ai-sources.ts`, `ai-recovery.ts`: explicit bounded UTF-8 source selection, per-cell decisions, revision/draft/protected-value checks, durable requests/proposals and application recovery. | `ai-tools.test.ts`, `test_ai_proposals.py`, `packages/notebook/test/ai-proposals.test.ts`, `packages/notebook/test/ai-generation.test.ts` |
| Diagnostics and sample propagation | `editor-diagnostics.ts`, mounted `editor-inspector.tsx`, `sample-catalog.tsx`, `sample-propagation.tsx`, `sample-intake.tsx`: real selection/paste/HTML observations, current schema/contracts, measured view-update duration; local catalog box grouping, worklist export and staged binding application. | `editor-diagnostics.test.ts`, `sample-intake-ui.test.ts`, `test_sample_intake.py`, `diagnostics-intake-browser-scenario.mjs` |
| Source excerpts | `source-excerpt.tsx`, `backend/source_excerpt.py`, `packages/notebook/src/source-excerpt.ts`: exact retained UTF-8 source/quote/range/digest, attachment pin, edit, download and reveal, with stale-source checks. | `test_source_excerpt.py`, `source-excerpt-ui.test.ts`, `packages/notebook/test/source-excerpt.test.ts`, `source-excerpt-browser-scenario.mjs` |
| Rich procedure relationships | `procedure-materials.tsx`, `procedure-step-editor.tsx`, `workspace-views.tsx`, package/Python workspace domains: rich introduction/material notes, nested materials, pinned local catalog picker, procedure/step/material deep links and well-grid insertion. | `procedure-workspace.test.ts`, `test_procedure_workspace.py`, `procedure-steps.test.ts`, `test_procedure_steps.py`, `procedure-workspace-browser-scenario.mjs` |
| Canvas discovery | `app-canvas.tsx`, package Canvas domain and App SDK installed-view listing: actual installation declarations, enabled/missing/stale/cancel states and owner navigation. | `app-canvas.test.ts`, `test_app_canvas.py`, `packages/notebook/test/app-canvas.test.ts` |

UI/test shorthand follows the preceding section. Test files identify coverage
intent, not a claim that every scenario passed or that private reference code
was reused. Chemical validation is structural, not chemical safety, valence,
stereo, aromaticity or reaction balancing. AI/excerpt input support is bounded
UTF-8 text, not PDF/image/Office/OCR. Catalog records/propagation are not physical
inventory operations. Canvas inline Data embedding/actions are still in progress. Direct grid
resize/reorder and a bounded formula source AST are now implemented; the source
AST is not an internal evaluator AST and unsupported constructs fail explicitly.

Current runtime evidence (2026-11-09):

- Frozen wave 2: `npm run test:notebook` passed 107 package tests, 53 editor
  tests and 78 Python tests. Notebook typecheck/build, generated protocol and
  locale checks passed. Six SDK/desktop installed-view catalog tests passed.
- [Base CI run 42549907982](https://github.com/phodal/pero/actions/runs/42549907982)
  passed the main real-backend Notebook browser scenario, including component
  workflows. Its separate content-editing scenario exposed raster crop-edge
  interpolation bleeding outside the selected crop; that fix is tracked
  separately. This is **not a full browser pass**.
- The run's actual procedure desktop-light, retained-revision dark and review
  narrow-dark screenshots were inspected. Their layout fit the captured views.
  This evidence verifies only the base checkpoint, not wave 2 or future work.
- Integrated wave 2 Chromium/backend scenarios, final artifacts, print,
  Desktop/Native execution and configured live-model execution remain pending.
  Local Chromium remains blocked by the established socket restriction; no
  repeated launch or restriction bypass was attempted.

Remaining locally implementable work beyond active Canvas includes review
configuration/reassignment/bulk transitions, post-registration autofill and
row-scoped entity/unit pickers, procedure parameter/cross-step relationships,
master-mix/dependency diagnostics and print affordances, and durable image
lineage/non-text extraction. See the parity document for exact limits. Missing
implementation is not automatically an external permission blocker.
