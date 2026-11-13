# Notebook publication workflow

Date: 2026-11-13. Base: `c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23`;
branch `codex/science-p1-publication-workflow`. Code commits: `a07ca8c1`
(panel provenance/example), `d5511266` (LaTeX figure layout), `621ee030`
(build adapter/receipts), `50f6cb71` (product editing/build/history UI).
Local source/browser/compiler acceptance; no signed Desktop or scientific review.

This extends the existing [MyST verification](../issues/2026-11-11-myst-document-verification.md)
and [ADR 0033](../adr/0033-notebook-interop-and-computation.md).
The old [manuscript proposal](../design-docs/paper-manuscript-authoring.md) is
background, not the owner for this implementation. Notebook already owns MyST/
IPYNB editing, revisions, HTML and DOCX/LaTeX/Typst projections.

## Delivered behavior

- An optional `publication-provenance.json` identifies each figure, panel,
  original data and generating code by resource path and SHA-256. Editing data
  or code marks the figure stale and requires regeneration before PDF build.
  Source buttons focus the actual CSV or named plotting function in the existing
  editor. Hash consistency is traceability, not a scientific verdict.
- An explicit local command generates the reusable two-panel Fisher example.
  It retains all 100 reviewed input measurements, exact rational recomputation,
  Python source, 300 dpi PNG, editable-text SVG and a standalone vector PDF.
  Edited inputs are labeled a variant. Existing output directories are refused.
  The command uses the selected environment, with no kernel or Agent inside Notebook.
- **Update from regenerated project** changes the existing block draft and
  retains its identity. **Save revision** uses the existing Entry owner. Old
  revisions keep the old figure/code/data; no second manuscript store is added.
- **Compile saved revision to PDF** exports through the existing publication SDK
  and invokes a bounded synchronous Tectonic adapter in the Host-owned App process.
  It adds no queue, retry loop, Agent, approval system or general execution service.
  The full project snapshot and original entry recovery must match the saved
  revision byte for byte at archive admission.
- Immutable receipt rows in the existing Notebook SQLite file retain revision,
  block, full-source/archive/PDF hashes, engine version, chosen read-only package
  cache, command, conversion warnings, compiler diagnostics, log and actual PDF.
  Success means compilation only. Failed/unavailable attempts keep their inputs.
  Entry deletion removes these satellite rows with its other local records.
- History opens the exact stored build, including after backend restart. PDFium
  renders the selected stored PDF page; preview, diagnostic and download share
  the build identity. New edits label old PDFs explicitly. Failed builds expose
  the last compiled PDF and retain the failed source package. Generated TeX line
  diagnostics focus the actual generated line; edits return to the MyST owner.

The existing shared Button, Select, Textarea, FilePicker, Feedback and Disclosure
contracts are reused. The existing MyST project view is extended; no controls or
tokens were replaced. New CSS only sets source/preview geometry, wrapping and gaps.
Safe authored percentage figure widths survive LaTeX projection. Standalone
full-width images have no paragraph indent, and unused `longtable` is no longer
an unconditional compiler dependency.

## Actual local acceptance

The real browser journey generates the figures, navigates to the generating
function, edits data through the product, imports regenerated inputs into the same block, saves, compiles and
views two versions. The reviewed Fisher data gives `95717/5000 = 19.1434 cm²`;
changing the first setosa measurement from 5.1 to 5.2 gives
`4793/250 = 19.1720 cm²`. Both versions compile to a real one-page PDF with
different hashes and no compiler diagnostics. Four explicit publication conversion
losses remain visible (including cross-references as display text).

The same browser inserts malformed math through the editor, saves and gets a
real failed Tectonic build with an `article.tex` line diagnostic. The failed
source stays editable, the previous PDF opens, and v1 still recovers its exact
snapshot and PDF hash. A delayed earlier history response cannot replace the
newer selection. Source input hashes and scientific claims are not inferred from
compiler success.

Inspected Chromium screenshots at 1280×1000 light and 480×900 dark:

- `test-results/notebook-publication/pdf-v1-light.png`: actual compiled manuscript,
  both panels, figure reference/caption and source data statement visible.
- `historical-v1-narrow-dark.png`: historical revision warning, wrapped actions,
  conversion losses and page navigation remain accessible.
- `pdf-v1-narrow-dark.png`: full PDF page fits the narrow content area.
- `failed-build-retains-source.png`: failed build, actionable diagnostics,
  retained source package and last successful PDF action.

The independent figure/SDK probe also rendered and inspected both complete PDF
pages in `test-results/publication-figure/final-v{1,2}/article-page.png`.
The existing narrow Notebook sidebar has a light surface with low-contrast dark
theme heading; it is outside the changed publication region and is not certified
by these observations. Fit-page previews on narrow screens have small text;
download the actual PDF for full reader zoom.

## Reproduction and scope

Use an existing Python with Matplotlib for the real browser/example, and the
Notebook Host environment with PDFium/Pillow for preview. This machine used
`~/.pero/environment/pero-python312` (Python 3.12, Matplotlib 3.10.3) for figure
generation, and `~/.pero/environment/pero-default` for full backend/editor tests.
The system `/usr/bin/python3` is 3.9 and cannot run the existing Notebook backend.
The Python 3.12 environment lacks Office parsers used by unrelated tests; the
prepared default environment supplies them. No dependency was installed.

```sh
npm run typecheck --prefix apps/notebook
npm run build --prefix apps/notebook
node --test packages/notebook/test/*.test.ts
PATH="$HOME/.pero/environment/pero-default/bin:$PATH" npm run test:editor --prefix apps/notebook
NOTEBOOK_REAL_PUBLICATION=1 PYTHONDONTWRITEBYTECODE=1 \
  "$HOME/.pero/environment/pero-default/bin/python3" -m unittest discover -s apps/notebook/test -p 'test_*.py'
NOTEBOOK_REAL_PUBLICATION=1 PYTHON="$HOME/.pero/environment/pero-python312/bin/python3" \
  npm run test:publication --prefix apps/notebook
```

The selected compiler is Tectonic 0.17.0. PDF builds currently require macOS
`sandbox-exec`, installed Tectonic and an already prepared TeX cache. They run
with `--untrusted --only-cached`, no network, no child execution and writes only
in the disposable staging directory. `PERO_NOTEBOOK_TEX_CACHE` is an operator
environment setting, never an HTTP executable/path option. Acceptance selected
the already prepared public package cache at
`~/.pero/native-preview/app-data/paper-agent/research-v1/tex-engine-cache/Library/Caches/TectonicProject.Tectonic`;
set this variable for the last two commands on this machine. The default cache
lacks some SDK-required packages and reports this through retained diagnostics.

Other platforms and missing compilers retain existing source/archive exports and
record an unavailable build. There is no Typst-to-PDF adapter, notebook cell
execution, automatic data regeneration, SyncTeX source map, publication template
catalog, model run, external deployment, journal compliance/peer review or signed
Native/Electron package acceptance in this work. The vector figure is delivered
separately; the manuscript embeds its admitted high-resolution PNG.

Generated PDFs, images, archives, snapshots and logs stay in ignored test output.
They are not source commits. Final suite results: 317 Notebook core tests and
109 editor tests passed; 149 backend tests completed with 146 passing and three
existing Linux/real-OCR opt-in skips. The existing MyST project browser regression
and the real publication browser journey passed
with no browser exceptions or attempted external requests. Initial broad runs
used system Python 3.9 or an environment lacking Office parsers; selecting the
existing prepared default environment resolved those setup failures.
