# Paper Agent

Selected PDF figure annotations now include a **Values** proof of concept:
local OCR, source-bound numeric candidates, explicit review, immutable reference
freezing and deterministic reports. See [usage, verification and limits](../../docs/fitness/paper-numeric-reference.md).

论文生命周期能力统一属于本 App：资料与证据、规划、写作、TeX 构建/PDF
预览、审阅和交付共享现有 Paper 数据与 Host Chat。接入范围和实施顺序见
[稿件写作设计](../../docs/design-docs/paper-manuscript-authoring.md)。

本 App 自带四个阶段技能：[规划](skills/paper-plan/SKILL.md)、
[写作与修订](skills/paper-write/SKILL.md)、[构建与预览](skills/paper-build/SKILL.md)、
[审阅](skills/paper-review/SKILL.md)。它们及共享参考文件随 builtin payload
交付，可指导已有授权工作区中的操作；作者稿件持久化、受管 TeX 编译和作者 PDF
预览的 App 路由/UI 尚待实现。文件打包不代表 Desktop 自动发现或工具已接通。

端到端 [Paper Reproduction Skill](skills/paper-reproduction/SKILL.md) 串起结果提取、
代码审计、协议冻结、获准执行、独立重算与结果包交接；支持只做计划、重分析和新实验，
分别报告来源一致性、执行状态、数值核验与科学结论。它复用当前可用执行入口，
不增加通用实验 API、Worker 接线或 UI 回写。详细记录约定见
[复现协议](skills/paper-reproduction/references/reproduction-protocol.md)。

通用 [Paper-Code Audit Skill](skills/paper-code-audit/SKILL.md) 支持论文与代码
的一项 Claim 一致性审计和诊断性重算，PC-Gym、LoRA、top-k 与 F1 作为按需参考；
新实验与可交接的重分析结果包由 Paper Reproduction 接续，复用已有审计证据。
其中 PC-Gym CSTR Table 6 提供固定案例 CLI 和独立双口径 Checker，使用 Python 3.10+。
该 CLI 的运行方式与指标契约见
[PC-Gym 设计](../../docs/design-docs/paper-pcgym-reproduction.md)，实际验收范围见
[验证记录](../../docs/fitness/paper-pcgym-reproduction.md)。它尚未接入 Paper UI，
也未完成原论文实验复现。固定 `reproduction-step` App 路由现可保存源码审计与
PDF/标注绑定，并复用同一检查器；发布的 server 默认无计算许可或固定 checkout，
不能由请求开启执行。Skill 与公开参考文件随安装包交付，但不代表自动发现/读取。

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
Open a paper to enter reading mode. One top bar contains Back, title,
**Read / PDF / TeX / Original**, the active preview's navigation and zoom,
and **Ask**. Opening the App never starts research.

**Original** embeds the official arXiv page in an iframe and retains an
external-open link. Paper declares only arXiv as an external frame origin;
embedding preserves the source site's own layout and conversion limitations.

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

## Import a research URL

Open **Add papers → Research URL**, paste a public HTTPS article, paper, repository
or Hugging Face page, and choose **Inspect link**. Review the discovered references
in one list. Articles, cited papers, code, model weights, datasets, benchmarks and
services remain distinct; missing metadata is marked unresolved. A cited paper
may describe an earlier release, not the article's new model.

**Save references only** is the default. It saves a research bundle and immutable
reading excerpts where available, without cloning or downloading assets. Reopen
bundles from the library or resume an uncommitted inspection after restarting.
Repeated URLs and known aliases reuse identities. **Inspect again** explicitly
refreshes metadata; it does not erase saved references or rewrite snapshots.

Only offered, pinned Hugging Face files can be downloaded. Select the files and
confirm their total size and displayed licenses once; Data then verifies each
file's exact size and SHA-256 before publishing it. Progress, cancellation and a
local-asset receipt stay available in the bundle. Failures keep references saved;
retry is explicit. Unknown licenses, gated sources, unsupported file paths and
unpinned files remain references. A license label is not a license grant.

