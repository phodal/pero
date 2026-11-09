# Notebook verification

## Exact head: `3924f94b` (2026-11-09)

Verified CI head: `3924f94bf6ab55a08474e25d5f95853ab6bc769f`
(`docs(notebook): record exact-head ELN CI evidence`) on
`codex/notebook-blocks`, [PR 181](https://github.com/phodal/pero/pull/181).
The product commit under that docs commit is
`36fb8a4bca4d9fad0c66b1280deeda692c707387`
(`fix(notebook): reject external workbook references in agent writes`).
[Actions run 42569537593](https://github.com/phodal/pero/actions/runs/42569537593)
checked `3924f94b`. The pull_request checkout merge is
`212f0a9f4d67a46c64594eaa30dcd0a8fc4074fa`
(`Merge 3924f94b… into f0b8065e…`); artifact names use that merge SHA.
This ledger does not mark the ELN goal complete. Desktop acceptance, Windows
ACL, and paper-HTML jobs were skipped on this Linux CI gate, so a green gate
is not full-platform or visual acceptance.
A documentation commit on top of `3924f94b` does not by itself re-prove these
jobs.

[Component parity](../design/notebook-component-parity.md) still retains all
94 pinned reference groups. Its earlier “exact-head acceptance pending”
sentence is superseded for runtime evidence by the checks below. Reference
stubs remain requirements; no private reference source/assets were copied.
`3924f94b` changes this ledger only. It re-ran the jobs below and did not
change Notebook product code.

### Checks on this head

Passed on [run 42569537593](https://github.com/phodal/pero/actions/runs/42569537593),
attempt 1:

- [Notebook revisions, workbook and browser contracts](https://github.com/phodal/pero/actions/runs/42569537593/job/129003473641)
  succeeded (05:50:07Z–05:53:52Z). Artifact
  [notebook-browser-212f0a9f…](https://github.com/phodal/pero/actions/runs/42569537593/artifacts/13652885999)
  retains `test-results/notebook/`.
- [Notebook Canvas real Host and Chromium](https://github.com/phodal/pero/actions/runs/42569537593/job/129003473857)
  succeeded (05:50:07Z–05:52:10Z). Artifact
  [notebook-canvas-browser-212f0a9f…](https://github.com/phodal/pero/actions/runs/42569537593/artifacts/13652329517).
- [Native shell compilation and unit contracts](https://github.com/phodal/pero/actions/runs/42569537593/job/129003473614)
  succeeded (05:50:09Z–05:52:30Z). Compilation and unit contracts are not
  rendered Native WebView acceptance.
- [Linux core types, permissions and durable runtime](https://github.com/phodal/pero/actions/runs/42569537593/job/129003474158)
  succeeded (05:50:07Z–05:57:03Z).
- [Official DSH AST comparison contracts](https://github.com/phodal/pero/actions/runs/42569537593/job/129003473728)
  succeeded (05:50:07Z–05:50:42Z). On product head `36fb8a4b`,
  [run 42568134548](https://github.com/phodal/pero/actions/runs/42568134548)
  failed this job twice with HTTP 504 downloading
  `https://github.com/tree-sitter/tree-sitter/releases/download/v0.25.10/tree-sitter-linux-x64.gz`
  (attempt 1 at 05:35:36Z, job
  [128999173929](https://github.com/phodal/pero/actions/runs/42568134548/job/128999173929);
  attempt 2 at 05:43:39Z, job
  [129001509746](https://github.com/phodal/pero/actions/runs/42568134548/job/129001509746)).
  That was an external download failure. No DSH product code was changed.
  This head's job passed on the first attempt.
- [Linux CI gate](https://github.com/phodal/pero/actions/runs/42569537593/job/129005504626)
  succeeded (05:57:09Z–05:57:17Z). Its input recorded `notebook`,
  `notebook-canvas`, `native-ui`, `core`, and `ast` as success.
  `desktop`, `desktop-linux`, `desktop-acceptance`, `windows-acl-sandbox`,
  and `paper-html-live` were skipped. The same gate on `36fb8a4b`
  ([job 129001618735](https://github.com/phodal/pero/actions/runs/42568134548/job/129001618735))
  failed because `ast` had not passed.

Notebook revisions, Canvas Host, Native shell, Official DSH, and the Linux CI
gate are green on `3924f94b`.

### Local workflows and remaining boundaries

The capability table below is the source inventory for this head. Every listed
owner file is present. The passing browser job calls the local scenarios,
including registration waiver inside `table-workflows`. No further concrete
local workflow was missing, so this head adds none.

Still outside this goal:

- Remote provider file-list, download, and sync. No Notebook provider contract
  is defined or consumed.
- Configured live-model execution.
- Multi-user authenticated signatures.
- Physical inventory movement and instrument runs.
- Native WebView rendering and packaged distribution.

[A01](../design/notebook-component-parity.md) stays partial. The browser job
asserts a 600×900 dark viewport (`data-theme=pero-dark`, title still visible,
no horizontal overflow) and uploads screenshots, including
`copied-notebook-narrow-dark.png`. This record does not include a visual
review of those screenshots, a printed page, Desktop, or Native. A green
browser job is not that visual acceptance.

Chrome polish from `f40feb1a` is in this head: the document title stays outside
workspace tabs so Metadata/Relevant views no longer hide `Notebook title`;
secondary research and import controls sit behind **More tools**; replace/restore
JSON is disclosed on demand; product chrome uses locale messages instead of
hardcoded bilingual pairs.

| Current local capability | Concrete source owners | Relevant tests and scenarios |
| --- | --- | --- |
| Recovery/history and rich editing | `frame.tsx`, `backend/drafts.py`, package document-history, `text-tools.tsx`, `code-block.tsx`, `raster-edit.tsx` | `test_drafts.py`, `document-history-editor.test.ts`, `content-editing-browser.mjs` |
| Grid/formulas and structured fields | `spreadsheet.tsx`, `grid-axis-controls.tsx`, `formula-input.tsx`, package worksheet/formula-syntax, `structured-table.tsx` | `grid-browser-scenario.mjs`, package worksheet/formula/grid tests, `structured-field-workflows.test.ts` |
| Local table/registration workflows | `table-workflows.tsx`, `table-source.tsx`, `catalog-archive.tsx`, backend catalog/table-workflows | `test_table_workflows.py`, `test_catalog.py`, `table-workflow-browser-scenario.mjs` |
| Templates and revision comparison | `template-tools.tsx`, `template-collections.tsx`, `template-comparison.tsx`, package template-comparison | `template-comparison-tools.test.ts`, `packages/notebook/test/template-comparison.test.ts`, `test_templates_search.py` |
| Procedures, materials and parameters | `procedure-step-editor.tsx`, `procedure-materials.tsx`, `procedure-parameters.tsx`, package workspace/procedure-parameters | `procedure-workspace-browser-scenario.mjs`, `procedure-workspace.test.ts`, `test_procedure_workspace.py` |
| Scientific designs and sample propagation | `scientific-content.tsx`, `molecular-graph.tsx`, `plate-design-library.tsx`, `sample-intake.tsx`, `sample-propagation.tsx` | `scientific-content-scenario.mjs`, `diagnostics-intake-browser-scenario.mjs`, `test_scientific_designs.py`, `test_sample_intake.py` |
| Local review lifecycle | `review-panel.tsx`, backend reviews and review workflow domain | `review-panel.test.ts`, `test_reviews.py`; fixed revisions, configuration/reassignment/bulk outcomes remain local-label attribution |
| Host AI proposals and check suggestions | `ai-tools.tsx`, `ai-cell-review.tsx`, `ai-check-review.tsx`, `backend/ai_proposals.py`, package ai-checks/proposals/recovery | `ai-check-tools.test.ts`, `ai-tools.test.ts`, `test_ai_proposals.py`, `remaining-workflows-browser-scenario.mjs` |
| Derived source extraction | `source-extraction.tsx`, `source-excerpt.tsx`, `backend/source_extraction.py`, `backend/source_parsers.py`, shared `packages/source-extraction` | `test_source_extraction.py`, `source-extraction-ui.test.ts`, `source-extraction-browser-scenario.mjs`, `scripts/build/source-parsers.test.mjs` |
| Research and configured print | `research-tools.tsx`, `notebook-print.tsx`, `notebook-print-content.tsx`, package research-tools/notebook-print/worksheet | `research-print-tools.test.ts`, `research-print-browser-scenario.mjs`, package research/print tests |
| Saved worksheet amendments | `worksheet-amendments.tsx`, `backend/worksheet_amendments.py` | `worksheet-amendments.test.ts`, `test_worksheet_amendments.py`, `research-print-browser-scenario.mjs` |
| Home/provenance and file intake | `notebook-home.tsx`, `file-intake.tsx`, `backend/notebook_home.py` | `home-file-intake-tools.test.ts`, `test_notebook_home_checks.py`, `remaining-workflows-browser-scenario.mjs` |
| Real Host project associations | `notebook-projects.tsx`, App SDK Notebook project contract, Desktop `notebook-projects.ts`, Rust `notebook_projects.rs` | `notebook-projects.test.ts`, `desktop/src/main/notebook-projects.test.ts`, `tests/contracts/notebook-projects.mjs` |
| Inline Canvas and Data quick-edit | `app-canvas.tsx`, App SDK Canvas/action form, Desktop/Rust Host owners, `apps/data/backend/canvas.py` | `tests/contracts/app-canvas.mjs`, `tests/e2e/notebook-canvas-browser.mjs`, Data Python and SDK/Desktop Canvas tests |

Unqualified UI/backend/test paths are under `apps/notebook/` in their respective
`ui-src/`, `backend/` and `test/` directories. Package domains are under
`packages/notebook/src/`. Filenames describe coverage intent, not passing counts.

### Integrated local workflows and current limits

- The prior local gaps are source-integrated: registration waivers with exact-input
  reason/audit receipts; named entry cards; undoable validated current-entry JSON
  replacement and original example restoration; required-date section insertion;
  section/list/nesting status; nine build-packaged Pero source records with readonly
  selection/loading/missing/retry and standalone legacy redirect/fallback. Relevant
  new tests are `reference-controls.test.ts`, `reference-controls-browser-scenario.mjs`,
  `test_named_reference.py`, `registration-waiver.test.ts`,
  `test_registration_waiver.py`, `registration-waiver-browser-scenario.mjs`,
  `source-diagnostics.test.ts` and `source-diagnostics-browser.mjs`. The
  `3924f94b` browser job executed these scenarios. The product behavior is the
  `36fb8a4b` tree. That is contract execution,
  not A01 visual acceptance. The audit found no additional missing local
  workflow among these previously open items.
- PDF native page text, DOCX/XLSX/PPTX text and explicit image/scanned-PDF OCR are
  implemented, not UTF-8-only. Receipts retain binary/text hashes, parser/version,
  page/part/region and Unicode spans. Tesseract and English trained data must be
  installed for OCR. Format bounds, unsupported Office content and the current native-parser
  isolation contract are recorded in [source extraction](../design/notebook-source-extraction.md).
- Print settings and original master-mix/worksheet-evidence comparison are real
  local workflows. Calling system print is not proof of a printed page or PDF.
  Build-packaged readonly source diagnostics now complement searchable manifest dependencies and source-link groups; worksheet evidence remains a separate scientific-record tool.
- Canvas uses an actual declared data-only Data view and owner actions, exact
  saved-source admission, Host confirmation and durable receipts. Imported receipts
  remain unverified; read-only is restrictive state, not authenticated identity.
  See [Canvas owner contract](../design/notebook-canvas-owner.md).
- Local review labels, chemistry structure validation, sample locations and mixture
  records are not authenticated signatures, chemical safety, physical inventory
  movement or measured laboratory outcomes. Configured live-model execution and
  actual service/hardware effects require separate owner acceptance.
- File intake previews/imports real local bytes and discovers installed owner Apps.
  No Notebook provider file-list/download/sync contract is defined or consumed;
  owner navigation cannot be reported as a remote file import. Real Host project
  associations remain distinct from local project/author display labels.

The implemented `required-missing-v1` registration waiver retains exact input,
reason, local attribution and waived missing-cell identities on immutable catalog
records and receipts. It cannot waive supplied types, units, options or schema.
`verifyRegistrationWaiver` runs from the `table-workflows` scenario inside the
passing Notebook browser job on `3924f94b`. That execution is not an
authenticated signature or a visual review.

### Evidence ledger and final gate

The exact-head contracts for `3924f94b` are the “Checks on this head” section
above. Older local counts below are historical and are not promoted to that
head. The ELN goal is not complete. Official DSH and the Linux CI gate are
green on this head, A01 visual acceptance was not reviewed here, and the
external boundaries above remain.

Historical wave 4 source validation, based on `c5b9f202` and including the local
controls, diagnostics and waiver fixes: **141 package tests, 77 editor tests,
119 Notebook Python tests (real OCR enabled, no skips), 67 Data Python tests,
28 SDK/Desktop tests and 9 build/CI-runner tests passed**. Notebook typecheck/build,
core TypeScript, generated contracts and locales also passed. The preceding
freeze passed five Bazel generated checks; the final package-export cache is
regenerated before publication. These local results do not by themselves
establish the `3924f94b` Chromium, Rust Host, or Native shell results, and they
do not cover remote-provider or live-model acceptance.


- Historical wave 2 local validation: 107 package, 53 editor and 78 Python tests;
  Notebook typecheck/build, generated protocol/locales and six SDK/Desktop catalog
  tests passed. This is not wave 4 evidence.
- Historical wave 3 freeze: 127 package, 58 editor, 97 Notebook Python, 66 Data
  Python and 13 SDK/Desktop Canvas/discovery tests passed, plus Notebook
  typecheck/build, core TypeScript, generated contracts/locales and five frozen
  Bazel checks. These counts must not be promoted to the final head.
- [Base CI 42549907982](https://github.com/phodal/pero/actions/runs/42549907982)
  passed its main real-backend Notebook scenario but exposed raster crop-edge
  interpolation in its separate editing scenario. Inspected procedure desktop-light,
  retained-revision dark and review narrow-dark screenshots are base-only evidence.
- [Native compile/unit CI](https://github.com/phodal/pero/actions/runs/42553040882/job/128952620581)
  succeeded at `c5b9f202`.
  That checkpoint's Notebook browser/Host runs had numeric-revision, receipt-order,
  fixture-charset and selector failures, with fixes subsequently made in the working
  tree. This is not the `3924f94b` browser/Host result recorded above.
- The later local pre-controls freeze passed 139 package, 117 Notebook Python,
  71 editor, 28 SDK, 67 Data and nine build/CI-runner checks plus five Bazel checks.
  Subsequent reference-control edits mean these are prior-tree results, not
  counts for `3924f94b`. Exact-head CI for that later head is the checks section
  above, not these local totals.
- Local Chromium remains blocked by the established ProcessSingleton socket
  restriction. No restriction bypass or new local browser pass is claimed.
  The `3924f94b` browser and Canvas jobs are the CI runs of the built App with
  a real temporary backend; their artifacts hold the screenshots. Passing those
  jobs is separate from an A01 visual review.
- Native compilation/unit tests are not rendered Native WebView acceptance.
  Configured live-model, packaged distribution, physical instrument and multi-user
  identity acceptance remain separate and must not be inferred from fixtures.

## Historical verification records

The records below describe earlier commits only. Their then-current limitations
and test counts are historical, not the current capability matrix or final gate.

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
