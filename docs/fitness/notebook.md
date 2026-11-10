# Notebook verification

## New notebook body focus (2026-11-10)

Local changes on `71e7c7d7` focus the first paragraph when a blank notebook
opens after New notebook. The lone empty paragraph keeps its line height.
The Notebook build, typecheck and three Chromium browser tests passed. The
new focus assertion failed against the original build; the updated test
types into the focused body without clicking it or using Insert.

In an isolated macOS Native Preview profile with the rebuilt App bundle,
the dark Chinese UI showed the typed text below the title after New notebook,
with no intervening click. Saving showed revision 2. This did not exercise
Electron or a release package. The editor suite passed 82 of 83 tests; the
keyboard shortcut assertion also fails in a clean checkout of `71e7c7d7`.

## Control Lab creation through Notebook Canvas (2026-11-10)

Local changes based on `58a3307f` were built and tested on macOS with Chromium,
the real Rust Host, both production App bundles and the declared Python 3.12
dependencies. The harness uses loopback HTTP, a test-controlled shell approval
callback and the Workbench navigation parser to deliver App location events.

[The acceptance test](../../tests/e2e/notebook-control-canvas.mjs) binds the
PI analytic case to a recorded 8 s horizon and a table-pinned 1,001-sample
count. It recovers the original action receipt after restarting the Host and
confirms a second approved submission keeps the same experiment ID. Changing
the horizon to 9 s makes the old binding stale. A new saved binding creates a
distinct specification. Both real python-control verification runs report
PASS. Both exports go through the existing Notebook importer. The original
Finding still cites the 8 s trial, which reopens in the actual Control Lab UI
with its original trial and report IDs.

The Chromium ledger and inspected screenshots are under
`test-results/notebook-canvas/`. The existing Data Canvas Chromium test also
passed.

The same workflow passed in a separate macOS arm64 Electron 45.1.0 run with
an isolated Workbench profile. It passed again after rebasing onto `e79ffaf5`
and rebuilding Desktop and both Apps. macOS Accessibility observed and pressed the
actual Electron main-process confirmation sheet buttons. Cancel created no
experiment. Run once created the 8 s experiment, and approving it again
after restarting Electron and Host kept the owner count at one. A saved 9 s
binding created the second experiment. The Control Lab UI ran and exported
both passing trials. Notebook revision 5 retained the original Finding from
revision 3, and opening its reference displayed the original 8 s trial,
report ID and specification hash in Control Lab. The solver emitted runtime
warnings during the run. Both exports passed the Notebook import checks.

The Electron evidence ledger, native confirmation capture and reopened
trial screenshot are under `test-results/notebook-canvas/electron/`.

## Header navigation removal (2026-11-10)

On top of `9b30b913`, the document-name, Relevant items and Metadata header
buttons and their now-empty row are removed. Workspace navigation remains in
the bottom View menu, using the shared vertical Tabs controls for Notes,
Procedures, Relevant items, Metadata and Review. The document title, content,
draft/revision ownership and toolbar actions are unchanged. Obsolete header
tab styles are removed rather than hidden.

Local validation: Notebook build and typecheck pass; 141 package and 82 editor
tests pass, along with all 119 Python tests with real OCR enabled (no skips).
Browser coverage now asserts the header controls are absent and
checks repeated view changes, menu reopening, keyboard navigation and viewport
bounds at 600px in dark mode. Runtime browser verification is pending CI:
Chromium cannot create its process-singleton socket in this environment, even
after an approved unsandboxed retry. No local browser or Native visual pass is
claimed. Root `npm run check` is blocked by missing generated reader Wasm types;
the standalone icon check also needs the absent pinned GPUI assets. Theme,
design, SDK token, locale and protocol generated checks pass separately.

## Exact head: `9b0c987a` (2026-11-09)

