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

Final integration preserves concurrent base `5891fcab` (verified as an ancestor),
including its generic document-block SDK. The original `d65e798c` comparison above
remains the before-task baseline, not the current integration base.

## Implemented vertical slice

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
  mappings are retained, but typed scholarly frontmatter is not yet validated.
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

## Verification scope

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
  Its fixture and JavaScript syntax checks passed. CI writes
  `myst-document-publication.png` beside the existing Notebook evidence.
- Local Chromium cannot start because this container denies its singleton Unix
  socket. That outcome was already checked, including an approved elevated
  attempt; it was not retried or bypassed. Browser checks and screenshots require
  the actual PR CI. No browser, Electron, Native or Wasm acceptance is inferred
  from the package tests or build.

- Bazel `//:checks`: normal lock refresh passed all 7 checks. The frozen-lock
  `--config=ci` run passed all 7 checks again after the rebase (cached, exit 0).
  These checks cover schema, TypeScript, locale and theme consistency, not browser
  acceptance.

Remote CI remains pending and must be checked against the published head.

## Still open

Project loading and `myst.yml`, explicit assets/includes, cross-document references,
standard BibTeX/CSL resolution, typed scholarly metadata, lossless `.ipynb`
interchange, site publishing and JATS/DOCX/TeX/PDF adapters remain open. Jupyter
and reactive execution require a separate owner/permission design and stay off.
These are functional gaps, not hidden successful paths or stub implementations.
