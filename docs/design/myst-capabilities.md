# MyST capability boundary and implementation roadmap

Status: bounded document implementation present; full validation ongoing, audited 2026-11-11. This is not a claim of full MyST compatibility.

The request to add MyST capabilities extends the deliberately narrow projection in
[#195](https://github.com/phodal/pero/issues/195) and [#196](https://github.com/phodal/pero/pull/196).
It does not silently complete #195 phases B/C, replace Tiptap, or authorize a new kernel.
The prior implementation baseline below is PR head `d65e798c740d49ceb3132c853e54304c4f1adf57`.
Current-task implementation and acceptance must be reported separately from that baseline.

## Verified upstream and API

All upstream links below are pinned to MyST source commit
[`50e82202324dc36f10bd04877d00016879da6f6e`](https://github.com/jupyter-book/mystmd/tree/50e82202324dc36f10bd04877d00016879da6f6e).
These are versions read from package manifests at that commit, not a claim that they are latest:

| Package | Version | Responsibility |
| --- | --- | --- |
| `myst-parser` | 1.7.5 | Markdown tokenization, directives and roles into MyST AST |
| `myst-spec` | 0.0.6 | AST types; not a compiler or runtime |
| `myst-frontmatter` | 1.10.2 | Frontmatter types/validation |
| `myst-cli` | 1.12.0 | Project processing, transforms and build orchestration |
| `myst-to-docx` | 1.0.18 | Word rendering |
| `myst-to-tex` | 1.0.48 | TeX rendering |
| `myst-to-jats` | 1.0.37 | JATS rendering |
| `myst-execute` | 0.5.0 | Jupyter execution and output caching |
| `myst-ext-reactive` | 1.0.10 | Reactive syntax nodes; not itself a reactive runtime |

Manifests are under `packages/<package>/package.json` in the pinned tree. Each lists
MIT. The root [MIT license](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/LICENSE)
requires retaining its copyright and permission notice in copies/substantial portions.
Transitive dependencies and export templates have their own licenses to verify when shipped.

The verified parser entry point is
[`mystParse(content, opts?)`](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-parser/src/myst.ts).
Options include `vfile`, `markdownit`, `extensions`, `mdast`, `directives`, and `roles`.
It returns the parsed tree and supports `VFile` diagnostics; `mystParser` is its unified-plugin form.
Parsing is not project compilation: bibliography lookup, cross-document target resolution,
asset collection, export templates and execution are separate responsibilities.

Important source-over-README distinctions:

- The parser source enables colon fences, frontmatter, math, footnotes, citations,
  definition lists, task lists and tables. Its README's old “not yet complete” list
  includes features now present and is not the acceptance checklist.
- `markdownit.html` defaults to `true`. Rendering parsed nodes as raw HTML is not safe
  merely because the parser is official. Preview/publication rendering must remain inert.
- [`myst-ext-reactive/src/index.ts`](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-ext-reactive/src/index.ts)
  emits `r:range`/`r:dynamic`/`r:display` and `r:var` nodes, including expression strings.
  Preserving these nodes must not evaluate those strings.

## Capability matrix

“Current work” describes code inspected in this working tree, not completed cross-surface acceptance.
The durable Notebook JSON and existing revision owner remain canonical. Source bundles
are not a declaration that arbitrary MyST AST can be edited losslessly as Tiptap blocks.

| Scientific capability | Upstream evidence | Before this task | Current work and remaining boundary |
| --- | --- | --- | --- |
| Markdown, directives, roles, nested prose | [Parser source](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-parser/src/myst.ts) | Only own projection of paragraph/heading/code plus bold/italic/code. No source parser. | Implemented official `myst-parser@1.7.5`, source-backed derived AST/diagnostics, and bounded Notebook import/edit/export. Unsupported constructs stay recoverable, not silently flattened. |
| Equations, labels and numbered cross-references | [Cross-reference docs](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/cross-references.md) | `crossReference` shape did not supply a resolver or equation renderer. | Implemented KaTeX MathML (`trust: false`) and bounded single-document labeled targets/numbering, including missing/duplicate diagnostics. Cross-document resolution and upstream numbering equivalence require later project compilation. |
| Figures, captions, images and scientific tables | [Figures](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/figures.md), [tables](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/tables.md) | Notebook tables existed, but projection deliberately withheld formula and typed measurement tables. | Implemented supported AST figure containers, captions and tables. Images are link/alt-text placeholders, not embedded assets; relative image paths are not activated. A MyST table is not a unit-aware measurement table or spreadsheet; preserve existing scientific blocks and report export loss. CSV/file-backed directives need explicit asset resolution. |
| Bibliography and citations | [Citations](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/citations.md) | Cite identifier was explicitly not a Pero owner record; snapshots/references withheld. | Implemented citation syntax and simple key-linked previews from authored `pero.bibliography` entries, plus a local references list. This namespaced extension is not standard MyST bibliography input, a BibTeX reader, CSL validation or a CSL style engine. Full BibTeX resolution, standard citation styles and DOI metadata retrieval remain absent. Do not pretend parsing a cite resolves it. DOI and remote bibliography lookup can cause network access. |
| Scientific frontmatter | [Fields](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/frontmatter.md), [configuration](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/configuration.md) | No MyST document metadata pipeline. | Implemented source retention and JSON-portable YAML mapping extraction with duplicate-key, custom-tag, invalid-input and alias safeguards. Typed authors, affiliations, DOI, funding, licenses and project/page merge semantics require explicit validation and export tests; arbitrary YAML retention is not full metadata support. |
| Markdown and AST exchange | [Parser](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-parser/src/myst.ts), [export docs](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/documents-exports.md) | Own small AST-shaped projection only. `restoreMyst` was not a general upstream importer. | Implemented exact source download and version-1 `pero-myst` JSON bundle containing source plus derived metadata/bibliography/diagnostics, not AST or assets. Import trusts only source and rederives projections. Unsupported syntax stays in source. Invalid/future block versions are not editable as version 1; this is not arbitrary AST or future-schema import compatibility. |
| `.ipynb` input and existing outputs | [Execution docs](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/execute-notebooks.md), [notebook metadata](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/configuration.md) | No MyST notebook import. | Separate future importer/exporter acceptance: preserve cells, IDs, metadata, attachments and MIME output bundles; sanitize rendered output. A Markdown code fence is not a lossless notebook. |
| HTML publication | [Static HTML build flag](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/execute-notebooks.md) | No MyST publication path. | Implemented bounded standalone inert HTML download and sandboxed iframe preview, with CSP, escaped authored HTML, no scripts and no automatic resource fetches. It is not the MyST website builder, interactive theme, search/index, or multi-page site pipeline. |
| JATS, DOCX, TeX and PDF | [Export formats](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/documents-exports.md), [JATS](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/creating-jats-xml.md), [static export caveats](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/quickstart-static-exports.md) | No MyST converters. Existing Notebook print does not establish MyST PDF export. | Planned explicit build adapter. Pin templates and toolchains, collect assets, report diagnostics and output provenance. PDF needs a TeX/Typst toolchain; exporting print formats can lose semantic metadata. DOCX/PDF output does not imply equivalent input support. |
| `myst.yml`, multiple pages, includes and assets | [Configuration](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/configuration.md), [include/export docs](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/documents-exports.md) | No project loader or MyST asset graph. | Planned project boundary: root-relative paths, explicit imported files, missing include/asset diagnostics and reproducible bundled resources. Retaining include syntax is not resolving it. No automatic remote downloads or executable plugins. |
| Jupyter execution and caching | [Execution](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/execute-notebooks.md), [execute package](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-execute/README.md) | Not embedded; owner execution elsewhere in Pero. | Off. Upstream execution is also disabled by default; `--execute` starts/uses Jupyter, runs cells and inline expressions, and caches outputs. Future opt-in must use Host authorization, explicit environment/input versions, cancellation and provenance. Cache reuse is not proof of a reproducible scientific result. |
| Reactive expressions and in-page computation | [Reactive source](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-ext-reactive/src/index.ts) | Not embedded. | Preserve inertly; no automatic recomputation, script execution or second kernel. Changes may mark results stale, never implicitly launch HPC or paid models. |

## Implemented document workflow and exact boundaries

The current package manifest pins `myst-parser@1.7.5`, `katex@0.16.22`,
`vfile@5.3.7` and `yaml@2.8.3`; it does not install the MyST CLI, execution engine
or export converters.

The inspected implementations are [`myst.ts`](../../packages/notebook/src/myst.ts),
[`myst-render.ts`](../../packages/notebook/src/myst-render.ts),
[`myst-document.tsx`](../../apps/notebook/ui-src/myst-document.tsx), and
[`myst_document.py`](../../apps/notebook/backend/myst_document.py).

- A `mystDocument` block stores `schemaVersion: 1` and authored `source`, with the
  existing block identity and Notebook revision ownership. Both language boundaries
  enforce the 256 KiB UTF-8 source limit. AST, targets and diagnostics are derived,
  not a second durable document or accepted imported AST.
- The UI appends `.md`, `.myst` or `.myst.json` as a new block. Existing Notebook
  content is retained; insertion is a draft until saved. The block has a source
  editor, diagnostics, sandboxed preview, and separate source/bundle/HTML downloads.
  Editing respects the editor's readonly state. Unsupported block schemas expose
  readonly source and source download instead of treating them as editable version 1.
- The JSON bundle has format `pero-myst`, version 1. Its source is authoritative.
  Import does not trust supplied metadata/bibliography/diagnostics; parsing rederives
  them. It carries neither resolved project assets nor the rest of the Notebook.
- Local citation preview is an explicitly Pero-specific convenience. For example:

  ```yaml
  pero:
    bibliography:
      - id: smith2024
        author: Alice Smith
        title: Example authored reference
        year: 2024
        url: https://example.org/paper
  ```

  `@smith2024` can link to that authored entry. A few CSL-like author/date fields are
  tolerated for convenience, but this is neither complete CSL input support nor a
  formatting processor. References are marked as authored, not externally verified.
  Standard `bibliography` file paths and cross-project `references` produce a
  diagnostic and are not loaded. No DOI metadata is fetched.
- The renderer supports a bounded subset of parsed prose, admonitions, lists,
  tables, captions, math, local labels and citations. It retains unknown/disabled
  source with visible diagnostics. Includes, CSV-file tables, raw directives,
  widgets, code cells, embeds, executable plugins and reactive evaluation remain off.
- Standalone HTML means a downloaded local document with inline styles and MathML,
  not a deployed website. Images remain links/placeholders; no relative or remote
  asset bundle is produced. There is no MyST theme/site pipeline, multi-page
  publishing, Notebook-to-MyST conversion, `.ipynb` conversion, or JATS/DOCX/TeX/PDF
  export. Browser print is not a separately validated PDF publishing adapter.

Package/test additions are implementation evidence, not a claim that all tests or
browser/Native/Electron/Wasm acceptance have passed. The task's final verification
report must record actual completed checks and any failures separately.

## Phased acceptance

1. **Document foundation (current implementation):** official pinned parser;
   source-backed derived AST and diagnostics; versioned source/metadata/diagnostics
   bundle (no AST or assets); durable Notebook block; editor import and export; inert
   scientific preview and standalone HTML download. Test malformed input,
   unsupported nodes, source save/reopen, readonly handling, download contents,
   unsafe HTML/links and execution remaining off. Record exact installed versions.
2. **Project and scholarly resolution:** `myst.yml`, explicit assets/includes,
   frontmatter validation/merging, BibTeX/citation styles, multi-document references,
   and `.ipynb` exchange with existing outputs. Use upstream fixtures plus real
   multi-file articles, including unresolved references and missing resources.
3. **Publication adapters:** explicit reproducible JATS/DOCX/TeX/PDF builds, pinned
   templates, artifact downloads and truthful loss reports. Validate scientific
   metadata/citations and inspect rendered results, not just file extensions.
4. **Optional execution:** only after a separately accepted owner/permission design.
   Jupyter environments, resource limits, cancellation, cache provenance and stale
   inputs must have end-to-end acceptance. Reactive execution remains a separate
   decision; parsing its syntax is not a reason to enable it.

A passing package test is not browser, Electron, Native or Wasm acceptance. Each
surface must have its own observed evidence. Do not mark this matrix complete from
shape compatibility, successful bundling, or the upstream project's feature list.

## Baseline CI evidence, separate from new MyST work

[Run 42930515786](https://github.com/phodal/pero/actions/runs/42930515786) was verified
against head `d65e798c740d49ceb3132c853e54304c4f1adf57` (`pull_request`).
The Notebook and Canvas jobs completed by 2026-11-11 00:24:11 UTC; other jobs were still running at inspection:

- [Notebook job 130227987709](https://github.com/phodal/pero/actions/runs/42930515786/job/130227987709): document/formula/XLSX/Agent revision step failed;
  typecheck succeeded. Completed logs show editor tests 88 passed / 2 failed (Notes
  title expectations in `procedure-workspace.test.ts` and `source-excerpt-ui.test.ts`).
  Browser tests were 3 passed / 1 failed: `scientific-block-browser.mjs:109` timed out
  waiting for “Accepted as revision 2. The previous revision is unchanged.” This is
  a failed acceptance-feedback check, not successful reference-review UI acceptance.
  The [uploaded artifact](https://github.com/phodal/pero/actions/runs/42930515786/artifacts/13816262284)
  contains 54 files (6,391,792 bytes); its contents were not visually inspected in this audit.
- [Canvas job 130227988042](https://github.com/phodal/pero/actions/runs/42930515786/job/130227988042): failed during build preparation, before real Host/browser acceptance.
  Retrieved logs show `nightly-2026-10-28` auto-installed, then `E0463: can't find crate
  for core` with `wasm32-unknown-unknown` target missing at 00:22:54 UTC. Host build and
  browser verification were skipped. Artifact upload reported no files in
  `test-results/notebook-canvas/`. This run supplies no Canvas visual acceptance.

No workflow files were changed for this audit. Recheck the overall run before claiming final CI status; this historical snapshot is not the new implementation's validation.
