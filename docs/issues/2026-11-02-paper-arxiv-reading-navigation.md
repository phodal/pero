---
kind: issue
status: resolved
---

# arXiv reading from search and exact PDF navigation

An alphaXiv search opens an extracted-text snapshot without connecting the saved
paper to the existing official HTML/source review. The reading screen sends the
user to an unrelated import tab. TeX acquisition exists, but source archives are
read as inert source, not compiled into the structured reader.

On the user's saved Federation over Harness PDF (2610.24007), exact windows on
pages 3, 4, 7, 8, 11 and 12 fail navigation. PDFium's phrase search can return a
partial match for a multiline quotation beginning with whitespace. Comparing
that search result's prefix length cannot prove the requested text window.

Repair should map the saved exact text offsets to PDFium character indices and
verify the extracted window before producing rectangles. Connect search-paper
reading to the existing fixed-version source review and official HTML renderer;
keep source acquisition, immutable documents and evidence with their owners.

## Implemented

- `ArxivPaper` owns saved work/version matching, including conflicting snapshot
  identities. Search snapshots can use an independently reviewed fixed-version
  paper HTML resource; PDF resources still require their original receipt checks.
- Reading offers a compact source review for the current paper, HTML preparation
  and optional same-version TeX acquisition through existing import/download
  owners. References-only inspection downloads neither HTML nor archives.
  Retry refreshes metadata; a failed HTML preparation retains an approved retry.
- Exact PDF navigation translates extracted UTF-16 text positions to PDFium
  character indices and verifies the entire original window before highlighting.
- Reader grid columns can shrink below table minimum widths, so narrow windows
  wrap the body instead of clipping it.

## Verification (2026-11-02)

- App typecheck, UI build and whitespace checks passed. Full Python suite:
  243 tests, 242 passed and one platform skip. Use a canonical temporary path
  (`TMPDIR=/private/tmp`) on macOS; the default `/var/folders` symlink causes
  existing PC-Gym canonical-path checks to fail. The final version-conflict
  refinement also passed the 10 document/reading and 21 Library tests.
- The user's unchanged, saved 13-page PDF passed 319 exact 200-character windows,
  including the previously failing pages. A browser search for `server harness
  guide` opened page 3 with actual PDF highlight rectangles and no error banner.
- System HTTPS (`curl`, normal TLS verification) retrieved the official fixed-v1
  HTML and source archive. A disposable profile consumed those frozen bytes
  through the existing acquisition workers/parser/store: 1,832 structured blocks
  (partial parse explicitly reported), two TeX members, `source_available`.
  The browser exercised review/confirm, preparation, reload, chapter navigation,
  English/Chinese context, light/dark appearance and 489/1,280px widths.
- Evidence: `test-results/paper-arxiv-reading/` contains source bytes, Python log,
  navigation receipt and `reading-narrow.jpg`, `reading-dark.jpg` screenshots.

The default public-address transport could not perform a live inspection here:
the machine's DNS returns `198.18.*`/`2001:2::*` proxy addresses, which its existing
policy rejects. That policy was not changed. The browser run used explicitly
cached official bytes and a prepared review; it does not establish a successful
live inspection/download through the production transport. The currently running
Native preview was not restarted or replaced. No local TeX compilation, paid
Agent execution or signed-package acceptance is claimed.
