---
name: paper-build
description: Compile TeX and inspect its rendered PDF. Use when the user asks for a LaTeX build, error diagnosis, preview, layout check or source package.
---

# Build and inspect a manuscript

Treat source generation, compilation, preview and visual review as separate
observable results. A generated TeX file does not prove a PDF was built, and an
opened preview does not prove its scientific content was reviewed.

## Inspect the inputs and environment

Identify the manuscript root, entrypoint, bibliography, figure assets and template.
For a downloaded paper, first read
[TeX source locations](../research-resource-import/references/tex-source-locations.md).
Use the whole verified source project; a hash-named cached TeX member is not a
standalone build directory. Keep author drafts separate from downloaded originals.
Read the template's actual requirements. Use the existing authorized build
environment. Check the installed engine, bibliography processor and preview tools;
do not silently install a TeX distribution, fetch packages or change global config.

For the build record and revision rules, read the shared
[evidence contract](../paper-write/references/evidence-contract.md). For Pero capabilities,
read [the integration notes](../paper-write/references/paper-agent-integration.md). Advertised tool
schemas, not the names in these design notes, determine what can be called.

Downloaded third-party TeX is source evidence until explicitly selected for a build
through an authorized execution environment. Acquisition permission alone does not
authorize compilation. Use a provided managed builder for that boundary; do not
describe a subprocess or venv as a sandbox.

## Compile the selected revision

Prefer the project's recorded build command. With an available latexmk setup,
an ordinary local PDFLaTeX example is:

```bash
latexmk -pdf -interaction=nonstopmode -halt-on-error -file-line-error \
  -synctex=1 -outdir=build main.tex
```

Select XeLaTeX, LuaLaTeX or another engine only when the template requires it and
the environment provides it. Use the environment's existing execution policy;
do not enable shell escape merely to bypass an error. Record actual inputs,
command, environment identity, process outcome and output hashes. Keep build output
apart from author sources and identify a last successful PDF as historical.

Classify diagnostics: missing environment/dependency, source syntax, bibliography,
cross-reference or layout. Repair the relevant source only when authorized. Repeat
the build after a repair; stop when a repeated failure requires unavailable input,
an environment change or a material author decision. Preserve logs and valid drafts.

## Preview and inspect

Open the exact build's PDF through an available viewer. If the host provides only
file tools, render pages with an installed renderer and inspect the resulting images.
For example, when Poppler is present:

```bash
pdftoppm -f 1 -singlefile -scale-to 1600 -png build/main.pdf build/page-1
```

Inspect title/abstract, changed pages, figures, tables and references at useful
reading sizes. For a full-layout review inspect all pages; for a local change
record the inspected subset. Check clipping, missing glyphs, unreadable displays,
float placement, unresolved citations and page limits when verified venue rules exist.
Text extraction can supplement this check, not replace visual inspection.

Use SyncTeX navigation only when its output exists and the viewer supports it.
Otherwise locate the source with real labels or searches; do not invent PDF coordinates.

## Deliver

Return the source/PDF paths or App artifact references, selected revision, build
outcome, remaining diagnostics and preview/inspection scope. Missing engines or
viewers remain named gaps with a concrete recovery path. A source archive includes
the required TeX, bibliography, styles and referenced assets with their provenance;
exclude credentials and transient build files. Exporting a package is not submission.

## Runtime availability

The headless catalog loads this entrypoint only. Supporting references require
an authorized file reader within the selected skills root. If unavailable, work
within this entrypoint and disclose the unread guidance; do not guess tool commands.
