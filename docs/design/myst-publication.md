# Bounded MyST scientific publication

The shared `DocumentExportFormat` seam supports string, binary and asynchronous
content. Existing string codecs keep their default type. Publication adapters
consume the compiled document, never re-read project files or execute code.

## SDK ownership and dependencies

DOCX uses official `myst-to-docx@1.0.18` and `docx@8.5.0`; LaTeX uses
`myst-to-tex@1.0.48`; Typst uses `myst-to-typst@0.0.40`. `unified@10.1.2`
invokes the public compiler plugins. The adapter's original docx 7 dependency
exposes CommonJS exports incompatible with its ESM imports and cannot share
private Word classes with a separate major. Scoped npm and pnpm overrides select
8.5.0 for this adapter only. A clean install and actual consumed APIs must be
verified together; npm's diagnostic against the upstream declared range does
not prove compatible runtime ownership by itself.

JATS is an explicit Archiving and Interchange 1.3 serializer. The upstream
myst-to-jats closure imports a citation engine with incompatible licensing; it is
not installed. This implementation does not claim to invoke that official SDK.
Actual browser-bundled closure and prebundled DOCX/JSZip dependencies have notices
in `apps/notebook/licenses/myst-publication-*.txt`; JSZip's MIT alternative is
selected. Existing baseline notices cover the shared parser/rendering closure.

## Source recovery and losses

Canonical MyST source recovery uses `exportMystBundle`, not expanded frontmatter
that could exceed the import budget after YAML alias expansion. Notebook-derived
AST has no fabricated Markdown source: the input union requires exact original
IPYNB recovery. DOCX stores `pero/source.json` or `pero/notebook.ipynb`; archives
store `source.json` or `notebook.ipynb`. XML and source comments carry explicitly
labelled source records. Hidden notebook content can remain in that full original
source, so publication UI must disclose this recovery attachment.

Unsupported nodes, missing assets, entry-only cross-document references,
metadata beyond title/author names/DOI, and native-format losses are explicit.
Styled CSL groups use one compiled occurrence text and ordered bibliography;
editable citation fields and rich citation formatting are not promised.

## Resource and execution boundary

Only explicit admitted PNG/JPEG bytes reach conversion. All formats share a pure
image budget pass before serializer or archive rewriting: at most128 placements
and16MiB decoded asset payload bytes, counted on every repeated placement. Excess
placements become visible missing-image placeholders and a diagnostic. This is
payload size, not decompressed pixel size; image admission owns pixel limits.
Archives contain only referenced admitted assets, renamed to assigned safe paths.

No CLI, kernel, templates, authored macros, arbitrary plugins, external resource
fetches or TeX compiler are invoked. Executable TeX math uses a small command
allowlist and rejects `^^` preprocessing escapes. Unsupported math remains literal
source. Typst replaces the upstream tablex remote import with a native table macro.
Generated TeX/Typst source and archives are not claims of compiled PDFs.

DOCX equations use trust-disabled, bounded KaTeX MathML parsed by xml-js1.6.11,
then native docx script/fraction/radical objects. Unsupported structures, including
accents/matrices, become literal text with an exact loss. Math font/spacing and
stretchy delimiter normalization are disclosed. No authored XML is parsed.

The existing Notebook print owner has a dedicated publication region with no
source editors or cropped preview iframe. It calls `window.print`, supports cancel
and afterprint cleanup, and is labelled browser-mediated Save as PDF, not a direct
programmatic PDF download.

## Reconstructed verification

The rebuilt code has fresh real-artifact tests: deterministic DOCX ZIP/XML and
native math, exact PNG bytes, tables, literal hostile math fallback, XML parsing,
three actual offline archives, repeated/distinct image budgets, exact notebook
recovery, alias-heavy canonical recovery, CSL groups and reviewed text goldens.
The scientific XML fixture was validated against the official NLM Archiving1.3
RELAX NG closure. This validates the fixture, not every possible document.

Fresh LibreOffice opened the reconstructed DOCX and rendered its one-page PDF.
The screenshot was inspected: superscripts/subscripts, fraction and square root,
raster, table, headings and list are readable. Native Microsoft Word is unverified.
No generated TeX or Typst compilation was performed.

The browser CI test exercises real download actions, the production print region,
screenshot, actual PDF bytes, page count/text, source exclusion and afterprint
cleanup. Local Chromium was not run because its earlier environment launch was
denied; browser acceptance requires the CI result. Prior vanished-workspace test
results are not evidence for this reconstruction.
