---
kind: verification_report
date: 2026-10-29
status: verified_local
---

# Paper scientific content and evidence matrix

L0/L1 local development verification on macOS arm64, over the concurrent working
tree at HEAD `10d1d322af65a108c6e78f5aabad7a28bde5267a`. Other tasks changed App Use, App manifests, shared Chat
and workspace layout. Those changes are preserved and are not attributed to this
slice. No commit, publication or release package was made.

## Implementation

ScholarQA source inspected at `19e6827ba9e7fe05068624d0851f38cd74ff5efc`:
`ui/src/components/report/Section.tsx`, `LitTable.tsx`,
`LitTable/CellWithEvidence.tsx`, and its package dependencies. It uses
markdown-to-jsx with custom citation overrides and structured evidence cells.
Pero independently implements those interaction patterns; no ScholarQA UI source
was copied (root Apache-2.0 / UI UNLICENSED labeling remains unresolved).

Reader and Report share React Markdown, remark-gfm/remark-math,
rehype-katex/rehype-highlight. Fonts are local App assets. HTML is not interpreted;
normal URL handling remains React Markdown's default. Evidence links resolve
against the current section's typed evidence array. Invalid indices are visibly
unresolved. Matrix cells use existing strict quote checks against frozen sources;
matched text is not scientific acceptance. The matrix is part of immutable report
identity and JSON/Markdown exports. Older reports omit the optional matrix field,
so their content identity stays unchanged.

## Checks

- `npm --prefix apps/paper-agent test`: all 11 Python tests pass, including a
  behavior table for cell/source/column identity, duplicate cells, missing data,
  invented quotes, conflicts, export and store reload.
- `npm --prefix apps/paper-agent run typecheck`: pass.
- `npm --prefix apps/paper-agent run build`: pass, local font assets emitted.
- `npm run test:paper`: all 11 Electron workflow checks pass with no unexpected
  browser errors. Uses the real Host and Python backend with a synthetic ACP
  fixture; no real model or scientific computation.
- Actual screenshots inspected in light mode and dark Chinese narrow layout.
  Matrix and inline citations open exact source context; Escape and Close restore
  keyboard focus. Narrow evidence replaces the document and restores it on close.
- E2E additionally checks GFM tables, KaTeX inline/display math, code highlighting,
  missing cells, blocked raw script/JavaScript links, persistence, JSON/Markdown
  downloads, print-media evidence, cancellation, theme/locale and document overflow.

Final E2E payloads: JS `0522c651f9ca67aea2e428e2c31880ce4ce199f620a5c1945638bc8ff55446df`;
CSS `b0663fcda2d34c70d5e37c8a72ae683ff9309c65660a79dd16e7d38434b02cd2`.

Evidence (ignored generated files):
`test-results/paper-agent/result.json`, `scientific-matrix.png`,
`narrow-matrix.png`, `narrow-matrix-evidence.png`, `evidence.png`.

## Limits

This Markdown-rendering verification did not cover real provider acceptance,
numerical reproduction, image extraction, OCR, PDF page coordinates, scientific
validity or signed package acceptance. PDF work is recorded in the follow-up below.
The matrix is read-only; manual report repair creates a new immutable report.
Existing reports are not automatically assigned inferred matrix values.
Rendered Markdown/math can change visible selection text: raw source disclosure
supports exact selection; unmatched rendered selections are not fabricated quotes.
Native print dialog was not invoked. Complex real-paper layout and cross-platform
renderer acceptance remain separate work.

## PDF reading follow-up (2026-10-29)

Implemented over the concurrent working tree at HEAD
`502b4cc87e399e0cb52ec022be34e2ca8509af93`. Existing discovery, rendering,
App Use and native work remain separate changes. No commit or release was made.

The React App uses EmbedPDF 2.15.1 headless plugins and locally bundled PDFium
WASM. Python uses pinned pypdfium2 5.0.0 and Pillow 12.0.0 in the shared selected
environment. No PaperQA Agent/model loop was added. Its reader and Text/Context
separation informed this independently written implementation.

