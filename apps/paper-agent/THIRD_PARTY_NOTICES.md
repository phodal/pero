# Paper Agent notices

The Python research domain rules and public-literature adapters are derived
from Point Paper Agent and Scientific Viewer (Apache-2.0, Point contributors).
Reference source: `phodal/point`, revision
`dcd549a9cc8807eda5ce682eef4621afbd9a02d9`, specifically
`apps/paper-agent/{src,backend-src}` and
`apps/scientific-viewer/backend-src/literature.mjs`.
The Python implementation and Pero UI were written for this integration; no
Point UI components, generated bundles, execution runtime or private user data
are included. See [Apache-2.0](licenses/Apache-2.0.txt).

The independently bundled App UI includes React and ReactDOM 19.2.8 under MIT:
[React](licenses/React-LICENSE.txt), [ReactDOM](licenses/ReactDOM-LICENSE.txt),
and their [Scheduler](licenses/Scheduler-LICENSE.txt) dependency.
Their versions are pinned in the App's lockfile. The App SDK is supplied by this
repository at build time. No external research clone implementation is included.

Papers, author text, figures, research repositories and datasets retain their
own attribution and rights. Retrieval through a public API does not authorize
redistribution or scientific acceptance.

The scientific content renderer bundles react-markdown, remark-gfm, remark-math,
rehype-katex, rehype-highlight and KaTeX, with their runtime dependencies.
Versions are pinned in package-lock.json; upstream license texts are retained in
[Rendering dependency notices](licenses/Rendering-dependencies.txt).
KaTeX fonts are bundled locally; no renderer CDN is required.

PDF reading bundles EmbedPDF 2.15.1 (core, engines, models and headless plugins)
under [MIT](licenses/EmbedPDF-MIT.txt), and its PDFium WASM distribution with
[PDFium dependency notices](licenses/PDFium.txt). Versions are frozen in the App
lockfile. Python PDF processing uses separately installed pypdfium2 5.0.0
(Apache-2.0/BSD-3-Clause choice, with PDFium's bundled notices) and Pillow 12.0.0
(HPND); their wheels retain their upstream licenses.
PaperQA `c692d0dfeac4a0296599f7fe21a253a58b7ac12a` informed the separation of
source pages, rendered media and evidence. Its code and Agent loop are not bundled.

Interaction research: Ai2 ScholarQA `19e6827ba9e7fe05068624d0851f38cd74ff5efc`,
especially Section.tsx, LitTable.tsx and CellWithEvidence.tsx. Its root license is
Apache-2.0 while ui/package.json says UNLICENSED. No ScholarQA UI source or MUI
components were copied. Pero independently implements sourced cells and citations.

The local source-search design references KiroCrew's Knowledge Library at
`19218c7fc9` (`knowledge/readers.py`, `chunker.py`, `retrieval.py`): local FTS5,
separate search tokens and original text, and source-linked retrieval. Pero's
index, exact-offset chunking and frozen research integration are independently
implemented; no KiroCrew runtime or vendored embedding library is bundled.
