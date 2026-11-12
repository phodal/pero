---
kind: verification_report
status: partial
date: 2026-11-11
github_issue: 195
github_state: open
github_url: https://github.com/phodal/pero/issues/195
---

# Source-backed MyST documents on PR #196

## Reconstructed continuation on draft PR #201

#196 was merged; this continuation is based on current master `6756d134` and
retains #198 catalog, #197 gates and subsequent Notebook UI changes. The first
three continuation commits were retained at `d526035f`; the remaining SDK work
was reconstructed and published at `eb39f831`, followed by the reviewed duplicate
target repair. This section supersedes earlier stage descriptions for #201.

Implemented: pinned official proof families/aliases and scientific text; labelled
recorded code/output embeds with shared raster assets, provenance, visibility and
stale notices; glossary/abbreviations with metadata inheritance and exact recovery;
continuous Markdown/IPYNB counters in explicit TOC order, excluding hidden/unlisted
resources. No second editor or persistence owner, kernel, plugin execution,
remote inventory or website deployment is added.

Review reproductions repaired: duplicated metadata titles in code/Markdown-first
notebooks, hidden input exposed through derived HTML source disclosure, proof
embeds rejected as inline, scientific glossary/abbreviation text lost, and
ambiguous standalone labels selecting a first target. Duplicate destination IDs
and references are inactive while unique path-qualified targets still work.
Repeated reference/title/TOC expansion is admitted before allocation through one
2 MiB/20,000-node document budget; abbreviation projection has its own bounded
owner. Source and original snapshot recovery remain exact.

Fresh final SDK checks: **321 tests**, Notebook TypeScript and production build
passed. The integrated pre-duplicate-repair tree passed **110 editor tests**,
**151 real-OCR backend tests** with no skips, and all **7 Bazel checks**. Real
DOCX/TeX/Typst/JATS artifact assertions inspect publication bodies rather than
recovery bytes. The final packaging checks and frozen Bazel rerun are tracked
in the PR, not assumed from these earlier results.

