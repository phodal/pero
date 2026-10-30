# Paper Agent

Paper research in Pero: collect sources, read the exact saved text, freeze a
question and selected papers, run the existing Host Agent, then review cited
reports and reported experiments together. The Python domain implementation
ports Point Paper Agent's snapshot, evidence and report rules. The UI is a new
Pero App implementation using the shared SDK.

## Try it

Use Python 3.10 or newer. From the repository root:

```sh
npm run dev:paper
```

This builds and opens an isolated development profile at
`target/apps-preview-paper-agent`. Open **Add papers** to search alphaXiv,
OpenAlex, bioRxiv or PubMed, read a supported ID/URL, or import text/Markdown or a local PDF. A PDF can also
be dropped into the App; importing opens the saved original in reading mode. Identical
PDF bytes reuse the existing paper, regardless of filename.
Open a paper to enter reading mode. The top bar contains Back, title, PDF
navigation, zoom and **Ask**. Opening the App never starts research.

Existing profiles discover new bundled Apps at startup and when entering or
refreshing Apps. A bundled App already in the managed directory is replaced
when its package changes; its enable state and domain data stay, and an
explicit uninstall stays uninstalled. External packages can be added through
**Apps → Install from folder**, then enabled. Domain data lives in
Host-managed `app-data/paper-agent` and survives disable, uninstall and
reinstall. The App uses the shared Python environment; see
[Python environment settings](../README.md#python-environments). The workbench
prepares `~/.pero/environment/pero-default` and installs the pinned PDF
packages there. To install them yourself:

```sh
"$HOME/.pero/environment/pero-default/bin/python" -m pip install ./apps/paper-agent
```

The PDF backend uses `pypdfium2==5.0.0` and `Pillow==12.0.0`. Reading text,
discovery and existing reports remain available if PDF dependencies are missing;
opening a PDF shows the installation command. The Host does not install packages.

## PDF reading

Open an arXiv or bioRxiv/medRxiv paper. The App downloads the
original (up to 16 MiB / 500 pages), saves its SHA-256 and renders the saved bytes
with EmbedPDF/PDFium. WASM is bundled locally and external font fallback is off.
Select text to highlight or attach it to a question. The PDF context menu
(right-click or Shift+F10) offers **Capture area**, **Annotations**, page text and
text view and download of the original PDF. Annotations retain quotations, notes, images and copy/download.
**Add to matrix** places a saved annotation under a named comparison field.
The matrix's page links return to the exact saved PDF and region after restart.

Annotations are sidecar records; the original PDF is retained unchanged. Both
engines use unrotated page coordinates with a top-left origin, stored as page
fractions. Text highlights are checked against that PDF page (ignoring whitespace);
figure captures are rendered by the backend from the saved original. These checks
establish source location, not scientific validity. Repeated report quotations
offer each matching page rather than silently selecting one occurrence.

Choose **Ask** to open a conversation beside the PDF; close it to return to
full-width reading. Cmd/Ctrl+J toggles the panel. Page, zoom, scroll and selection
are retained; on narrow screens the Agent overlays the document. Ask a question
about the saved full text. One Host Agent session uses the declared
`research-step` App tool to inspect the page catalog, read original pages,
search frozen PDFs, save findings and update unresolved gaps. It can follow a
missing method or table back to its page instead of stopping after two searches.
The domain ledger saves observations with exact passage IDs; the last of its
24 research steps is reserved for submitting the report. Existing observations
can be recalled without consuming new research steps. Reading pages is bounded
and returns an explicit continuation offset when text remains. Clicking a citation opens the saved
PDF version, scrolls to the quotation and highlights its text rectangles.

**Research settings** contains source selection, **Search full PDF text**,
code verification and Agent selection. Full-text questions support 1–5 papers;
their PDF versions and the exact initial prompt are frozen before execution.
This mode requires an Agent with HTTP MCP support. Final citations must match
passages observed in the study; returning JSON in chat alone does not save a
report. Unfinished studies can be reopened; **Continue research** explicitly
starts a new Host request with the saved evidence and gaps, using the selected
Agent. A running Host request is reattached without replay. Unresolved gaps stay
visible in saved reports and exports. Library search and frozen-PDF study search
fuse SQLite FTS5/BM25 with vectors from a local Qwen3-Embedding-0.6B model when
that model is available (`PERO_EMBED_MODEL`, `~/.pero/models/qwen3-embedding-0.6b.gguf`,
or `~/.kiro/crew/models/qwen3-embedding-0.6b.gguf`, plus `llama-cpp-python`).
The vector leg uses the same original slices and page locators. Set
`PERO_APP_INFRA_EMBED=0` to keep keyword ranking. Missing hits do not prove
absence from the paper. This mode studies selected saved PDFs; external literature discovery remains a
separate library workflow. OCR and automatic figure recognition are not included.
Existing abstract/text snapshots remain unchanged. Ordinary research still uses
those snapshots unless full-text retrieval is selected.

## Search saved sources

The library's **Search saved text** searches titles, saved source text and the
latest downloaded PDF revision for each snapshot. It runs entirely in the
existing authenticated Python App backend; searching never starts an Agent or
queries a public literature service. Results retain the source kind, snapshot
text digest, PDF file digest, page or Markdown heading, and exact character
range. Open a PDF result to return to its saved document and page. Expand
**Snapshot details** to inspect the complete chunk, URL and digest.

The first query backfills `research-v1/search-v1.sqlite3` from immutable JSON;
subsequent queries index only newly saved versions and remove withdrawn sources.
This SQLite file is a derived cache: stop the App and remove it to rebuild on
the next search. Original snapshots, PDFs, frozen inputs and reports remain the
source of truth. Keyword search needs no extra package. Semantic ranking needs
the isolated `packages/app-infra` runtime image under `backend/app_infra` and
`llama-cpp-python`; without the model file, search stays on FTS5. Python's
SQLite must provide FTS5.

Markdown chunks respect headings; PDF chunks stay within a page. Both preserve
exact original slices with overlap, up to 1,600 characters per chunk. English,
Unicode words and Chinese characters/bigrams are normalized for FTS5/BM25.
Queries use up to 64 distinct terms, with truncation disclosed. Search returns
up to 12 chunks by default (API limit 1–30), at most two per PDF page and 19,200
characters total. Displayed counts distinguish returned chunks from all lexical
matches; they do not measure relevance quality, confidence or full-paper coverage.

New PDF research inputs freeze the retrieval method, query terms, selected PDF
versions, returned passage IDs and selected papers without returned evidence.
Reopening the same request uses those frozen passages and its original prompt,
even after an index rebuild or a newer PDF download. Legacy frozen inputs remain
readable. JSON exports include this retrieval record, source metadata and exact
passages; Markdown includes the method, coverage limitations and PDF digests.
Abstract/report snapshots retain their original kinds when PDF passages are used.
No-evidence questions ask for a more specific question instead of filling
the context with unrelated text. With multiple planned queries, `totalMatches`
is the sum of matches per query and may include overlapping chunks. When the
embedding model is loaded, ranking is reciprocal rank fusion of the keyword
leg and the vector leg; returned items are still exact original slices.

Authenticated API: `POST /api/library/search` with `query`, optional stored
`paperIds`, `limit`, and `pdfOnly`. Responses include exact chunks, versioned
source locators, scores, total/returned counts and truncation. Scores rank the
fused keyword and vector legs when an embedding model is loaded, and keyword
matches alone otherwise. This does not add OCR, a knowledge graph, or an
independent acceptance decision.

## Workflow and boundaries

Public literature search includes Hugging Face papers, alphaXiv, OpenAlex,
bioRxiv and PubMed. All-source search lists Hugging Face results first in the
default source order. The newest and citation-count options sort the returned
results after matching duplicates; missing dates or citation counts are last.
Citation counts come from OpenAlex and remain separate from Hugging Face likes
and GitHub stars. Results retain alternate sources, publication dates, authors,
and project, PDF or thumbnail links when supplied. The preview is a Hugging
Face social thumbnail, not necessarily a figure from the paper.

1. Imported papers become immutable snapshots with source identity, content
   kind, retrieval time and text digest. Abstracts, third-party reports and full
   text remain distinct. The full-text retrieval action uses alphaXiv, including
   papers selected through Hugging Face;
   original source/PDF links remain available. Public availability does not
   transfer publication rights. Searches send the entered query to the selected
   public services; confidential terms need appropriate permission.
2. Select 1–5 papers and state the research question. **Freeze research input**
   saves the input without execution. Inputs are capped at 80,000 selected
   characters and the Host's 128,000-byte frozen context budget. Changes require
   a new request identity. A selected passage can be added to the question;
   the selected passage stays attached to the unsent question until removed.
3. Sending a question explicitly starts an available Host Agent in the configured
   Host workspace. The manifest's `agent` grant is checked by the Host on each
   operation. The Host owns the ACP process, journal, approvals, authentication
   and cancellation. Handle requests for input or approval in the corresponding
   Host conversation; the App offers a chat shortcut when that capability exists.
   Hiding a panel retains it; disabling/removing the App closes its sessions.
4. Reports are checked against the exact input and selected paper IDs before
   saving. Quoted evidence must be an exact contiguous source passage. Invalid
   output is retained for inspection, correction and explicit validation.
   Existing Point report v1 JSON is accepted only when it matches the current
   frozen input; this is not a migration of Point's private data directories.
5. Experiments retain code, commands, criteria and observations. Missing tools,
   data or authorization must be `blocked`/`not-run`. Reported experiment results
   stay `agent-reported`, session links stay `client-reported`, and scientific
   acceptance stays `unverified`. Selecting code verification expresses intent;
   execution permissions and actual limits remain Host-owned.
6. Export Markdown/JSON or print the report, citations, source provenance and
   experiment appendix. Print/PDF uses the system print dialog. Reopening a
   saved report requires no Agent execution. Project Pages, independent research
   verification, domain Agent tools and remote App execution are not connected.

The App has no model credentials or execution loop. It communicates through
its own authenticated backend proxy and a narrow Host Agent endpoint. Unknown
start outcomes reconcile using the same frozen request ID; they do not launch
another session. The Host journal retains App ownership for restart recovery.
Python dependency/process separation does not restrict filesystem or network
access beyond the current user's permissions.

## Checks

```sh
npm --prefix apps/paper-agent run test
npm --prefix apps/paper-agent run typecheck
npm --prefix apps/paper-agent run build
node tests/contracts/app-agent.mjs
npm run test:paper
```

The backend tests are hermetic; their HTTP check needs loopback access. The real
Electron suite uses synthetic sources and an ACP fixture, without real model
requests or Internet access. Live source retrieval and scientific acceptance
are separate evidence. See [verification](../../docs/fitness/paper-agent.md) and
[notices](THIRD_PARTY_NOTICES.md).

## Scientific content and evidence matrices

Reader and Report share `ScientificContent`: React Markdown → remark GFM/math →
rehype KaTeX/highlight → React elements. Raw HTML is not enabled. Fonts ship with
App assets. ScholarQA uses markdown-to-jsx with custom Paper overrides; Pero uses
an AST-based pipeline to support formulas as well as typed evidence links.

In section Markdown, `[label](evidence:1)` opens the first item in that section's
`evidence` array. Unknown indices remain visibly unresolved. Source chips expose
all supplied quotations, not only the first quotation for a paper. Closing the
source panel restores focus; Escape closes it. The raw-source disclosure supports
exact selections when rendered formulas or Markdown formatting alter visible text.

Reports may add a structured `matrix` alongside existing sections:

```json
{"columns":[{"id":"dataset","label":"Dataset"}],"cells":[
  {"paperId":"<frozen-paper-id>","columnId":"dataset","value":"Example data",
   "status":"supported","evidence":[{"paperId":"<frozen-paper-id>","quote":"<exact source passage>"}]}
]}
```

A cell belongs to one frozen paper and column. `supported` requires an exact
quotation from that paper; `conflict` requires two distinct passages; `missing`
has an empty value and no evidence. Omitted cells display as missing. Limits:
eight columns, forty cells. Source matching establishes location, not scientific
support. JSON and Markdown exports retain the matrix and its quotations. Old
reports without a matrix retain their identity and remain readable. New comparison
research prompts request matrices; existing reports are not automatically inferred
or rewritten. Click a report cell to correct its value, status and exact source evidence. Each
correction is a separate version with an optional note; the original Agent report
remains unchanged. JSON includes the original matrix, edited matrix and revisions;
Markdown exports the corrected matrix with its revision history. PDF page anchors
and the separate reading matrix are described above; OCR is not included.

## Continue discovery

Return to the library and click **Discover** beside a saved paper. The current paper remains the explicit
seed. **Related papers**, **References**, and **Citing papers** query OpenAlex's
`related_works`, `referenced_works`, and `cites:<work-id>` respectively. Related
results are a similarity relation, not an assertion that one paper supports another.
OpenAlex IDs and DOI source URLs resolve directly. Other inputs, or missing IDs,
show title-search candidates for explicit title/author/year confirmation.

Results retain authors, publication date, citation count, abstract and original
link. Each successful exploration stores its seed snapshot, matched work, relation,
page, provider and retrieval time. History reopens stored results without fetching
them again. Return to seed keeps the original paper available; reading a candidate
and choosing Discover in the library explicitly starts a new exploration.

**Save** bookmarks a candidate, including metadata-only records, without changing
the current research selection. A work is saved once, retaining its first discovery
source; other paths remain in exploration history. Saved candidates survive restart.

**Compare** saves an abstract snapshot and selects the seed and candidate
to the comparison selection (maximum five papers). It adds a comparison instruction
and opens a fresh question in the conversation. Send it to generate the new matrix
using the existing Host Agent. Existing saved reports remain immutable. A record
without an abstract can be saved or opened externally; comparison requires readable
source text. This flow does not fetch an arbitrary publisher PDF or invent evidence.

Authenticated routes: `POST /api/discover`, `GET /api/discoveries/<id>`,
`POST /api/favorites`, `POST /api/discoveries/read`. Candidate operations take a
stored `batchId` and `workId`; the browser does not supply the source content.
Pages contain up to twelve works, with an explicit browsing ceiling of 100 pages;
all App document kinds retain the existing 200-record storage limit.

Interaction references: [ResearchRabbit's single-paper exploration](https://www.researchrabbit.ai/articles/guide-to-using-researchrabbit)
and [Litmaps' seed-based discovery](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps).
No product code from either service was copied. See [discovery verification](../../docs/fitness/paper-discovery.md).


## Reading-first workspace

The library owns import, local search, discovery and saved candidates. Reading
has no permanent paper list, document tabs or settings panel. Ask contains
previous questions and saved answers for the current paper, with matrices,
experiments and exports inline when present. Opening history does not rerun an
Agent. Advanced settings and invalid-output repair remain available on demand.
Each submitted question is its own frozen research run. Follow-ups resolve up to
three saved prior questions/answers and the current matrix values for intent
context, including manual corrections and pronouns; earlier
answers never become supporting evidence. Each answer retrieves fresh passages
and retains its own frozen prompt.

The existing PDF renderer, annotations, research execution and exact citation
resolver are reused. See [reading-first design](../../docs/design-docs/paper-reading-first.md).
