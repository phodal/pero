---
kind: verification_report
status: partial
date: 2026-11-11
github_issue: 195
github_state: open
github_url: https://github.com/phodal/pero/issues/195
---

# Source-backed MyST documents on PR #196

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

## Current functional gaps after the text-project slice

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

- `npm test --workspace @pero/notebook`: **210/210 passed**.
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