PDF files are stored by digest. Immutable document metadata, page text,
annotations and user-curated matrix cells live under `research-v1`. A saved
annotation references a particular document version, page and normalized region;
the matrix stores that annotation's ID. File bytes remain unchanged. Both PDFium
bindings use unrotated, top-left page coordinates. Backend PDFium calls are
serialized because the App serves HTTP on multiple threads and PDFium forbids
simultaneous calls. Highlight verification checks page text with whitespace
ignored; image verification establishes a rendered source region, not a claim.

The App supports in-panel PDF/text switching, virtual page rendering, page and
zoom controls, selection highlights with notes, region capture, PNG copy/download,
manual comparison fields and links back to saved page regions. Report quotations
can open any matching PDF page. An accessible page-text disclosure remains
available. Original-source links and research controls remain on demand.

Desktop permits local WASM compilation and worker blobs in App pages, and grants
the App iframe clipboard writing for explicit copy actions. Clipboard reading is
not granted to the App. E2E uses the real system clipboard and restores its
previous contents after checking a copied PNG. PDF fonts do not fetch a CDN.

Validation:

- 15 Python tests, including page/region rules, repeated quotations, real PDFium
  parsing, rotation normalization, cropped dimensions/pixels, persisted originals,
  annotations and matrix links. The existing loopback HTTP workflow also covers
  binary PDF/PNG responses and report-to-PDF page matching.
- App TypeScript/build and repository `npm run check` pass.
- Real backend download from `https://arxiv.org/pdf/1706.03762`: 2,215,244 bytes,
  15 pages, SHA-256
  `bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697`.
  Record: `test-results/paper-pdf/live-download.json`.
- The existing alphaXiv read adapter also returned the real title, source report
  and `https://arxiv.org/pdf/1706.03762` link for that arXiv ID.
- Real Electron -> Host -> installed Python App checks pointer selection against
  saved quotation text, region capture, actual PNG copying, a manual matrix cell,
  source navigation, dark/narrow layout, failed-PDF recovery to text, and recovery
  after restarting Desktop. The network seam supplies fixed PDF bytes in this
  suite; the real download above is a separate check. The optional live-document
  mode uses the downloaded arXiv bytes through the same UI interactions.

Commands (use a prepared shared environment):

```sh
PATH=/path/to/shared/bin:$PATH npm --prefix apps/paper-agent test
npm --prefix apps/paper-agent run typecheck
npm --prefix apps/paper-agent run build
npm run build:web
npm run build:desktop
PERO_APP_PYTHON=/path/to/shared/bin/python npm run test:paper
PERO_APP_PYTHON=/path/to/shared/bin/python \
  PERO_PAPER_PDF_FILE=/absolute/path/to/attention.pdf npm run test:paper
```

Evidence: `test-results/paper-agent/result.json`, `pdf-highlight.png`,
`pdf-figure.png`, `pdf-matrix.png`, `pdf-dark-narrow.png`; a real-document copy
is retained under `test-results/paper-pdf/real/`. Generated evidence is ignored.

This PDF reading slice does not add OCR, automatic figure/table recognition,
or scientific acceptance. Full-text retrieval is recorded below. PDF download does not mutate
existing frozen abstract/text inputs. Matrix curation is additive; annotation
editing/removal and annotated-PDF export remain future work. macOS development
acceptance does not establish Windows/Linux or packaged-release acceptance.

Final PDF follow-up: all 14 Desktop checks passed, with no unexpected browser errors.
Loaded JS SHA-256: `bb158649c86ec3ebe13523f0bb93c67b8375250d5e6ee4d9f150452641646a62`.
Loaded CSS SHA-256: `3086dfc17d2df7b1502d78479b8bfa74559bf5612c5f0c17dc181fdcea541c45`.


## Full-text questions and exact PDF citations (2026-10-29)

