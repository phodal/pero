---
kind: issue
status: open
date: 2026-11-12
---

# Paper library rows overlap in the list pane

Selecting a paper in All papers paints title cards over neighboring rows.
Long titles and authors remain readable underneath the selected/preview
chrome, so the middle pane looks stacked instead of one row per paper.

## WHY

The library table used a parent CSS grid with subgrid rows. An earlier
repair made the list `display: contents` so rows joined the parent grid,
but that path stayed fragile: nested subgrid sizing still lets a selected
row background cover the previous paper, and the shared Button pressed
skin later reintroduced a filled title control on top of the row.

## Repair

Keep one shared column template as CSS variables on the table. The table
and list are ordinary column flex stacks; the head and each paper row are
independent grids with that template. Preview remains the row background;
the title control stays chrome-less while pressed.

Chromium and WebKit fixtures with long titles show no row/button overlap and
a transparent pressed title control. `apps/paper-agent/test/library-papers-layout.test.mjs`
pins the CSS structure. Rebuild `paper-agent` and reopen Native Papers to
accept the live library pane.

The inspector was redesigned into a research assistant panel: header with
Open Reader and overflow actions, Overview/Notes/Related tabs, honest AI
Brief unavailable state, research context, and Ask Paper scoped to the
selected paper. Deep reading stays in the reader workspace.
