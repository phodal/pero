---
kind: issue
status: active
---

# Public paper sources lose version and reading representations

Review date: 2026-11-02. Scope: current literature adapters, saved snapshots,
discovery, and the handoff to existing reading/download owners. This review does
not implement the proposals below or establish live availability of all sources.
The arXiv reading/navigation repair is separately resolved in
[its incident record](2026-11-02-paper-arxiv-reading-navigation.md).

## Reproduced behavior

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

No provider policy, download authorization, network-address rule, local TeX
compiler, generic publisher crawler or new agent runtime was changed by this
review. Fixes remain proposed pending implementation.