Saved PDF page text is split into overlapping, unchanged source passages and
searched through the shared local SQLite FTS5/BM25 index. A question freezes
at most 12 passages / 19,200 characters, the document IDs and file digests,
retrieval scope, and the exact Host Agent prompt. Retrying that input after a
new PDF version is saved retains the original passages and prompt. No matching
terms produces an explicit error; unrelated text does not fill the context.

Full-text answer evidence requires a passage ID and an exact quotation from
that frozen passage. Citation resolution reads the saved document version,
uses native PDFium text search to obtain page rectangles, and navigates the
EmbedPDF reader to the corresponding highlighted region. This includes matrix
citations; exported Markdown retains PDF page links and version digests.

Validation: 20 Python tests, App TypeScript/build, repository `npm run check`,
and 15 real Desktop checks passed. The desktop run used the saved 15-page
arXiv PDF above, with deterministic ACP output rather than a model request.
It checked full-text question submission, quotation highlighting, and reopening
the answer and citation after Desktop restart. Unexpected browser errors: 0.
Evidence: `test-results/paper-agent/result.json`, `pdf-answer-citation.png`.
Loaded JS SHA-256: `37941651723dbd2c6c962000d7c0413328f5bfe6b4ad93597b9e198a28a34ae2`.
Loaded CSS SHA-256: `eddfb9834eaee028727bb170c5f1a6dfe091cb9cb6d21ce095eb6ff3787d7025`.

Retrieval is lexical: no embeddings, translation, OCR, or iterative query
expansion. Exact quotes establish provenance, not support for every generated
claim. Real model answer quality and cross-platform packaging remain unverified.

## Reading-first workspace (2026-10-29)

Implemented [the reading-first design](../design-docs/paper-reading-first.md) in
this App. The default reading interface is its 44px top bar and document. Ask
opens an optional conversation; the library owns importing and discovery.
Reports, prior questions, matrices, experiments and exports remain accessible
inside that conversation. Advanced settings are explicit. Existing persisted
records and backend contracts are retained.

The App keeps the live PDF viewer mounted across Ask open/close and same-file
citation jumps. It fixes the current zoom before resizing the reading area.
Selection actions expose highlighting and question context; right-click or
Shift+F10 exposes secondary PDF tools. The narrow conversation overlays the
reader, makes its background inert and contains keyboard focus. Closing returns
focus to Ask. Importing/searching/submitting uses explicit API actions because
the App iframe does not grant native form submission.

Validation on macOS development Desktop:

- 20 Python tests, App TypeScript/build and repository `npm run check` passed.
- All 13 updated Desktop scenario groups passed with synthetic PDF bytes and
  again with the saved 15-page arXiv paper. No unexpected browser errors.
- The suite imports text through the actual UI; verifies library search,
  discovery, comparison, answer rendering, rejected quotes and repair, exports,
  cancellation, dark/Chinese/narrow layouts, PDF pointer selection, selected-text
  question context, highlight/crop, native image clipboard, manual matrices,
  exact PDF citations and recovery after Desktop restart without Agent replay.
- It marks the live rendered page to verify that Ask and same-file citation
  navigation retain that viewer, and checks that zoom and selection survive
  opening/closing the Agent. At 1440x900 the PDF fits the reading viewport;
  the 44px document and conversation headers align.

Evidence: `test-results/paper-agent/result.json` and
`test-results/paper-agent-real/result.json`; `reading-first-1440.png`,
`pdf-answer-citation.png`, `pdf-dark-narrow.png`, `conversation-reopened.png`.
Loaded JS SHA-256: `b5448317282b9480b845b54a5aad4cfa9a0f0aec748a083b437e027ed82f72bc`.
Loaded CSS SHA-256: `48e6e239c0149029e2793cd2d65fc716fb50d2766e8b34db64bff75981225cb0`.

The reported passes explicitly select the deterministic ACP fixture. They prove
Host execution wiring and source navigation, not real-model answer quality.
Each question remains an independent frozen research run; the conversation is
its presentation and history. Full screen-reader, cross-platform and packaged
release acceptance remain outside these development checks.
