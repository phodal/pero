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

`SourceCaption` now resolves a literal caption window with original
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

## Follow-up analysis: remaining correspondence gaps

The original visible navigation/highlighting repair remains verified. A deeper
read-only review on 2026-11-04 identified two remaining cases, reopening this
same tracker rather than creating a second one:

- The saved unversioned RSI snapshot has seven TeX figure targets whose exact
  original-PDF targets belong to the separately saved v1 snapshot. The resolver
  returns both, but the reader opens `reference.preview` first and accepts the
  PDF target only when its `paperId` equals the opened snapshot. Consequently,
  this valid cross-snapshot correspondence is discarded by the frontend.
  This conclusion follows from actual resolver results and the frontend guard;
  that particular browser interaction was not rerun in the follow-up review.
- A deterministic value-only reproduction gives page 1 two copies of a caption
  and page 2 one copy. `FigureCaptionLocation.match` ignores the repeated
  occurrences on page 1 and returns page 2 as unique. Ambiguity must account for
  all occurrences before choosing an anchor. No implementation was changed
  during this analysis.

At the time of that review, the runtime also lacked a compiled source map,
source/preview forward and inverse navigation, TeX selection discussion and
active reading context in Ask. The legacy source comparison used a separate
caption matcher and revealed only a page.

## Optimization and acceptance

The follow-up cases are resolved. `SourceCaption` is the single caption matcher
for navigation and source comparisons. It retains all occurrences before
deciding uniqueness; source comparisons resolve their saved exact windows
through the existing PDFium locator. The frontend accepts both version-bound
targets even when their saved snapshot IDs differ.

The active reader now reports representation, document/file identity, page and
a bounded text window. Ask saves that window through the existing context-file
owner; explicit selection discussion takes precedence. TeX selections retain
their `texPreviewId` and are checked against that preview's PDF, while their
Agent prompt explicitly identifies them as derived context. Saved original-PDF
annotations and research evidence remain bound to their original document.

Tectonic builds retain `.synctex.gz`, its digest and the staged source root,
alongside the specific preview. `TexNavigation` queries the official SyncTeX
utility; it does not parse the SyncTeX file format or estimate coordinates.
Source line buttons reveal a compiled region. Cmd/Ctrl-clicking the preview
opens the corresponding saved member and highlights its line. Old previews
offer explicit recompilation; missing tools or unmapped locations retain source
reading and expose recovery. Source maps apply to the corresponding compiled
preview; original PDFs continue to use independent content correspondence.

Verification on 2026-11-04:

- Python: 266 tests, 265 pass and one existing skip. This includes repeated
  caption occurrences across and within pages, exact comparison offsets,
  derived-context identity/text rejection, navigation inputs and PDF coordinates.
  After the final source-line/timeout changes, the four TeX tests and three
  source-figure integration tests were rerun successfully.
- Paper TypeScript, App build and `paper-chat-context.mjs` pass. The E2E used
  installed Chrome via `PERO_CHROMIUM_PATH`; no model was invoked.
- Actual saved CAAF source compiled to a 47-page preview with a retained map.
  Source `paper.tex:458` reveals page 18; querying the returned box inversely
  returns `paper.tex:458`. Both directions were exercised in Chromium.
- Actual RSI unversioned snapshot `354d56d96c2e…` retains the original PDF
  belonging to snapshot `c0ab7cf403a7…`, with visible figure highlighting.
  Ask uses the actual original document's source identity.
- TeX page/preview/figure context and selected text were handed to a local
  unsent-draft fixture using real context persistence; no Agent answer was tested.
- Light desktop and dark 490×840 source dialogs, line focus, Enter navigation,
  an unmapped README line and successful return to mapped source were inspected.
  The narrow file list scrolls separately so source text stays visible.

The official SyncTeX tool was built locally from
[`jlaurens/synctex`](https://github.com/jlaurens/synctex) commit
`04cf8e3e8665ff203248d7af78ee1129afbc1b64`; the local build replaces its hardcoded
zlib include with the system `zlib.h`. The binary and its MIT license are in
the existing Native Preview Python environment's `bin` directory. No binary
or upstream source tree is committed. Other environments discover an installed
`synctex`, the interpreter's sibling binary, or `PERO_SYNCTEX_BIN`.

The Native Paper package was updated and its saved CAAF data now has the mapped
preview. The active Native window was being switched concurrently, so the new
Native interactions were not certified in that running process; restart loads
the updated package. Current UI acceptance above is Chromium. Release packages
and non-macOS compilation were not tested.

Additional local screenshots: `source-lines.png`, `source-unmapped.png`,
`cross-snapshot-pdf.png`, `tex-selection-discuss.png` and
`source-dark-narrow-final.png` under `test-results/paper-figure-navigation/`.
