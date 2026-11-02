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

## Follow-up: proxy DNS and reading controls (2026-11-02)

The first browser verification used cached official bytes because the machine's
DNS returns proxy addresses (`198.18.*` / `2001:2::*`). The generic public-address
transport correctly refused them, but this also blocked fixed-version arXiv
review and the new import fallback in the user's actual network environment.

`OfficialArxivEndpoint` now recognizes official arXiv paper endpoints and
single-paper API queries. These endpoints use an existing configured HTTP
CONNECT proxy with normal target TLS verification. Other destinations and
redirects retain public-address pinning, request limits and type checks.
An injected transport still owns all fixture networking.

Actual production review of `https://arxiv.org/abs/2610.24007` now establishes v1,
then acquires official HTML and optional TeX through the production workers.
Receipt: `test-results/paper-arxiv-reading/live-result.json` (1,832 blocks,
explicit partial parse, two TeX members, `source_available`). The unchanged
13-page PDF also passes the 319 exact-window navigation checks.

The reader now has a compact title row and one tools row containing Text/PDF,
the original link, Format, page navigation and zoom. Format opens a compact
source review beside these controls. Preparation switches to Read; failures
remain visible above the PDF and retry the same approved source. Downloaded PDFs
recover their original link from their existing acquisition receipt.

Verification: 247 Python tests (246 passed, one platform skip), App TypeScript,
build, repository `npm run check` and whitespace checks pass. Real Electron
structured-reading and PDF journeys cover one-row controls, original links,
version review, preparation, acquisition-error retry, selection/zoom/page
retention and restart recovery. Synthetic sources/providers are explicit;
separate live production arXiv acquisition is recorded above. Browser checks
cover Chinese/English, light/dark and 489/1,280px widths. Evidence is under
`test-results/paper-source-fixes/`, `test-results/paper-structured-reading/fixture/`
and `test-results/paper-agent/`.

The currently running Native preview was not restarted or replaced. No local
TeX compilation, paid Agent execution or signed-package acceptance is claimed.
