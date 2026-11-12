# Notebook derived source text

Notebook's explicit **Extract source locally** action reads bounded local source
files before a user selects an excerpt or sends text to a configured Host Agent.
It is not a second AI runtime or a scientific-verification service.

## Ownership and installation

- `source_extraction.py` / `@pero/notebook/source-extraction` own the retained
  receipt: original binary SHA-256 and byte count, extracted-text SHA-256,
  parser/version, extraction mode, Unicode codepoint spans, page/part/region,
  optional raw OCR scores, and explicit limitations.
- `source_parsers.py` performs local I/O through normal pinned Notebook App
  dependencies: pypdfium2 5.0.0, Pillow 12.0.0, python-docx 1.2.0,
  openpyxl 3.1.5, python-pptx 1.0.2. Host prepares these through the existing
  App environment flow. Parsing installs nothing and contacts no network.
- `source_parser_process.py` runs one short-lived parser using that same
  Host-managed Python interpreter and trusted local request/result files. The
  route waits at most 120 seconds, checks a 2 MiB output-file bound before
  reading it, and reports worker failure without running PDFium in the
  Notebook server process. On POSIX, timeout/failure cleanup kills the
  parser process group, including local OCR children.
- `packages/source-extraction/python/pero_source_tools.py` is the single shared
  owner of the existing Paper PDFium lock/loader and local Tesseract TSV parser
  and execution function. Paper's public `PdfFiles` / `NumericExtractor`
  contracts remain unchanged. `scripts/build/source-parsers.mjs` packages this
  module into each App's backend. Installed Apps never read another App's
  files or import a repository-relative fallback. The runtime CI archive
  requires these generated files.
- Tesseract and English `eng` trained data are system dependencies, not bundled
  models. When absent, extraction returns `parser-unavailable` with explicit
  setup guidance. It never silently switches to another provider or downloads
  models. Existing optional managed Docling layout remains owned by Paper and
  Host; Notebook does not reproduce its process/provisioning framework.

## Formats and bounded behavior

- PDF: one explicitly selected page, native PDFium text or explicitly chosen
  OCR. Native text has page provenance, not invented quote rectangles. OCR
  regions use normalized top-left coordinates after the same intrinsic PDF
  rotation normalization used by Paper.
- PNG/JPEG/WebP: explicit local English OCR, a single still image, at most
  6000 pixels per edge and 12 megapixels. Stored pixel orientation is used;
  EXIF orientation is not applied.
- DOCX: paragraphs and physical OOXML table cells, without expanding merged
  cell spans or duplicating merge-origin text. XLSX: stored cell values and
  formula source text, including array expressions at their anchor cells,
  never formula execution. What-if data tables and missing array expressions
  fail explicitly with instructions to export values or repair the formula. PPTX: text shapes and table cells.
  Part/cell/slide locations are retained. These parsers do not claim Word
  pagination, rendered regions, image transcription, notes, tracked changes,
  headers, footers, comments, charts or grouped-shape coverage. Legacy binary
  Office formats require explicit conversion first.
- The original attachment bound remains 512 KiB. Expanded OOXML is limited to
  32 MiB/4096 parts, workbooks to 100,000 visited rows and cells (including
  empty row gaps when optional dimensions are absent), source text to 128 KiB
  and 4096 source segments. Limits fail, never truncate.
- File/text/raster bounds do not by themselves cap PDF decompression. The
  Linux worker separately enforces a 512 MiB virtual-address limit per process
  (`RLIMIT_AS`), and POSIX output files have a 2 MiB `RLIMIT_FSIZE` limit. These
  are process-local limits, not system security settings or an aggregate
  memory budget across simultaneous requests. macOS and Windows have no
  enforced parser-memory cap here; that limitation is retained in every
  receipt. The parent still bounds its wait and result size on those platforms.
  Windows timeout cleanup terminates the direct parser, not an entire child
  process tree; Tesseract retains its own 60-second wait bound while its parent
  remains alive. No generalized sandbox or persistent parser runtime is added.
- OCR scores are uncalibrated engine outputs, not probabilities. OCR can misread
  tables, numbers, handwriting and symbols; the UI requires review against the
  original. Neither a valid hash nor a parser receipt authenticates the author,
  external origin or scientific claims.

## Retention and user interaction

UTF-8 source excerpts keep their prior byte-exact behavior. Derived excerpts
retain an optional receipt and hash the extracted text separately from the
binary original. Excerpt ranges count Unicode codepoints. Copies remap only
local attachment IDs. Original files are never modified. Removing an attachment
retains its selected quote, extracted text and receipt. Derived text downloads
use `.extracted.txt`, never the original binary file extension.

The whole-notebook attachment picker covers Notes and procedure editors.
Choosing a binary attachment shows parser controls; only the extraction button
calls the authenticated local route. Closed requests cannot insert content.
Local extraction itself does not invoke an Agent.

## Verification

A fresh isolated Python environment was installed using exactly the declared
Notebook pins. Original test fixtures generate PDF, DOCX, XLSX, PPTX and image
bytes without copied documents/assets. Native PDF and all three Office parsers,
real image/scanned-PDF Tesseract OCR, provenance/hash tamper rejection, retained
excerpt round-trip, missing-OCR behavior, and installed-App shared-module imports
pass. Existing Paper PDF/numeric extraction tests remain compatible. Further
regressions cover a billion-column DOCX merge span, dimensionless XLSX row gaps,
array formulas and explicit data-table rejection. Real contained native-PDF
expansion failure, a subsequent successful parse, ordinary Office and OCR
worker paths, result-size rejection, timeout cleanup and temporary-file removal
also pass. The same 400 MiB compressed-stream case was independently observed
returning a controlled error at the default 512 MiB worker limit, followed by a
successful ordinary request.

Commands:

- `node scripts/build/source-parsers.mjs`
- `NOTEBOOK_REAL_OCR=1 python -m unittest discover -s apps/notebook/test -p 'test_source*.py' -v`
- `node --test packages/notebook/test/source-extraction.test.ts apps/notebook/test/source-extraction-ui.test.ts scripts/build/source-parsers.test.mjs`

The React test drives actual production controls and obtains its response from
the real local PDF parser at the transport seam. It is not browser acceptance.
`source-extraction-browser-scenario.mjs` covers the actual authenticated parser,
selection, saved revision/reload and correctly named download, with light/narrow
screenshots. Browser execution is unverified here because the established local
Chromium socket EPERM prevents launch; no bypass or retry is claimed.