For a saved GitHub reference, **Clone with Agent** opens an unsent Host composer
request with frozen source provenance. It does not clone or grant execution rights.
Review the destination, revision, license and unknown size in the existing
conversation before authorizing its normal execution tools. A successful clone's
actual commit, local path and tool receipt belong to that Host session; Paper does
not mark the request completed or invent a Data asset. Repository checkout/code
execution, dependency installation and experiments are not part of this handoff.

The Host's **research-resource-import** skill uses the same declared inspect,
commit and asset tools in an existing Agent conversation. Import also works
without an Agent. The Host must enable Paper's `research-assets` grant and Data;
Paper cannot access Data's private directory or backend token.

Developer boundaries and verification: [Research URL import](../../docs/fitness/research-resource-import.md).

### Direct fixed-case numerical runs (#77)

The Electron PDF annotation UI can prepare a fixed PC-Gym smoke item from an
already-configured pinned checkout, request a native per-run confirmation, and
show saved attempts beside the original annotation. It does not require an Agent
prompt or paid model. This is opt-in trusted deployment, not enabled by the Skill
or an HTTP `approved` field. The existing Python owner executes the fixed CLI.
See [authority, test evidence and outstanding acceptance](../../docs/fitness/paper-direct-reproduction.md).
The paper verdict remains `INCONCLUSIVE`; no new scientific run accompanies this change.

## Structured Read

Hugging Face/arXiv imports keep available alphaXiv text. If that text is missing
or unavailable, the official arXiv abstract can be saved instead, clearly marked
**Abstract**; it can then enter the same reading preparation below. Saving that
abstract does not claim a full-text read or download the PDF/HTML. bioRxiv imports
retain an explicit `vN` URL revision; an unavailable requested version is an
error, while an unversioned request selects the latest returned metadata version.

For a saved arXiv/alphaXiv search result, **Prepare formatted reading** reviews
the current paper's fixed arXiv version without leaving the reader. **Download
and format** grants that official HTML representation and prepares Read; the
optional TeX checkbox acquires the same version's inert source archive. A failed
review can refresh metadata, and failed HTML preparation can retry while PDF
remains available. Official HTML supplies Read's structure. Unversioned search
text remains immutable, and HTML never supplies
page coordinates for the saved PDF.

For an explicitly selected arXiv vN, review **Allow official HTML for Read**
separately from PDF permission, then choose **Prepare Read** in the saved paper.
Tables, equations and figure metadata retain source structure; **Reveal original**
shows the actual inert HTML bytes. Read/PDF keeps the existing PDF viewer state.
Images are not downloaded, and parsed content is not automatically study evidence.
See [scope and verification](../../docs/fitness/paper-structured-reading.md).

## Typeset TeX reading

**TeX** compiles an approved source archive for the selected paper/version and
shows its generated PDF in the existing viewer. The full source project,
including custom classes, bibliography and figures, is staged together. A unique
main file containing `\documentclass` is compiled automatically; multiple main
files require a selection. **Source files** opens a separate resizable inspector;
closing it restores the reading view without moving the toolbar.

The current runner requires macOS and Tectonic (`brew install tectonic`). It runs
with shell escape disabled and filesystem restrictions, retains a package cache,
and limits each attempt to 180 seconds. The first attempt can need package
downloads; failed attempts expose diagnostics and a retry. Compiler warnings stay
visible and their details are available in the source inspector.

Generated PDFs and their source archive/entry/engine identities are stored under
`tex-previews` and `tex-preview-files`, separately from original PDF evidence.
PDF and TeX preserve separate page/zoom states when switching. This is reading
downloaded source projects; author manuscript editing and build routes remain
the separate planned workflow described above. Verification and current limits:
[Paper reading views](../../docs/fitness/paper-reading-views.md).

For a saved paper's TeX or figure files, the resource import, reproduction, code
audit and build skills share [source location guidance](skills/research-resource-import/references/tex-source-locations.md).
The bundled `tools/locate-source.py --arxiv <id>vN` checks approved managed data
and existing export copies offline; `--cache` selects an explicit profile. It
does not download or move data. Actual skill, source and figure checks are in
[source discovery verification](../../docs/fitness/paper-source-locations.md).
