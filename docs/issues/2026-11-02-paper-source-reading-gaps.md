---
kind: issue
status: active
---

# Public paper sources lose version and reading representations

Review date: 2026-11-02. Scope: current literature adapters, saved snapshots,
discovery, and the handoff to existing reading/download owners. This record separates initial reproductions, implemented repairs and remaining
proposals; it does not establish live availability of all sources.
The arXiv reading/navigation repair is separately resolved in
[its incident record](2026-11-02-paper-arxiv-reading-navigation.md).

## Initial reproduction (before repairs)

All cases below were executed with authored inputs at the existing HTTP fetch
seam. Receipt: `test-results/paper-source-review/reproductions.json`.
The existing eight literature tests also pass; their abstract-only expectations
do not cover the missing representation handoffs identified here.

| Priority | Source and trigger | Current result | Owning code |
| --- | --- | --- | --- |
| P1 | Open a bioRxiv URL explicitly ending in `v1`, while its DOI metadata contains v1 and v2. | `PaperIdentity.parse` strips v1; `read` selects the maximum version, returns v2 abstract, and saves no `sourceRevision`. Selecting an older version silently reads a newer one. | `literature.py`: `PaperIdentity.parse`, `LiteratureClient.read` |
| P1 | Import a Hugging Face/arXiv paper while alphaXiv's Markdown is absent. | Hugging Face maps to alphaXiv. An empty/404 Markdown response aborts before any official arXiv request or saved snapshot, so the new saved-paper HTML review cannot be reached. | `literature.py`: `PaperIdentity.parse`, `LiteratureClient.read`; `http.py`: `POST /api/papers` |
| P2 | Import a PubMed article with a PMCID. | `_pubmed` supplies `fullTextUrl`, but the snapshot omits it; search UI does not expose it either. The saved paper has abstract only and no way to prepare its known PMC representation. bioRxiv loses its supplied full-text URL at this same boundary. | `literature.py`: `_pubmed`; `model.py`: `PaperSnapshot.from_reading`; `ui-src/library.tsx` |
| P2 | Open an OpenAlex discovery result that has a direct OA PDF. | `_openalex` emits `pdfUrl`; `DiscoveryPaper.parse` and `reading` discard it. Ordinary OpenAlex import retains that same PDF, so discovery and search produce different capabilities for the same work. | `discovery.py`: `DiscoveryPaper` |
| P2 | Ask for full-text study of an uncached OpenAlex paper hosted by a general publisher. | The UI treats any `pdfUrl` as PDF capability, but `/api/research/prepare` calls `PdfFiles.download`, which permits only arXiv/bioRxiv/medRxiv. Approved general PDFs have a separate working acquisition owner. | `ui-src/index.tsx`; `http.py`: research prepare; `pdf_files.py`: `download`; `pdf_downloads.py` |
| P2 | OpenAlex's best OA location is HTML-only, while another repository location offers a PDF. | The adapter reads only one location's `pdf_url`; the known alternative PDF, landing page, license and representation version are omitted. | `literature.py`: `_openalex` |
| P2 | Import a `www.medrxiv.org/content/...` URL. | URL parsing rejects the host, despite the PDF downloader recognizing medRxiv. A bare `10.1101/...` DOI always takes the bioRxiv API branch and cannot select medRxiv. | `literature.py`: `PaperIdentity.parse`, `LiteratureClient.read` |

The PDF region fix is shared across providers once actual PDF bytes are saved;
these findings concern how the right bytes and versions reach that reader.

## Proposed order

Implementation on 2026-11-02 repairs the first two priorities and the supplied
PDF/full-text URL handoff, acquisition ownership and import grouping. The bioRxiv
repair now retains an explicitly requested revision, selects that exact metadata
record, and freezes its revision in the saved snapshot, including Research URL
inspection and commit. A missing requested revision fails rather than using a
later version. Hugging Face/arXiv fallback now retains usable alphaXiv text, or
saves official metadata as abstract-only when that text is unavailable. Other
representation metadata, XML parsing and medRxiv adapter work remain open.

