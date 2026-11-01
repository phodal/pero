# Source-first scientific documents

Implementation issue: [#76](https://github.com/phodal/pero/issues/76).
Initial implementation: [#78](https://github.com/phodal/pero/pull/78), based on
`85453242733bef06b34f210bc22aa00b34291280`.

## Outcome and owners

A saved paper should be readable as scientific objects without discarding its
original PDF or silently changing the sources used by previous studies. HTML is
a reading/export format, not the evidence database. Native publisher structure
is preferable to reconstructing it from page images when it is available.

`PaperSnapshot` owns imported identity and text. `PdfDocument` owns saved PDF
versions. `ScientificDocument` owns an immutable derived parse of one acquired
HTML source. `PaperDocuments` composes the existing `ResearchStore`; it does not
introduce another database, scheduler, Agent, approval layer or task state machine.
Host/ACP still owns execution, permissions and cancellation. #75 owns general
research-link PDF acquisition; #66 owns shared citation/selection anchors.

```text
saved paper → explicit prepare → resolve fixed-version official HTML
                                  ↓
                       raw UTF-8 + SHA-256 + parse identity
                                  ↓
                  sections / blocks / math / cells / references
                     ↙                            ↘
             safe HTML export               bounded structure reads

original PDF + existing observed-evidence ledger remain unchanged
```

## Domain and version contract

The domain is a small immutable value model, not a copy of an external parser's
entire schema. `DocumentSource` records URL, explicit arXiv ID, original byte
length and SHA-256. `ScientificDocument` records paper identity, parser ID,
ordered blocks and limitations. `PaperBlock`, `Inline`, `TableCell` and
`ImageReference` are typed values. IO remains in the source adapter and store
composition; the parser and renderer are deterministic functions.

A document identity hashes its source, parser and derived structure. Retrieval
time is metadata, not identity. Block IDs are stable within a parse revision,
not asserted stable across parser upgrades. Refreshing a source saves a new
revision when its content changes. Repeating an identical parse reuses the
existing document and original retrieval metadata. Old IDs remain readable.

The complete original UTF-8 HTML is retained in the immutable sidecar, including
a BOM and original newlines, and checked against its raw-byte digest on read.
Only normalized text appears in the IR. Its offsets are **not** PDF offsets and
its hashes are not author-authenticity or scientific-validity attestations.

| Content | First implementation | Remaining fidelity work |
| --- | --- | --- |
| Title/metadata/abstract | Title and abstract structure; existing Paper metadata unchanged | Dedicated author/affiliation/metadata schema |
| Sections/appendices | Ordered heading blocks and parent section IDs | Corpus-level hierarchy recovery and all parent anchors |
| Paragraphs/lists/notes | Normalized text, simple list items and note blocks | Nested lists and complete note/backlink semantics |
| Formulae | Existing MathML allowlist and available LaTeX, inline/display blocks | Complex unsupported math fallback and broader fixtures |
| Figures | Caption, source image references and source anchors | Explicit image acquisition, local assets, subfigure relationships |
| Tables | Original cell strings, headers, row/column spans, caption | Nested/multiple tables deliberately remain warned text |
| References | Internal targets, bibliography blocks, unresolved/ambiguous warnings | Structured bibliographic metadata and trace UX |
| Algorithms/theorems/code | Code whitespace preserved; algorithms/theorems warned as text | Typed steps, theorem/proof relationships |
| External resources | Inert HTTPS links, no automatic download | Reuse resource intake for reviewed code/data associations |

## Source selection and parser boundary

arXiv's [accessible HTML documentation](https://info.arxiv.org/about/accessible_HTML.html)
describes conversion from authors' LaTeX. A URL that has a PDF does not guarantee
usable HTML, and official HTML may contain conversion errors. The first adapter
therefore accepts one LaTeXML article, fixed-version official URLs and bounded
UTF-8 input; it is not a generic web extractor or a PDF OCR implementation.

An explicit stored arXiv version is never silently upgraded. For an unversioned
identity, acquisition reads the official abstract page and requires exactly one
same-work, fixed-version official HTML link. Conflicting work IDs or explicit
versions fail rather than being merged by title similarity. Request entry URL,
resolved source URL and retrieval time are retained. The existing no-redirect
policy is reused. Failed HTML preparation leaves all PDF reading paths intact.

The adapter is intentionally replaceable. Do not install several heavyweight
parsers merely to fill a capability checklist. The following are evaluation
candidates, not dependencies or verified performance rankings:

| Candidate | Appropriate role | Integration decision |
| --- | --- | --- |
| [Docling](https://docling-project.github.io/docling/concepts/docling_document/) | PDF layout, tables, provenance and unified documents | Preferred first PDF enhancement experiment; evaluate a pinned version |
| [GROBID](https://github.com/grobidOrg/grobid) | Scholarly metadata and bibliography | Add only when native structure is insufficient |
| [LaTeXML](https://github.com/brucemiller/LaTeXML) | Acquired TeX sources to semantic HTML | Isolated conversion; no arbitrary TeX execution in the host |
| [S2ORC](https://github.com/allenai/s2orc-doc2json) | Cross-format scholarly schema ideas | Reference, not a parallel database |
| [MinerU](https://github.com/opendatalab/MinerU), [Marker](https://github.com/datalab-to/marker) | Complex PDF extraction comparison | Corpus, resource and license evidence required before adoption |
| [PaperMage](https://github.com/allenai/papermage), [ScholarPhi](https://github.com/allenai/scholarphi) | Source-grounded scholarly interactions | Design reference; do not replace the existing viewer/runtime |
| [PaperQA](https://github.com/Future-House/paper-qa) | Iterative evidence retrieval | Reuse ideas within the current study/Host boundary |

Before adopting an engine record exact release/commit, code and model licenses,
transitive dependencies, CPU/GPU requirements, privacy/offline behavior, latency,
peak memory, failure modes and fixture results. An open repository alone is not
proof of an unrestricted model license. Earlier research summaries are not a
substitute for inspecting the selected release. No new runtime dependency or
model download is introduced by the native HTML adapter.

## Authenticated API

All routes use the existing App token check. GET never acquires a source.

| Route | Contract |
| --- | --- |
| `POST /api/paper-documents` | Stored `paperId`, optional boolean `refresh`; no arbitrary URL/path |
| `GET /api/paper-documents?paperId=...` | Latest saved parse or null |
| `GET /api/paper-documents/{id}` | Exact immutable parse revision |
| `GET /api/paper-documents/{id}/outline` | Heading catalog; not evidence of reading the body |
| `GET /api/paper-documents/{id}/blocks/{blockId}` | `start` and `limit` (1–4800), continuation and source provenance |
| `GET /api/paper-documents/{id}/html` | Safe derived HTML; never raw source HTML |

This is currently a backend/renderer slice, not a new declared Agent capability.
A future App command must freeze the selected document revision and record actual
observations through the existing ledger before using them as report evidence.
Current block reads explicitly return `evidenceAdmission: not-observed-in-study`.
Neither source acquisition nor reading an outline means the full paper was read.

## Evidence and reader completion contract

`pdfAlignment` remains `unavailable`. Matching work IDs, text resemblance or
conversion success cannot prove a PDF page/region mapping. Future alignment is
an independently versioned, possibly one-to-many derivation. Its exact-text,
region, approximate or unresolved state must remain visible. Do not assign PDF
page numbers from HTML position or relax exact quotation validation.

The planned App flow is Read / PDF plus existing Ask, not a second composer or
new navigation platform. Read must retain source/version context; switching modes
must retain PDF page, zoom, selection and annotations. Source-backed selections
and citations should use the shared reveal operation. Unavailable HTML should
leave an immediate PDF option; preparation must not start Agent research.

The exported reader is generated from typed IR, not `innerHTML` from a publisher.
It has semantic headings, native MathML, tables, internal targets, an outline and
source/limitations disclosure. Scripts, source styles, active SVG and auto-loaded
images are omitted. Images remain clearly marked references until bytes are
acquired through an authorized asset path. A caption is not image observation.

## Bounds and failure behavior

The initial bounds are 8 MiB HTML, 100,000 nodes, depth 100, 20,000 blocks,
2,000,000 extracted characters and 100,000 occupied table slots. Abstract-page
version discovery is capped at 1 MiB; source requests have a 30-second socket
timeout. These are not a claim of a process-wide wall-clock cancellation budget.
No parser process, TeX compiler, OCR model or shell command is started.

Limits fail explicitly rather than publishing truncated success. Ambiguous
anchors are not silently linked to one block. Nested tables and unsupported
structures retain available text and warnings. Original raw source stays
available for later re-parsing; the renderer never executes it. Retried failure
cannot overwrite an already saved revision. Collection limits and atomic writes
remain owned by ResearchStore.

## Completion gates

The first PR is deliberately draft. Before closing #76, finish actual App
Read/PDF integration, source reveal, declared Agent tools, typed observed evidence,
image assets, stronger content fidelity and a frozen real-paper corpus. Run
existing Paper regressions, actual Desktop navigation/theme/narrow/restart tests
and an opt-in real fixed-version arXiv journey. Keep fixture, live-source,
real-model and signed-package evidence separate. Docling or GROBID integration
is an evaluated extension, not a reason to postpone usable native-source support.

Verification and reproducible commands: [scientific documents](../fitness/paper-scientific-documents.md).
