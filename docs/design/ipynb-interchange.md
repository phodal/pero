# Offline notebook interchange

The `ipynbDocument` SDK block persists only versioned original JSON source. Its frozen
nbformat 4 view is derived once at admission. Export without edits returns the exact
Unicode/CRLF JSON. Cell edits preserve string/array source shape and every unrelated
cell, ID, metadata, attachment, execution count, output and unknown field. Editing
code marks existing outputs stale; clearing them is a separate explicit transition.
No kernel, plugin, script, authored HTML or network resource executes.

Admission is limited to 1 MiB UTF-8 raw source, 1536 KiB escaped source scalar, 256
cells and JSON depth 64. The escaped limit leaves headroom beneath Notebook's 2 MiB
whole-document budget; the existing revision owner enforces that total independently.
Duplicate keys, invalid Unicode scalar values, non-finite and unsafe integral values
are rejected rather than silently changing them. Future block schemas remain readonly
with original-source recovery, not downgraded. File import decodes UTF-8 fatally.

The static preview uses the existing MyST parser and safe renderer for Markdown,
inert code/raw text, presentation-only MathML, bounded KaTeX and shared admitted
PNG/JPEG images. Unsupported MIME types and attachments remain in the original JSON
with diagnostics. Preview limits (65536 text characters, 16384 LaTeX characters,
128 outputs/rich values) have visible truncation notices, never data deletion.

MyST notebook fields are direct notebook metadata, not an invented `metadata.myst`
namespace. Only literal cell zero can provide first-cell YAML frontmatter. Its
normalized metadata overrides notebook metadata, then project defaults through the
existing upstream inheritance seam. Bibliography declarations apply to later cells;
one physical bibliography resource is read once. Headers and global citations are
rendered once per notebook rather than repeated per cell.

Static `remove-cell`, `remove-input`, `remove-output`, `hide-cell`, `hide-input`,
`hide-output`, `remove-stdout` and `remove-stderr` affect only publication projections.
Hide is omitted because a static artifact has no reveal control. Execution tags do
not grant permission to run code. Metadata/tag semantics are pinned to upstream
[jupyter-book/mystmd 50e8220](https://github.com/jupyter-book/mystmd/tree/50e82202324dc36f10bd04877d00016879da6f6e),
especially `packages/myst-cli/src/process/notebook.ts`, `process/file.ts`,
`packages/myst-frontmatter/src/utils/fillPageFrontmatter.ts` and
`docs/notebook-configuration.md`.

Scientific export uses a disposable typed publication projection, never a fake
Markdown source document. Its IPYNB recovery discriminator is mandatory. DOCX embeds
`pero/notebook.ipynb`; ZIP packages embed `notebook.ipynb`; text/XML exports identify
an inert IPYNB recovery record. These include the **full original source, including
removed/hidden content**. The UI must disclose this before scientific download.
HTML/print honor removal without embedding original notebook source. Unsupported
MIME losses are explicit. Repeated references to one admitted attachment share one
asset path while preserving placements; shared codecs bound placement/output bytes.

Validation: shared TS/Python fixture, actual revision-store tests, real editor and
UTF-8 importer tests, actual DOCX/ZIP/TeX/Typst/JATS artifact tests, and a CI-only
browser import/edit/save/reopen/export journey. Local browser acceptance is not
claimed; Chromium is not launched in the reconstruction environment.