Verified head: `9b0c987a90df71392f97b20783db5aa8e85bfd6b`
(`test(notebook): point the desktop profile at the prepared venv`) on
`codex/notebook-blocks`, [PR 181](https://github.com/phodal/pero/pull/181).
GitHub reports the pull request `MERGEABLE` with merge state `CLEAN`.
[Actions run 42604212999](https://github.com/phodal/pero/actions/runs/42604212999)
is the pull_request run for that SHA. The workflow conclusion is success.
Attempt 1 is the only attempt. A documentation commit on top of `9b0c987a`
does not by itself re-prove these jobs. A01 stays partial.

### Checks on this head

Passed on [run 42604212999](https://github.com/phodal/pero/actions/runs/42604212999).
Each job below is the single attempt on this head.

- [Notebook revisions, workbook and browser contracts](https://github.com/phodal/pero/actions/runs/42604212999/job/129115880848)
  succeeded (10:50:53Z–10:54:31Z).
- [Notebook Canvas real Host and Chromium](https://github.com/phodal/pero/actions/runs/42604212999/job/129115880869)
  succeeded (10:50:52Z–10:52:20Z).
- [Native shell compilation and unit contracts](https://github.com/phodal/pero/actions/runs/42604212999/job/129115881046)
  succeeded (10:50:52Z–10:53:59Z). Compilation and unit contracts are not
  rendered Native WebView acceptance.
- [Official DSH AST comparison contracts](https://github.com/phodal/pero/actions/runs/42604212999/job/129115880772)
  succeeded (10:50:52Z–10:51:14Z).
- [Linux CI gate](https://github.com/phodal/pero/actions/runs/42604212999/job/129119378597)
  succeeded (10:58:34Z–10:58:40Z).

Notebook revisions, Notebook Canvas, Native shell, Official DSH, and the Linux
CI gate passed on `9b0c987a`. The Desktop acceptance job on this run was
skipped. Native notebook chrome was not shown. Native remains the Wry WebView
and stays unreviewed.

### Desktop profile and screenshot

`tests/e2e/notebook.mjs` at this head writes the fresh profile from
`PERO_APP_PYTHON`. When owner fixtures are off and `PERO_APP_PYTHON` is set,
the harness writes `settings.json` with `app_python.apps.notebook` set to
`dirname(dirname(PERO_APP_PYTHON))`. The Host reads that binding from the
fresh profile.

`/tmp/pero-eln-desktop/test-results/notebook/desktop.png` (2976×2108, written
2026-11-09 18:48:48 +0800) is the local Desktop Electron Workbench capture.
It shows **New notebook**, the toolbar **Ask Agent**, **Revision history**,
**Save revision**, **Notebook home**, **Print options**, and **Worksheet
amendments**, and the document **Notebook in Pero**, Revision 2, with
“Read the original parameters.” Sheet1 A1 is 2 and B1 is 12. The revision
line reads “Revision saved 11/9/2026, 6:48:48 PM”. Native notebook chrome is
not in that capture.

Remote provider file-list, download, and sync, configured live-model
execution, multi-user authenticated signatures, physical inventory movement
and instrument runs, and Native WebView rendering stay outside this record.

## Prior recorded head: `94ecc010` (2026-11-09)

Verified head: `94ecc010697443ffe5a79ee3e96fca35a44d4a7e`
(`Merge branch 'master' into codex/notebook-blocks`) on
`codex/notebook-blocks`, [PR 181](https://github.com/phodal/pero/pull/181).
GitHub reports the pull request `MERGEABLE` with merge state `CLEAN`.
[Actions run 42594802214](https://github.com/phodal/pero/actions/runs/42594802214)
is the pull_request run for that SHA. The workflow conclusion is success.
The pull_request checkout merge is
`98194e0e6d8620cc39efdfc6ba1d34df57cb4856`
(`Merge 94ecc010… into b4039d94…`). Its tree matches
`94ecc010^{tree}` (`56ef22e64dd51af35eed6b0e01cbd722e8d85ac0`);
artifact names use the checkout merge SHA.
A documentation commit on top of `94ecc010` does not by itself re-prove
these jobs. Desktop and Native visuals were not reviewed. A01 stays partial.

### Checks on `94ecc010`

Passed on [run 42594802214](https://github.com/phodal/pero/actions/runs/42594802214).
Each job below is the single attempt on this head.

- [Notebook revisions, workbook and browser contracts](https://github.com/phodal/pero/actions/runs/42594802214/job/129084737993)
  succeeded (09:37:09Z–09:40:04Z).
- [Notebook Canvas real Host and Chromium](https://github.com/phodal/pero/actions/runs/42594802214/job/129084737536)
  succeeded (09:37:09Z–09:39:25Z).
- [Native shell compilation and unit contracts](https://github.com/phodal/pero/actions/runs/42594802214/job/129084738095)
  succeeded (09:37:10Z–09:45:45Z). Compilation and unit contracts are not
  rendered Native WebView acceptance.
- [Official DSH AST comparison contracts](https://github.com/phodal/pero/actions/runs/42594802214/job/129084737709)
  succeeded (09:37:09Z–09:37:36Z).
- [Linux CI gate](https://github.com/phodal/pero/actions/runs/42594802214/job/129088221403)
  succeeded (09:45:48Z–09:45:54Z).

Notebook browser, Canvas Host, Native shell, Official DSH, and the Linux CI
gate are green on `94ecc010`. The merge is clean. The Desktop acceptance
job on this run was skipped. Desktop and Native visuals remain unreviewed.

`npm run test:notebook:desktop` (`node tests/e2e/notebook.mjs`), run from
`/tmp/pero-eln-final` at this head, exited 1 before a window opened:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@playwright/test' imported from /private/tmp/pero-eln-final/tests/e2e/notebook.mjs
```

This checkout has no `node_modules` and no `desktop/dist/main.cjs`.
`apps/notebook/README.md` installs with root `npm ci` and
`npm ci --prefix apps/notebook`, then expects a built Workbench and Host.
That is not one install-and-run command. This failure is not Desktop
acceptance.

## Prior product head: `70d2e2fd` (2026-11-09)

Verified product head: `70d2e2fd7f61f2e2029ebde8a84c0098c10402a8`
(`fix(notebook): keep narrow action controls from overlapping`) on
`codex/notebook-blocks`, [PR 181](https://github.com/phodal/pero/pull/181).
[Actions run 42582557017](https://github.com/phodal/pero/actions/runs/42582557017)
checked that head. The pull_request checkout merge is
`728d59045dcc4492f1f91c2d8e68a835b2c8e7e5`
(`Merge 70d2e2fd… into bf32df68…`); artifact names use that merge SHA.
This ledger does not mark the ELN goal complete. Desktop acceptance, Windows
ACL, and paper-HTML jobs were skipped, so these checks are not full-platform
or visual acceptance.
A documentation commit on top of `70d2e2fd` does not by itself re-prove these
jobs. Run
[42581310460](https://github.com/phodal/pero/actions/runs/42581310460)
checked docs head `6a4758c6` (merge `1f84cd91`); its Linux CI gate failed
because Standalone harness Bazel setup returned HTTP 504. Run
[42580075914](https://github.com/phodal/pero/actions/runs/42580075914)
checked product head `61e028c` (merge `a867bfda`) and its DSH attempts failed
on the tree-sitter download. Docs run
[42578100117](https://github.com/phodal/pero/actions/runs/42578100117)
succeeded on recording commit `5ed4a040` (merge `67b48301`). Product run
[42576754065](https://github.com/phodal/pero/actions/runs/42576754065) checked
`c0c4b612`. Those runs are not `70d2e2fd`.

[Component parity](../design/notebook-component-parity.md) still retains all
94 pinned reference groups. Its earlier “exact-head acceptance pending”
sentence is superseded for runtime evidence by the checks below. Reference
stubs remain requirements; no private reference source/assets were copied.
`70d2e2fd` keeps Replace or restore and Keyboard shortcuts at
`flex: 0 0 auto` and `max-content` on the scrolling status row through 760px,
so one label does not paint over the other. The 600×900 page overflow
assertion (`documentElement.scrollWidth <= innerWidth`) was not weakened.
`61e028c` shows short decimals in mixture quantity inputs and keeps the stored
value until the field is edited. Document chrome from `c0c4b612` remains in
this tree. None of these commits is A01 visual acceptance. Desktop and Native
visuals were not reviewed.

### Checks on `70d2e2fd`

Passed on [run 42582557017](https://github.com/phodal/pero/actions/runs/42582557017).
Each job below is the single attempt on this head. The workflow conclusion is
success.

- [Notebook revisions, workbook and browser contracts](https://github.com/phodal/pero/actions/runs/42582557017/job/129044544355)
  succeeded (07:57:21Z–08:00:24Z). Artifact
  [notebook-browser-728d5904…](https://github.com/phodal/pero/actions/runs/42582557017/artifacts/13658116486)
  retains `copied-notebook-narrow-dark.png`. That PNG is 600×900. The page is
  dark. On the tools row, “Replace or restore document” and “Keyboard
  shortcuts” sit next to each other with a gap; the labels do not overlap.
  “Editor diagnostics” and “Sections” continue on the same row. This is the
  browser artifact only. Desktop and Native visuals were not reviewed.
- [Notebook Canvas real Host and Chromium](https://github.com/phodal/pero/actions/runs/42582557017/job/129044544414)
  succeeded (07:57:20Z–07:58:43Z). Artifact
  [notebook-canvas-browser-728d5904…](https://github.com/phodal/pero/actions/runs/42582557017/artifacts/13657263798).
- [Native shell compilation and unit contracts](https://github.com/phodal/pero/actions/runs/42582557017/job/129044544684)
  succeeded (07:57:22Z–08:00:24Z). Compilation and unit contracts are not
  rendered Native WebView acceptance.
- [Linux core types, permissions and durable runtime](https://github.com/phodal/pero/actions/runs/42582557017/job/129044544236)
  succeeded (07:57:21Z–08:05:03Z).

[Official DSH AST comparison contracts](https://github.com/phodal/pero/actions/runs/42582557017/job/129044544380)
succeeded (07:57:21Z–07:57:54Z). No DSH code was changed. Earlier heads
`61e028c` and `36fb8a4b` failed this download with HTTP 504 for
`https://github.com/tree-sitter/tree-sitter/releases/download/v0.25.10/tree-sitter-linux-x64.gz`
([run 42580075914](https://github.com/phodal/pero/actions/runs/42580075914),
jobs
[129036582502](https://github.com/phodal/pero/actions/runs/42580075914/job/129036582502)
and
[129039029215](https://github.com/phodal/pero/actions/runs/42580075914/job/129039029215);
[run 42568134548](https://github.com/phodal/pero/actions/runs/42568134548)).
Those 504s are not `70d2e2fd`.

[Standalone harness Bazel contracts](https://github.com/phodal/pero/actions/runs/42582557017/job/129044544458)
succeeded (07:57:21Z–08:03:56Z). On `6a4758c6` the same job stopped in
`bazel-contrib/setup-bazel@0.19.1` with HTTP 504. That external failure is
not `70d2e2fd`.

[Linux CI gate](https://github.com/phodal/pero/actions/runs/42582557017/job/129047325261)
succeeded (08:05:06Z–08:05:12Z). Its input recorded `notebook`,
`notebook-canvas`, `native-ui`, `core`, `ast`, and `harness-bazel` as
success. `desktop`, `desktop-linux`, `desktop-acceptance`,
`windows-acl-sandbox`, and `paper-html-live` were skipped.

Notebook revisions, Canvas Host, Native shell, Linux core, Official DSH, and
the Linux CI gate are green on `70d2e2fd`. Skipped Desktop, Windows ACL, and
paper-HTML jobs are still unverified. The workflow conclusion is success.
That success is not ELN completion and not A01 visual acceptance.

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

[A01](../design/notebook-component-parity.md) stays partial. Desktop and Native
visuals were not reviewed. The 600×900 dark browser capture named above was
inspected only for the tools-row overlap. A printed page was not reviewed.
Narrow document chrome through 760px remains in this tree: `0851c351` keeps
the nowrap toolbar inside the viewport, `c0c4b612` shortens that chrome so
the title stays on screen and document actions share a row with editor
status, and `70d2e2fd` gives those action controls `flex: 0 0 auto` and
`max-content` so the labels do not paint over each other.
`96fffc83` drops the published draft after save so reload does not restore an
earlier debounce copy. The passing Chromium job checks a 600×900 dark
viewport (`data-theme=pero-dark`, title still visible, no horizontal
overflow) and opens Notebook home at 760×950. Those checks are contract
execution. A green browser job is not A01 visual acceptance. Screenshot notes
from docs run 42578100117 stay on recording commit `5ed4a040`, and notes for
run 42580075914 stay on `61e028c`. Neither is this head.

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
  `70d2e2fd` browser job executed these scenarios. The product behavior is the
  `70d2e2fd` tree. That is contract execution,
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
passing Notebook browser job on `70d2e2fd`. That execution is not an
authenticated signature or a visual review.

### Evidence ledger and final gate

The exact-head contracts for `9b0c987a` are the “Checks on this head” section
above: [run 42604212999](https://github.com/phodal/pero/actions/runs/42604212999).
Notebook revisions, Notebook Canvas, Native shell, Official DSH, and the Linux
CI gate passed on that head. The desktop screenshot in that section is the
Electron Workbench capture. Native visual stays unreviewed. The `94ecc010`
section records the prior head, and the `70d2e2fd` section records the prior
product head. Older local counts below are historical and are not promoted to
`9b0c987a`. A01 stays partial. Remote provider sync, live-model execution,
multi-user signatures, physical instruments, and Native WebView stay outside
this record.

Historical wave 4 source validation, based on `c5b9f202` and including the local
controls, diagnostics and waiver fixes: **141 package tests, 77 editor tests,
119 Notebook Python tests (real OCR enabled, no skips), 67 Data Python tests,
28 SDK/Desktop tests and 9 build/CI-runner tests passed**. Notebook typecheck/build,
core TypeScript, generated contracts and locales also passed. The preceding
freeze passed five Bazel generated checks; the final package-export cache is
regenerated before publication. These local results do not by themselves
establish the `70d2e2fd` Chromium, Rust Host, or Native shell results, and they
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
  tree. This is not the `70d2e2fd` browser/Host result recorded above.
- The later local pre-controls freeze passed 139 package, 117 Notebook Python,
  71 editor, 28 SDK, 67 Data and nine build/CI-runner checks plus five Bazel checks.
  Subsequent reference-control edits mean these are prior-tree results, not
  counts for `70d2e2fd`. Exact-head CI for the current head is the checks section
  above, not these local totals.
- Local Chromium remains blocked by the established ProcessSingleton socket
  restriction. No restriction bypass or new local browser pass is claimed.
  The `70d2e2fd` browser and Canvas jobs are the CI runs of the built App with
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
