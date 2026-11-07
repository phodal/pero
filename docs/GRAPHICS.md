# Public research graphics

Use the visual language established by the [research roadmap](assets/openpero-research-roadmap.svg)
at `de4927f` for the README overview, composition and architecture graphics.
This is an editorial illustration style, not a replacement for the product UI
colors or interaction rules in [DESIGN.md](../DESIGN.md).

## Visual language

- White canvas, generous whitespace and a clear reading direction. Illustrate
  recognizable objects: papers, experiments, Apps, people, computers and records.
  Group with spacing and pale washes rather than nesting every idea in a card.
- Charcoal `#20272B` for primary text/lines; gray `#667075` for supporting text;
  `#D7DCDF` for quiet dividers; `#F5F7F7` for background groups.
- Use warm gold `#A87531` and cream `#FBF3E7` sparingly to direct attention.
  Gold means emphasis or priority, never automatically “implemented” or “passed”.
  Keep gold on illustrations; text uses charcoal or gray for contrast at README size.
- Rounded line caps and joins, mostly 2–3 units at a 1600-unit width. Avoid
  shadows, gradients, decorative badges and extra borders. Illustrations are
  editorial objects, separate from the shared interactive UI icon library.
- Use a CJK-capable sans-serif stack with live SVG text. Typical sizes at 1600
  units: 36 for the main heading, 25–32 for section titles, 22–24 for body copy.
  Keep both languages complete; wrap or recompose instead of shrinking one.
- Use short labels and directional connectors. A bottom shared-foundation band
  can collect common infrastructure without competing with the main story.
- Preserve accessible `title`, `desc`, `xml:lang`, a fixed `viewBox`, and an opaque
  white background so the image remains legible in light and dark README themes.
  Do not embed fonts, scripts, external images or raster previews in the SVG.

## Meaning and status

The overview is explicitly a **target workflow**. Its dashed connectors and
shared-memory band do not claim an implemented end-to-end research product.
The composition and architecture diagrams use **solid foundations / dashed
planned integration**. Every mixed-status group must say what exists and what
remains. A foundation is not full platform, real-provider, package, production
or scientific acceptance. Do not infer status from color or from a successful run.

Check current ADRs, implementation and the latest sections of verification
records before changing a status. Relevant sources for this revision:

- [App platform](adr/0007-local-app-platform.md),
  [Products](adr/0008-product-distributions.md) and [App Use](adr/0014-app-use.md):
  App-owned domain state, shared implementations, Host-owned execution and
  approvals. Each Product still has its own Host and data.
- [App Agent Plugins](adr/0027-app-agent-plugins.md) and their
  [verification](fitness/app-agent-plugins.md): local declarations, installed
  dependencies, frozen Skills/MCP and scoped tool budgets exist. This is not a
  network marketplace or remote Worker App deployment.
- [Connectors](adr/0025-connectors-app.md) and [verification](fitness/connectors.md):
  local configuration, credential ownership and session MCP foundations exist;
  catalog coverage does not prove live account acceptance for every provider.
- [Local research Projects](adr/0028-local-research-projects.md) and
  [verification](fitness/research-projects.md): goals and App record links belong
  on the Host side. They are not shared Cloud journals or complete frozen data.
- [Compute environments](fitness/ai4s-environments.md), especially its latest
  local/Docker/Compose/Slurm owner evidence: adapter acceptance is scoped;
  full production App admission, site and package integration remain separate.
- [Session artifacts](fitness/session-artifacts.md): artifact versions exist in
  sessions. The shared Task/Run loop through independent verification, human
  acceptance and shared project knowledge remains a target.

Do not silently restyle historical research evidence, measured plots, ADR
snapshots or Mermaid diagrams whose status convention differs. Preserve their
original data, legend and historical meaning.

## Sources and regeneration

The three generators use the small shared palette and line-illustration module
[scripts/codegen/research-graphics.mjs](../scripts/codegen/research-graphics.mjs).
Edit the generator, not its output. Each generator emits English and Chinese:

```sh
node scripts/codegen/overview.mjs
node scripts/codegen/building-blocks.mjs
node scripts/codegen/architecture.mjs

node scripts/codegen/overview.mjs --check
node scripts/codegen/building-blocks.mjs --check
node scripts/codegen/architecture.mjs --check
```

No npm installation is needed. Output names are `openpero-{overview,building-blocks,architecture}.svg`
and their `.zh-CN.svg` counterparts under `docs/assets/`. English README uses
unsuffixed assets. Chinese README uses `.zh-CN.svg` for each corresponding
image. The research-roadmap artwork is maintained separately.

Before publication, inspect all six renders at full width and at the README's
900px width, including Chinese glyphs, text wrapping, arrows and status legends.
XML parsing and the three `--check` commands must pass. Inkscape can export a
local preview, for example:

```sh
inkscape docs/assets/openpero-overview.svg --export-width=900 \
  --export-filename=/tmp/pero-overview.png
```

Keep preview PNGs and other review output outside the repository. These graphics
do not change runtime behavior; SVG checks do not certify product acceptance.