First-draft CI [43077461927](https://github.com/phodal/pero/actions/runs/43077461927)
failed one browser locator because the new page navigation and authored reference
share a title. The repaired test asserts both exact destinations separately; six
other Notebook browser tests and Canvas journeys passed that earlier head. Fresh
exact-head browser/PDF/CI acceptance remains pending. Local Chromium was attempted
normally and with approved elevated execution; both fail at the environment's
singleton socket restriction. No new local screenshot, Native/Electron GUI or
full MyST compatibility is claimed. No merge or deployment was performed.


### Follow-up acceptance and scientific-reference repair

At checkpoint `568c5db3`, CI run [43080600913](https://github.com/phodal/pero/actions/runs/43080600913)
passed all seven real Notebook browser journeys, including the previously failing
project reference destination. Its [retained artifact](https://github.com/phodal/pero/actions/runs/43080600913/artifacts/13885291097)
contains inspected screenshots and a real two-page A4 Chromium PDF with equations,
table, references and diagnostics, without PDF JavaScript. This supersedes the
pending-browser statement above for that checkpoint only. Both real Host Canvas journeys also passed, including owner confirmations, revision/Host-restart recovery and Paper → Notebook → PI → Finding → Project interop; [Canvas evidence](https://github.com/phodal/pero/actions/runs/43080600913/artifacts/13884986744) was retrieved and the recovery screenshot inspected. Aggregate CI and Native are still running. The browser fixture now checks proof, glossary and abbreviations in preview, reload, HTML and printed PDF; this extended fixture awaits a new CI run.

Read-only review then reproduced two in-scope semantic defects: scientific adapters
replace resolved authored reference children with a generic target label, losing
custom term/proof wording; JATS groups definition-list children in fixed pairs,
misassigning a second description as the next term. Both defects are repaired: rich resolved reference children survive, and glossary descriptions group by actual node type, including rich terms, tight/loose descriptions and nested lists. Local/cross-page publication-body regressions retain ambiguity placeholders and exact source recovery. All 323 SDK tests, 155 focused MyST/IPYNB tests, Notebook types and production build pass on the repaired tree. These are not kernel/site
parity work and do not require a new owner or persistence path.


The extended browser fixture on `fc1828de` passed preview/reload/HTML checks but
asserted print visibility before switching to print media. CI run 43081818190
correctly reported the intentionally screen-hidden publication surface. The
visibility check now follows `emulateMedia(print)`; all content, destination and
real PDF assertions remain required. This is a test-stage correction, not a
change to publication CSS or removal of the visibility requirement.

This report supports the user's subsequent request to fill in MyST capabilities.
It extends PR head `d65e798c740d49ceb3132c853e54304c4f1adf57`; it does not close
the broader #195 roadmap or claim full MyST compatibility. The
[capability matrix](../design/myst-capabilities.md) links the pinned upstream
sources and separates implemented features from remaining work.

Final integration preserves concurrent bases `5891fcab` and `d1cdba2a` (verified
as ancestors), including the generic SDK and its opaque future-version contract. The original `d65e798c` comparison above
remains the before-task baseline, not the current integration base.

## Published first-stage vertical slice (`50de2bb`)

- Official `myst-parser@1.7.5`, `vfile@5.3.7`, `yaml@2.8.3`, and
  `katex@0.16.22` are exact dependencies. Authored source is authoritative, not
  an imported executable AST. Both persistence and UI enforce a 256 KiB UTF-8
  source limit and explicit version 1 attributes.
- A `mystDocument` block uses the existing Notebook revision owner. It preserves
  original source, line endings and unknown syntax; schema/extra-field errors
  reject saves rather than silently dropping data. The prose-only interchange
  adapter reports a loss and directs users to the dedicated MyST export.
- MyST registers a shared document-block definition and uses its editor adapter
  and generic `documentBlockNode`, rather than replacing the concurrent SDK with
  a separate widget implementation. Source validation remains MyST-specific.
  Integration exposed an identity seam: the generic node's default block ID must
  be `null`, not an empty string, for NotebookIdentity to assign a new ID. The
  adapter now follows that contract; regressions check new IDs, source retention
  and template origin alongside reopen and clipboard behavior.
- MyST files and source bundles append a block without replacing the Notebook.
  Source editing, diagnostics, sandboxed preview and source/bundle/HTML downloads
  are real UI operations. Readonly/future schemas retain source download.
- Scientific preview includes MathML formulas, tables, admonitions, local labels,
  numbered target links, footnotes and task-list completion states. Ordinary local
  fragment links use the same target identity. Missing/duplicate references and
  unsupported syntax produce diagnostics.
- `pero.bibliography` is an explicitly namespaced, authored local citation preview
  convenience. It is not standard MyST BibTeX/CSL bibliography support. Metadata
  mappings are retained. Typed scholarly validation was not in this first stage;
  it is implemented and locally verified in the SDK continuation below.
- Standalone HTML is an inert download with CSP, escaped HTML, no JavaScript and
  self-contained MathML. Code, includes, plugins, reactive expressions and asset
  fetches do not run. Images remain links/placeholders. No website is deployed.
- Bundled dependencies' licenses and attributions are retained under the App's
  existing `licenses` packaging path, including MIT, ISC, BSD, Apache and SPDX
  dataset attribution. Exact license texts were inspected; staging copies them.

## Repairs prompted by actual earlier CI

Run [42930515786](https://github.com/phodal/pero/actions/runs/42930515786) exposed
an accepted-proposal receipt disappearing when the frame adopted a new revision.
The card now recovers that receipt from the existing durable proposal list,
scoped to the same block and revision, and clears it when that scope changes.
A behavioral regression covers revision adoption, full editor remount/reload,
no duplicate POST, absent action controls, and unrelated receipts.

Two stale tests expected the Notes tab to display the document title, while the
current Notes-tab implementation and another test explicitly use `Notes`. The
navigation tests now assert that current label without removing their unsaved
content, source selection, repeat-navigation or readonly assertions. The current
tab implementation is unchanged.

The Canvas workflow previously failed before Host/browser checks because the
pinned reader toolchain lacked `wasm32-unknown-unknown`. Its setup now explicitly
installs that target for `nightly-2026-10-28`; no gate is skipped or weakened.

## First-stage verification scope (`50de2bb`, not new-stage results)

- Notebook package after rebase: 178 tests passed, no skips. Editor: 95 tests passed,
  no skips.
- Python backend after rebase: 135 tests passed with `NOTEBOOK_REAL_OCR=1`, no skips.
- Notebook production build and TypeScript check passed again after rebase.
- Official-parser and renderer fixtures test rich content, equations, citations,
  malformed YAML, inert directives, source roundtrips, local links, target IDs,
  task status, dangerous URLs and HTML escaping.
- Malformed known directives, unknown directives and nested prose/list/include
  bodies retain their exact source through source/bundle roundtrips. An actual
  backend create/commit/reopen regression edits only a separate paragraph and
  confirms byte-exact Unicode/CRLF MyST source in historical and latest revisions,
  unchanged include contents, no include expansion and no code-cell effects.
- The new real-backend browser test imports an actual file, edits and saves a
  revision, reopens exact source, verifies scientific preview and sandbox, rejects
  attempted outbound requests, and checks all three downloaded file contents.
  Its fixture and JavaScript syntax checks passed. The published first-stage CI
  passed this browser test; see the exact run below.
- Local Chromium cannot start because this container denies its singleton Unix
  socket. That outcome was already checked, including an approved elevated
  attempt; it was not retried or bypassed. Browser checks and screenshots require
  the actual PR CI. First-stage Notebook browser results below are actual CI, not
  inferred from package tests/build. Electron, Native and Wasm remain unverified.

- Bazel `//:checks`: normal lock refresh passed all 7 checks. The frozen-lock
  `--config=ci` run passed all 7 checks again after the rebase (cached, exit 0).
  These checks cover schema, TypeScript, locale and theme consistency, not browser
  acceptance.

Published first-stage evidence: [run 42935112946](https://github.com/phodal/pero/actions/runs/42935112946),
[Notebook job 130243135769](https://github.com/phodal/pero/actions/runs/42935112946/job/130243135769)
on `50de2bb` passed all five browser tests. The task's browser review inspected
[artifact 13816949905](https://github.com/phodal/pero/actions/runs/42935112946/artifacts/13816949905)
and found the source textarea approximately 830 × 43 px. Thus functional green CI
was not sufficient visual acceptance. In the same run, the Canvas job's Data flow
passed, but Control Lab failed waiting for its initial “Run experiment” button.
TAP completed with one failure and the process did not exit before cancellation.
[Canvas job 130243136054](https://github.com/phodal/pero/actions/runs/42935112946/job/130243136054)
and [artifact 13818368520](https://github.com/phodal/pero/actions/runs/42935112946/artifacts/13818368520)
contain no Control Lab startup screenshot. The cause is not established. The
continuation adds bounded, secret-safe startup evidence and guaranteed browser
cleanup, without changing the selector, timeout or production behavior. Control
Lab workbench/request tests pass 25/25 and test syntax checks pass locally; the
next CI must establish the browser outcome, not assume a timing fix.

The concurrent base `d1cdba2a` subsequently passed the unchanged Canvas flow in
[run 42937428310](https://github.com/phodal/pero/actions/runs/42937428310):
[Canvas job 130251152512](https://github.com/phodal/pero/actions/runs/42937428310/job/130251152512)
passed both scenarios, including the exact prior failing PI experiment test at
01:19:23Z. [Notebook job 130251152591](https://github.com/phodal/pero/actions/runs/42937428310/job/130251152591)
passed all five browser tests, 179 package, 96 editor and 136 backend tests.
This confirms base-head recovery, not the cause of the earlier transient failure
or acceptance of the following SDK continuation.

## Historical SDK checkpoint (before published `f88535f6` CI acceptance)

The user continued with “继续按 SDK 实现”. Inspected changes:

- Shared Notebook document-block SDK now exposes explicit future-version policy
  (`preserve` by default, MyST `reject`) and identity-free `validateFields` for
  current-version field admission. Full validation still checks block identity
  and preserves the `current | opaque` result added by concurrent `d1cdba2a`.
  MyST consumes these contracts instead of repeating page-specific validators.
- Shared typed import/export descriptors own extension/media-type metadata,
  byte budgets and pure codecs. `myst-formats.ts` supplies source/bundle/HTML
  codecs; the UI consumes them and retains only file I/O and presentation.
  Independent review found alias-expanded metadata could produce a bundle larger
  than its own import budget. Bundles now write only their authoritative source
  envelope. Legacy derived fields remain accepted but ignored on import. Tests
  cover alias-heavy metadata and worst-case JSON escaping within the file budget.
- Direct pinned `myst-frontmatter@1.10.2` validates page metadata into a typed
  `scholarly` projection. Source and raw metadata remain authoritative and
  unchanged. Validation diagnostics, malformed nested values and deterministic
  date handling are explicit. Standalone HTML displays normalized authors and
  affiliations, DOI, licenses and funding; it does not externally verify them.
- TypeScript and Python now consume the same MyST source-wire fixture, covering
  acceptance/rejection, preserved Unicode/line endings and the UTF-8 boundary.
- The observed textarea defect is repaired using shared Textarea with `rows={12}`
  and a narrow CSS specificity override for source geometry. Browser assertions
  measure height/min-height and at least ten lines; separate source/preview
  screenshots supplement the earlier full-page screenshot. These changes have
  not yet passed a fresh remote CI run or screenshot review.
- Derived Bazel lock changes are limited to three importer/hash replacements
  (three lines removed and three added). The continuation's frozen seven cached
  checks passed, as reported by the integration owner. This is not browser evidence.

Review follow-up also removes noteCard's full-body title override, restoring the
existing localized block title and avoiding duplicate content. Its editor regression
checks the Chinese header and single body occurrence. The separate render-time
scope-ref review comment remains unconfirmed: no abandoned scope render path was
reproduced, and proposal/reload regressions pass. No speculative concurrency
mechanism is added under the repository's architecture rule.

New-stage local validation after integrating `d1cdba2a`: **197 package tests,
96 editor tests, and 138 Python backend tests with real OCR enabled passed**, no
skips. Notebook typecheck and production build passed. All seven frozen-lock Bazel checks
passed again on the integrated tree (cached, exit 0). Independent review identified
the bundle-budget issue above; its regression now passes. New-head real browser
results and screenshot inspection remain pending. The earlier 50de2bb results do
not establish acceptance of these new UI/SDK changes.

## Historical functional gaps after the text-project slice

Bounded local text snapshots, root `myst.yml`, project/page scholarly inheritance
and explicit BibTeX/CSL-JSON metadata resolution are now implemented as described
below. They do not establish the full upstream MyST project compiler.

CSL citation styling, binary assets, include expansion, cross-document references,
lossless `.ipynb` interchange, site publishing and JATS/DOCX/TeX/PDF adapters remain
open. Jupyter and reactive execution require a separate owner/permission design
and stay off. These are functional gaps, not hidden successful paths or stubs.
Future publication codecs must preserve loss reporting and keep file/network/
execution effects in their existing owners. No automatic asset fetch, kernel or
website deployment is introduced by this continuation.

## Published SDK stage, separate from project continuation

The published stage is `f88535f663e25a268ab13ecbc6281d2f56af669b` (same tree as local
`d3740e42147e6dd293687dc1d3f32984c7e8473c`). In run
[42940058781](https://github.com/phodal/pero/actions/runs/42940058781),
[Notebook job 130259449533](https://github.com/phodal/pero/actions/runs/42940058781/job/130259449533)
passed browser 5/5 and
[Canvas job 130259449491](https://github.com/phodal/pero/actions/runs/42940058781/job/130259449491)
passed 2/2. The overall run completed successfully. Package 197, editor 96 and Python 138 checks passed locally and in CI.
Screenshot review of artifact 13819869492 source/preview images showed the repaired
textarea showed twelve readable monospaced lines; controls/diagnostics were clean;
author, affiliation, ORCID, DOI and license appeared. Lower iframe body outside
that viewport was not visually accepted. Native shell compiled, but Native and
Electron GUI were not run. These results do not validate the later project slice.

## Text-project continuation (local implementation)

Implemented separate source-only project snapshots and shared TS/Python wire
fixtures, official project metadata inheritance, forced BibTeX/CSL-JSON resolution,
and generic resource editor/entry preview. Limits now also measure persisted
JSON-string contribution against Notebook's unchanged 2 MiB document cap.
Real EntryStore tests cover bibliography edits, original revisions and near-limit
save/reopen. Unsupported project versions retain raw download recovery.

Local Chromium remains unrun because its singleton socket launch was denied in
this environment; no alternate launch was attempted. The new browser test captures
resource-editor and preview screenshots when run in real CI. No project-browser,
visual, Electron or Native acceptance is claimed by these local core/editor tests.

Completed project-stage local checks:

- `npm test --workspace @pero/notebook`: **211/211 passed**.
- `npm test --prefix apps/notebook`: **99/99 editor tests passed**; Python
  **143 discovered, 141 passed, 2 existing optional tests skipped**.
- `npm run typecheck --prefix apps/notebook`: passed.
- `node scripts/build/apps.mjs --app notebook`: passed against the final code.
- Bazel normal invocation refreshed derived pnpm/input-cache records as expected;
  subsequent CI-frozen `//:checks`: **7/7 passed**. Root npm lock is authoritative,
  retains unrelated platform metadata and includes only intended new packages.
- New dependency notice was verified byte-for-byte in the actual staged builtin
  App payload. Its closure is MIT/BSD; no CSL engine/citeproc is installed.
- Browser source passes syntax checking; browser execution and screenshot
  inspection for this new stage remain pending CI, not accepted locally.


Final integration checks: `NOTEBOOK_REAL_OCR=1 PYTHONDONTWRITEBYTECODE=1
python3 -m unittest discover -s apps/notebook/test -p 'test_*.py' -v`
passed **143/143 with no skips**, including real image/scanned-PDF OCR and the
limited parser-process OCR path. This supersedes the earlier default run's two
opt-in skips; it does not imply browser acceptance.

The source-diagnostics registry now includes the project snapshot, compiler,
format codecs, bibliography resolver and Python persistence boundary. Rebuilt
App source evidence contains each file as `ready` with exact source text/digests;
source-diagnostics tests passed **3/3**. An independent read-only scoped review
found no blocking defect and passed **25 core/snapshot, 5 Python project and 3
project editor tests**. The reviewer did not launch a browser.

Independent admission review also reproduced a pre-existing source-document mismatch:
JavaScript accepted lone UTF-16 surrogates that UTF-8 export replaced, while Python
rejected them. Shared MyST source admission now rejects those invalid scalar values
before encoding. The cross-runtime corpus and both source/bundle format paths cover
high/low lone surrogates and retain valid supplementary characters unchanged.


## Published text-project acceptance (`20367200`)

Run [42943619611](https://github.com/phodal/pero/actions/runs/42943619611)
completed successfully on published head
`20367200367432d9f9fed49c13416bb3606a129c`. Notebook job 130271022650 passed
211 core, 99 editor, 143 real-OCR backend and six browser tests. Canvas job
130271022695 passed both real-owner scenarios. Retained artifact 13820914534
contains inspected project editor, preview and readonly recovery screenshots.
The bibliography below the captured viewport was established by assertions,
not visual inspection. Desktop acceptance was skipped; no Native/Electron GUI
acceptance follows from these results.

## Scientific workflow continuation: current verification boundary

The continuation implements explicit bounded resources, cross-document references,
recorded IPYNB interchange, real local CSL formatting and scientific publication
through the same document SDK. The capability matrix and individual domain
notes describe the admitted subset and unsupported features. Kernels, plugins,
automatic resource retrieval and arbitrary TeX/Typst compilation remain off.

An unpublished local continuation was interrupted before it reached the PR.
Its earlier local test counts are historical, not acceptance for reconstructed
source. This continuation is revalidated from the published `20367200` base;
only tests rerun against the reconstructed integration will be recorded below.
Original Notebook source/revisions are not migrated or replaced.


## Reconstructed integration published at `dda9a5fe`

Published `dda9a5feb4a01f3306e7f3503ec50ad717d20170` has the same tree as local
`65b68ffacb1194cbb099ea83bda224c8cb0174fd`. It preserves master `ccc13945`,
including the concurrent Canvas saved-document/inline-save workflow. Actual
editor regression proves mixed MyST/Canvas drafts do not mount old saved inputs,
save adoption uses the exact new revision, and historical views remain read-only.
The original PR remains open and unmerged.

Fresh aggregate checks against this combined tree:

- Core: **266/266 passed**, no skips.
- Complete editor suite: **102/102 passed**, no skips, serial local invocation.
- Backend: **149/149 passed** with `NOTEBOOK_REAL_OCR=1`, no skips.
- Notebook TypeScript check and production build passed.
- Exact emitted RefKit Wasm/hash and staged notices test: **1/1 passed**.
- All **40 registered source files** are ready with exact current byte digests.
- CI-frozen Bazel `//:checks`: **7/7 passed** on committed generated inputs.
- Actual LibreOffice render shows native superscripts/subscripts, fraction/root,
  table, raster and headings. Native Microsoft Word was not tested.
- The rebuilt scientific XML fixture validates against the official NLM JATS
  Archiving & Interchange 1.3 schema. This does not certify every arbitrary input
  or the separate Publishing/Authoring profiles.

Independent review reproduced and verified fixes for comments leaking into
publication bodies, oversized repeated include selections aborting compilation,
coerced array-valued notebook cell types, JSON numeric admission differences and
hidden-cell reference targets. A missing IPYNB interchange registration was found
by the complete editor suite and fixed without weakening its parity assertion.
Twenty-five independent focused checks/reproductions subsequently passed.

The initial reconstructed 101-test editor run had one genuine interchange parity
failure; the final 102-test run above includes its fix and the master compatibility
regression. Earlier lost-workspace/concurrent esbuild failures are not counted as
successful final checks. Root npm and derived pnpm resolve one `docx@8.5.0`; the
npm workspace listing still reports the upstream adapter's declared 7.x range.
Actual clean installation, type checking and binary artifact tests validate the
scoped override; no casts conceal mixed classes.

New browser journeys exercise custom CSL editing and exact HTML reuse, notebook
save/reopen and original recovery, binary image decode, DOCX/ZIP bytes, dedicated
print DOM and actual PDF text/page inspection, without external network requests.
[CI 42964204936](https://github.com/phodal/pero/actions/runs/42964204936) was launched
for this published head. Browser/PDF/Canvas results and inspected retained
screenshots are reported on the PR when their matching run completes; this local
report does not imply that those checks have already passed. No local Chromium
retry was attempted after the environment's earlier launch denial.

A subsequent UI-only disclosure makes every scientific download's full original
source recovery explicit, including comments and omitted content, before users
share it. The existing notebook warning remains. HTML and printing omit original
source, and publication bodies omit comments/hidden cells. Six focused actual
component checks and type checking pass for that disclosure; source/publisher
behavior is unchanged.

## Canvas CI reconciliation with the current Notebook design

Run [42964513846](https://github.com/phodal/pero/actions/runs/42964513846)
tested PR head `2c6a3267` merged into master `7607c741`, rather than the older
local master `ccc13945`. The actual PI owner journey passed. The Data owner
journey passed projection, confirmation denial/cancellation, archive and retained
receipt, historical inspection, and Host restart recovery, then stopped while
looking for the hidden `Refresh installed Apps` control. Its retained screenshots
and `browser-context.json` show the healthy bound view with no browser errors.
The current design places configuration behind `Configure App view`; the test
had not opened it. No timeout or production permission change is needed.

The rebinding portion also still expected an unsaved binding to attempt a mount
and fail. The current saved-document contract deliberately avoids that request.
The repaired journey explicitly opens configuration, refreshes declarations,
checks that an edited binding makes no speculative mount, directly verifies that
Host rejects that unsaved source, then saves the revision through its inline
action and verifies successful remount with unchanged binding identity/inputs.
The merged-tree Notebook typecheck, browser-scenario syntax check and all 18
focused Canvas domain/SDK/actual-editor tests passed. The editor regression
uses the real configuration disclosure and confirms source preservation through
a changed-declaration save and read-only revision. Actual repaired browser
acceptance awaits the next CI run; no local Chromium was launched for this repair.

## Browser findings on published `2c6a3267`

Actual [CI 42964513846](https://github.com/phodal/pero/actions/runs/42964513846)
ran against GitHub's merge tree with newer master `7607c741`. Linux core/runtime,
Native compilation, and Notebook's 266 core, 102 editor and 149 real-OCR backend
checks passed. Notebook Chromium passed 5/7 journeys and Canvas passed 1/2.
These are failures requiring correction, not complete product acceptance.

- Scientific DOCX download called the official adapter's Node-only
  `Packer.toBuffer`. An actual browser-target bundle without Node globals
  reproduced `nodebuffer is not supported by this platform`. The adapter now
  uses official Blob output and converts its ArrayBuffer to bytes. A real ZIP,
  equation and source-recovery regression passes in that same browser-API realm.
  The expanded publication assertions had also been accidentally placed in
  teardown; they now run in the test body before resources close. All download,
  XML, PDF and source checks are retained. The complete local core suite now
  passes 267/267; typecheck and production build pass.
- Project preview reached a blank iframe after clicking a cross-document link.
  The exact target exists in both base and CSL-enriched HTML. The inherited
  `srcdoc` base resolves fragment-only links to the embedding App URL; preview
  fragment URLs must stay within the inert publication, independently of the
  standalone HTML export.
- Canvas Data recovery completed actual owner projection, denied/cancelled and
  confirmed writes, read-only receipt review and Host restart. It then failed
  opening configuration after master moved controls behind a gear. Its test
  must follow that current UI and the existing saved-revision admission rule.
  The separate real PI experiment/Finding journey passed.

Retained [Notebook artifact 13831226001](https://github.com/phodal/pero/actions/runs/42964513846/artifacts/13831226001)
and [Canvas artifact 13830497306](https://github.com/phodal/pero/actions/runs/42964513846/artifacts/13830497306)
were downloaded with verified archive digests. Inspected pixels show the inert
IPYNB outputs, publication metadata, blank project frame at failure and recovered
Data Canvas. They do not establish corrected browser behavior. A fresh run on
the subsequent repaired head is required; no local Chromium retry was attempted.


## Project preview fragment navigation repair

Run [42964513846](https://github.com/phodal/pero/actions/runs/42964513846),
Notebook job 130338695127, reached the project cross-document click and then
could not find its target. The retained `myst-project-publication.png` shows an
empty iframe after the click. Both the base and CSL-enriched renderers retain
the correct `myst-notes~2e~md:note-label` ID. The defect is the srcdoc URL base:
a fragment-only href resolves against the embedding App URL, navigating the
sandbox away from the publication instead of scrolling its target. This URL
behavior and the explicit `about:srcdoc#…` fix match the
[MDN srcdoc example](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#embedding_source_code_in_an_iframe).

All three static publication previews now specialize generated fragment hrefs
to `about:srcdoc#…` at the UI boundary. Downloaded HTML and the print input keep
the original relative fragments, so each standalone file navigates within itself.
The HTML content, source, identifiers, empty iframe sandbox and restrictive CSP
remain unchanged. No script, parent access or additional fetching is enabled.
Regression coverage checks source/metadata/citation links, unchanged external
links and source escaping, exact preview/export equivalence after this sole URL
specialization, and the real-browser target plus repeated page navigation.
Local Chromium remains unrun after its earlier launch denial; actual browser
navigation and screenshot acceptance require the next matching CI run.

Focused actual-component and preview regressions passed **11/11**, no skips;
Notebook TypeScript checking and both browser-test syntax checks passed.
The expanded metadata/citation/escaped-source preview fixtures passed **3/3**
again after their final edit. These are local DOM/URL results, not browser acceptance.

## Print dialog visibility repair after `42c40e37`

[CI 42966549583](https://github.com/phodal/pero/actions/runs/42966549583) passed
267 core, 105 editor, 149 backend and six of seven Notebook browser journeys.
Both actual Canvas owner journeys passed, including declaration rebinding and
bounded owner metadata writes. Actual DOCX/artifact downloads and repeated
project navigation now pass. All other required CI jobs passed. The remaining
standalone publication journey reached the print-only DOM but could not see its
`Print` button, so scientific PDF acceptance was still incomplete.

The retained screenshot shows no visible dialog. `NotebookPrintTools` is owned
beneath the collapsed File menu: the output already portals to the page body,
but its dialog remained under closed `details`. Both normal and publication
print dialogs now portal to the same body, retaining the existing state owner,
shared modal behavior, action and output. No browser selector or PDF assertion
was weakened. Eight actual-component checks pass, including an owner mounted
inside closed details, exact Print action, focus restoration, cancellation,
afterprint cleanup and distinct normal/publication output. Fresh real browser
and PDF acceptance requires the subsequent matching CI run.

Current retained evidence: [Notebook screenshots](https://github.com/phodal/pero/actions/runs/42966549583/artifacts/13831837148)
and [Canvas screenshots/receipts](https://github.com/phodal/pero/actions/runs/42966549583/artifacts/13832230284).
Both archives were checksum-verified; actual project/CSV/Canvas and failure
pixels were inspected. Native/Electron GUI and arbitrary TeX/Typst compilation
remain outside this evidence.

## Accepted scientific workflow checkpoint `d190b80d`

[CI 42967754932](https://github.com/phodal/pero/actions/runs/42967754932)
completed successfully on `d190b80db49ff9401cf7a88e6be2e2aef99647f9`.
Notebook passed 267 core, 106 complete editor, 149 real-OCR backend and all seven
Chromium journeys. Both Canvas real-owner journeys and the Linux CI gate passed.
The local complete editor rerun independently passed 106/106 after print repair.
Native compilation passed; skipped Native/Electron GUI acceptance is not claimed.

Actual scientific downloads, repeated internal navigation, same-origin CSL,
IPYNB source recovery, print invocation/cleanup and PDF bytes/text/pages now pass.
[Notebook artifact 13831913303](https://github.com/phodal/pero/actions/runs/42967754932/artifacts/13831913303)
(archive SHA-256 `658b5dfaf7139bccd34580d398628db31c4f8c2b9d309f94d43f965ce01ed0a2`)
and [Canvas artifact 13831996896](https://github.com/phodal/pero/actions/runs/42967754932/artifacts/13831996896)
(`26acc6510821bbea551c82b62a8200c5d14b6095d054c468a4ca93113f812e12`)
were downloaded and verified. Both real PDF pages were rendered and inspected,
alongside project/source/CSV and Canvas screenshots. Scientific metadata, native
MathML rendering and the table are readable; original host prose is absent.
A light gray background remains below the final print content and is a visual
follow-up, not a claim of complete print-template certification.

The continuation proceeds separately with local embeds, upstream numbering and
reference presentation, proof blocks, explicit contents and terminology. These
new stages are not covered by this checkpoint's acceptance. Existing execution,
external-service, native GUI and publication-toolchain boundaries remain.
