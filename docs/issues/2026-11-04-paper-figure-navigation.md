---
kind: issue
status: resolved
date: 2026-11-04
---

# Figure references lose highlighting and PDF correspondence

Chat source images opened a matched TeX preview page without a text region.
The same reference had no original-PDF target. Switching to PDF therefore
restored an unrelated reading position. Hidden viewers could also consume a
reveal before becoming visible.

`FigureCaptionLocation` now resolves a literal caption window with original
character offsets, allowing PDF whitespace changes while retaining ambiguous
and missing matches as unresolved. PDFium resolves that window to verified
rectangles in each document independently. Original PDFs must match the
approved source's explicit arXiv work and revision. No compilation, download,
page-number copying or guessed figure box is performed by reference resolution.

The reader passes the same temporary region representation to both PDF and
TeX viewers, applies it when the viewer becomes active, and retains the current
PDF view for subsequent image links. Switching representations reveals the
same figure using that representation's own target. An unresolved target shows
an explicit status and an action to inspect the original image and TeX lines.
These highlights are navigation cues; they do not create saved annotations.

Verification on local macOS development sources:

- Python suite: 264 tests, one existing skip. A real PDFium fixture places the
  same caption on original page 1 and compiled page 2 and verifies both regions.
  The core table covers missing, repeated, macro-fragment and wrapped captions.
- Paper TypeScript checking and App build pass.
- Chromium with an isolated copy of the user's saved CAAF paper: figure 8
  reveals TeX page 18 and original PDF page 19 with caption highlights. Figure
  13 reveals page 30, preserving PDF mode; switching back to TeX reveals its
  own target. Repeated image navigation and keyboard switching were inspected.
- At 490 × 840 in dark mode, the document has no horizontal overflow and the
  target remains visible. Light desktop screenshots were also inspected.
- Native Preview reloaded the updated App package, with installed backend and
  frontend hashes matching the checkout. Actual chat-image navigation showed
  the figure 7 caption highlighted on TeX page 17; the user confirmed it works.

Screenshots and the Python log are local ignored artifacts in
`test-results/paper-figure-navigation/`. No live arXiv acquisition or scientific
validation is implied by this saved-document navigation check.
