# MyST capability boundary

Status: the published text-project baseline is `20367200`. The scientific
workflow continuation below is implemented through the existing document SDK;
its final integration and browser acceptance are tracked in the
[verification report](../issues/2026-11-11-myst-document-verification.md).
This is not a claim of complete MyST CLI or Jupyter Book parity, and does not
close the broader [#195](https://github.com/phodal/pero/issues/195) roadmap.

## Architecture and upstream contract

`defineDocumentBlock`, `documentBlockNode`, shared field validation and the
Notebook revision owner remain the only document registration/edit/persistence
path. Source is authoritative; parser AST, rendered publications and previews
are disposable projections. Unknown future schemas remain opaque/read-only
with original recovery. Code and imported recorded outputs never execute.

The source audit uses pinned MyST commit
[`50e82202324dc36f10bd04877d00016879da6f6e`](https://github.com/jupyter-book/mystmd/tree/50e82202324dc36f10bd04877d00016879da6f6e),
not an unversioned claim about the latest upstream. Its parser is `1.7.5`,
frontmatter `1.10.2`, DOCX adapter `1.0.18`, TeX adapter `1.0.48` and Typst adapter
`0.0.40`. MyST AST specification `0.0.6` describes nodes, not execution or the
full compiler. See the official [AST primer](https://mystmd.org/spec/ast-primer).

The official parser may preserve an unknown directive in `mystDirective.value`
but discard invalid known-directive children in a `mystDirectiveError` result.
Consequently no transformed AST replaces authored source during an unrelated
Notebook edit. Known/unknown/malformed directives and nested source survive
source, bundle and revision roundtrips. Unsupported display semantics are
reported rather than claimed as implemented.

## Traceable capability matrix

Upstream source links below use the same pinned source tree.

| Capability | Implemented contract | Remaining boundary / upstream reference |
| --- | --- | --- |
| Source and prose | Source editing/import/export; headings, lists, tables, roles, admonitions, footnotes and explicit diagnostics; unknown source retained. | Not every MyST role/directive has native presentation. [Syntax](https://github.com/jupyter-book/mystmd/tree/50e82202324dc36f10bd04877d00016879da6f6e/docs) |
| Math and local references | Safe MathML preview, labeled equations/figures/tables, local target numbering and links. | Duplicate/missing targets diagnose rather than guess; no arbitrary TeX execution. [Math](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/math.md) |
| Scholarly metadata | Official frontmatter validation/inheritance; authors, affiliations, ORCID, DOI, dates, licenses, funding. Raw metadata retained. | No network identity/DOI validation; unsupported metadata does not disappear from recovery. [Frontmatter](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/frontmatter.md) |
| Project snapshots | Explicit versioned local text/binary resource snapshot; resource selection, editing, save/reopen and exact download. | No directory traversal, filesystem discovery or automatic downloading. [Configuration](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/configuration.md) |
| Includes | Recursive local include/literalinclude from provided text, provenance, line/marker selection, cycle and expansion limits. | Missing, unsupported or over-budget inputs retain source and diagnostics. Parsed IPYNB includes are not silently flattened. [Includes](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/embed.md) |
| Cross-document links | Explicit path/label and unambiguous project labels, notebook cell targets, per-page numbering and self-contained internal HTML links. | Remote inventories, external projects and global book numbering are not implemented. Hidden notebook cells cannot supply visible targets. [Cross-references](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/cross-references.md) |
| Table of contents | Explicit supplied-file ordering, nested title groups, navigation title overrides, hidden-but-linkable pages, and project/children/page/section TOC lists with depth limits. | No filesystem discovery, glob expansion, external URL TOC entries, website search or navigation service. Hidden/unlisted pages do not contribute to the exposed numbering order. [TOC](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/table-of-contents.md) |
| Figures/assets | Explicit original binary preservation, bounded PNG/JPEG previews, real image bytes in exports. | SVG/HTML and unsupported types remain inert/recoverable. Structural admission is not complete image decoding. [Figures](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/figures.md) |
| CSV tables | Bounded inline and supplied-file CSV through the official directive converter, with captions/headers/quoted cells. | Local `:file:` is an explicit Pero extension: the pinned upstream file option is not active. No spreadsheet execution. [Tables](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/tables.md) |
| Bibliography | Explicit local BibTeX/CSL-JSON parsing, provenance, complete CSL records, duplicate/missing-key diagnostics. | Parser format autodetection and URL retrieval disabled. [Citations](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/citations.md) |
| CSL formatting | Real pinned RefKit/Hayagriva Wasm, APA or supplied custom CSL, grouped/narrative/numeric citations and one notebook-wide citation history. | Explicit `pero.citation` extension, not native MyST configuration. Note-style placement/custom locale loading/prefix-suffix parity remain unsupported and diagnosed. See [CSL contract](myst-citations.md). |
| IPYNB | nbformat 4 original JSON, cell edits/addition/output clearing, metadata/unknown fields/attachments/MIME retention; outputs marked stale after code edits. Safe recorded previews and static remove/hide tags. | No kernel, widget runtime or imported script execution. Untouched JSON is exact; edited JSON may change whitespace. [Upstream notebooks](https://github.com/jupyter-book/mystmd/blob/50e82202324dc36f10bd04877d00016879da6f6e/docs/execute-notebooks.md), [Pero interchange](ipynb-interchange.md) |
| HTML/project publication | Inert self-contained whole-project HTML, internal navigation, shared metadata/citations/assets and sandboxed preview. | Not the themed MyST website builder/search/deployment service. No site deployed. |
| Word | Actual official adapter and DOCX bytes, metadata, tables, raster, citations and editable native common algebra/fractions/roots/scripts. | Unsupported math/layout explicitly loses presentation and retains literal/source recovery. Actual LibreOffice rendering is not native Word acceptance. See [publication](myst-publication.md). |
| JATS | Bounded direct scientific XML serializer with MathML, references, assets and complete recovery. A scientific fixture validates against official Archiving & Interchange 1.3. | Not a claim that all inputs meet every JATS profile; no fabricated journal metadata. Official MyST JATS dependency closure was not adopted because of incompatible citation licensing. |
| TeX/Typst | Actual pinned official source adapters; offline ZIP assets/recovery/loss reports; restricted inert TeX command subset and native Typst tables without remote imports. | No arbitrary source compilation, external templates or toolchain installation. Format-specific losses are explicit. |
| PDF/print | Existing Notebook print owner displays a dedicated publication-only surface and invokes browser printing; CI inspects real PDF bytes/text/pages. | Browser-mediated PDF, not a TeX/Typst PDF compiler; current browser acceptance must be read from the verification report. |
| Execution/plugins/reactive | Source retained and execution boundaries diagnosed. | Kernels, executable plugins and reactive computation stay disabled; they need their own owner/permissions/runtime design. [Execution](https://github.com/jupyter-book/mystmd/tree/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-execute), [reactive](https://github.com/jupyter-book/mystmd/tree/50e82202324dc36f10bd04877d00016879da6f6e/packages/myst-ext-reactive) |

## Admission and recovery limits

- MyST document source: 256 KiB UTF-8; invalid Unicode scalar text is rejected.
  The source bundle contains only authoritative source, not alias-expanded AST
  or metadata that could exceed its own import budget.
- Project block schema 1: text envelope v1, or v2 with explicit binary assets.
  At most32 combined resources, 256 KiB per text/decoded asset, 1 MiB total text,
 8 MiB pre-read input, 1536 KiB escaped persisted snapshot contribution. Notebook
  total remains 2 MiB. Canonical paths reject collisions, root escapes and schemes.
- PNG/JPEG dimensions: 4096 per side and 16 megapixels. Scientific export separately
  limits 128 image placements and 16 MiB decoded placed bytes, counting repeats.
  Excess placements become diagnosed placeholders without altering source.
- Includes: depth 12, count 128,1 MiB total expansion including repeated resources.
  Parsed selections also obey the parser's 256 KiB input bound; overflow retains
  the directive rather than aborting the entire project.
- CSV: 1000 rows, 64 columns, 16 KiB cells, 64 KiB records; page totals 64 tables,
 1 MiB CSV input and 10000 cells. See [resource graph](myst-resource-graph.md).
- IPYNB: 1 MiB JSON, 1536 KiB escaped contribution, 256 cells, depth 64. Duplicate
  keys, unsafe integer values, invalid scalar text and non-string cell types
  reject at the boundary. TS/Python agree on integral JSON numbers.
- CSL inputs and engine calls are bounded, but synchronous formatting has no
  hard deadline. Unsupported formatting remains a diagnosed fallback.

Scientific DOCX/ZIP and explicit text/XML recovery include the complete original
source. The UI warns that this includes content hidden/removed from the visible
notebook publication. Body renderers omit hidden cells and editor comments;
HTML/print do not embed the original notebook. Imported outputs remain recorded
content, not new evidence of execution. Source recovery must not be shared as
though it were redacted output.

## Dependencies, licensing and acceptance

All new dependencies are exact pins, including `docx@8.5.0`, `jszip@3.10.1`,
`buffer@6.0.3`, `unified@10.1.2`, `xml-js@1.6.11`, `csv-parse@5.6.0` and
`refkit-js@0.4.0`. Scoped npm/pnpm overrides align the official DOCX adapter with
8.5.0. Clean dependency installation and real artifact tests establish the
actual resolved graph; the upstream adapter's declared 7.x range alone does not.

Actual licenses are staged through the App's existing notices path. RefKit's
Rust/Wasm release, 89 registry checksums and pinned Git sources are re-audited;
CSL styles/locales have separate CC-BY-SA 3.0 notices. No CPAL/AGPL citation engine
is introduced. See the detailed [citation audit](myst-citations.md) and
[publication audit](myst-publication.md), rather than inferring closure rights
from a top-level MIT label.

Acceptance requires shared wire fixtures, revision tests, package/editor/backend
checks, type/build/frozen generated checks, actual offline browser journeys and
inspected screenshots. Builds and unit tests do not establish Native/Electron,
Word, browser or arbitrary publication-template acceptance. No PR merge or
website deployment is performed by this continuation.