1. Preserve explicit bioRxiv versions and distinguish bioRxiv/medRxiv identity.
   Keep work identity, requested revision and returned revision together; never
   replace a requested revision with `max(version)`.
2. Allow arXiv/Hugging Face discovery to save official metadata when alphaXiv text
   is unavailable, explicitly marking it abstract-only. This makes the existing
   fixed-version HTML/PDF review reachable without claiming a full-text read.
3. Retain provider-supplied representation candidates across snapshot/discovery
   persistence: URL, format, provider identity, revision and supplied license.
   Preserve old immutable records; do not re-hash or silently upgrade old evidence.
   Reuse the existing approved acquisition/receipt owners for selected candidates.
4. Add a PMC JATS reader and bioRxiv/medRxiv JATS reader for their official XML,
   adapting to the existing scientific-document IR. Show unsupported/partial
   structures explicitly and keep PDF page mapping independent. This is new
   implementation, not a delivered capability.

## Official-source checks

- [bioRxiv API](https://api.biorxiv.org/) documents separate `biorxiv` and
  `medrxiv` server parameters and returns version, license and JATS XML path.
  The current adapter consumes the abstract and builds an HTML link, but ignores
  that supplied structure and license information.
- [OpenAlex locations](https://help.openalex.org/data/locations/) distinguish
  primary, best-OA and other locations, with per-location format URLs, version
  and license. Those copies must remain distinct candidates, not an inferred
  identity equivalence or automatic transfer of download approval.
- [PMC Article Datasets](https://pmc.ncbi.nlm.nih.gov/tools/textmining/) lists
  current XML retrieval services. Its 2026 distribution migration is complete;
  the legacy [OA Web Service](https://pmc.ncbi.nlm.nih.gov/tools/oa-service/)
  was retired in August 2026. A new implementation must use the current services,
  not an `oa.fcgi` recipe from older documentation. Presence in PMC alone is not
  proof that an article belongs to the reusable dataset.

The repairs change source selection and import fallback. Provider policy,
download authorization, network-address rules, local TeX compilation and agent
runtime behavior remain unchanged. The other listed fixes are still proposed.

## bioRxiv version repair verification

2026-11-02: explicit v1/v2 requests, unversioned latest selection, unavailable
v3 and invalid v0/response versions are covered by the version-selection table.
Saved snapshots retain their revision across store reopen. Research URL
inspection uses the original versioned link and commits its selected revision.
The existing full Python suite passed 244 tests (243 passed, one Windows skip)
before the final inspection handoff change; the corrected handoff then passed
the literature and Research URL suites. Metadata and PDF byte receipts are
still distinct; no PDF is downloaded by this repair.

Live production-adapter reads of `10.1101/339747` established that explicit v1
keeps the original title and v1 URL, while an unversioned request selects the
officially returned v4 title/URL. Both have the same abstract digest in this
actual response, so the selected revision must remain part of snapshot identity.
Receipts: `test-results/paper-source-fixes/biorxiv-live-result.json` and the
Python logs in the same directory. Existing immutable snapshots are unchanged.
The PubMed/OpenAlex/medRxiv and structured XML proposals above remain open.

## Hugging Face/arXiv fallback verification

The existing alphaXiv text remains the saved full text when available. Missing,
blank or failed alphaXiv text can now fall back to official arXiv metadata with
`source=arxiv`, `contentKind=abstract`, the requested explicit revision when
present, and a visible abstract-only limitation. Missing official abstracts or
conflicting returned paper/version metadata cannot become a successful import.
Failed metadata still cannot erase usable alphaXiv text. The saved abstract
enters the existing fixed-version HTML review and immutable preparation owner;
it does not count as full-text evidence or authorize a file download.

Final verification on 2026-11-02:

- Full Python suite: 245 tests, 244 passed and one Windows-only skip.
  `test-results/paper-source-fixes/final-tests.log`.
- App TypeScript and whitespace checks passed.
- A simulated alphaXiv 404 plus an actual production-adapter HTTPS arXiv request
  imported the official abstract for `2610.24007v1`, retained its title/authors,
  and exposed the correct saved-paper review URL. This is a controlled failure
  test, not evidence that alphaXiv actually lacked that paper at the time.
  Receipt: `arxiv-fallback-live-result.json` in the same results directory.
- An isolated browser using the existing built App UI and current Python backend
  exercised the actual authenticated import handler from a Hugging Face URL,
  visible Abstract/limitation state, the source review and structured preparation.
  The source seam used cached official HTML/metadata bytes and a simulated
  alphaXiv failure; source acquisition was not a live production-transport test.
  Screenshots: `fallback-import.jpg` and `fallback-reading.jpg`; browser errors: 0.

The running Native preview was not replaced or restarted. This does not claim
new full-Desktop, signed-package, scientific or live HTML-download acceptance;
the later proxy-DNS repair and successful production HTML/TeX acquisition are
recorded in [the arXiv incident](2026-11-02-paper-arxiv-reading-navigation.md).

## Next repair scope (2026-11-02)

Implement in order: retain supplied PDF/full-text links across discovery and
saved snapshots; route full-text preparation through the existing approved PDF
acquisition/receipt owner; group only confirmed work/version representations in
Research URL review. Old immutable records and independent file grants remain
unchanged. Add fixture-backed end-to-end coverage before scoped commits.

Source-link retention verified: OpenAlex selects an available supplied PDF even
when its best OA location is HTML-only; discovery, favorites and snapshots retain
PDF/full-text URLs across store reopen. PubMed PMC and bioRxiv full-text links
survive actual adapter reads and snapshot persistence. Absent optional fields
stay omitted for old immutable identities. Focused discovery/literature tests,
App typecheck/build and the six-group Electron PDF journey pass; the UI original
link points at the saved full-text URL. No new XML parser or medRxiv adapter is
part of this increment.

Unified acquisition verified: full-text research and the legacy PDF command now
read integrity-checked saved originals only. Missing originals return a source
review recovery path; they cannot bypass PdfDownloads with a second downloader.
Ask first opens the existing Library review for missing PDFs, keeps the intended
research draft on confirmation, and resumes after the approved copy is saved.
Cancellation starts neither a download nor a Chat request. A synthetic generic
publisher PDF completes the actual Electron approval/acquisition/research flow:
zero fetches before confirmation and one total fetch after study finalization.
All 248 Python tests pass (one platform skip); three recorded-transport boundary
tests and the six-group PDF Electron journey pass. The obsolete direct PDF
network adapter and its injected fixture path are removed.

Version-grouped review verified: `ResearchResourceGroup` is a pure presentation
projection of the existing typed resources. Only explicit work identity plus
revision groups paper/PDF/source rows. Different or unknown revisions remain
separate; titles never establish equivalence. The row selects its references,
while each PDF/source keeps its original ID and independent grant. One official
HTML option represents the group's exact arXiv version. All original provenance
remains available in Source details, and checkbox names include the version.

Deterministic grouping cases and the eight-group Chromium journey cover distinct
versions, unknown identities, multiple file identities, independent selections,
exact submitted grant IDs and no acquisition on HTML-only permission. Actual
Electron journeys pass nine structured-reading and seven source-study groups,
including approved acquisition, failure/retry, source/image scopes, original-copy
export, annotations and restart. The six-group PDF journey covers the generic
publisher Ask preflight and cache reuse. Browser screenshots were inspected in
Chinese, light/dark and wide/489px layouts; no horizontal overflow was observed.
Evidence: `test-results/paper-source-fixes/`, `paper-structured-reading/fixture/`,
`paper-source-study/fixture/`, `paper-agent/` and `research-import/`.
These are authored offline sources/providers with real App/Host/Python/reader
components, not new public-source, real-model or installed Native acceptance.
