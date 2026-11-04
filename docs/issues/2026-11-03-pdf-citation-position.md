---
kind: issue
status: resolved
date: 2026-11-03
---

# PDF resets after interacting with a citation target

A reference opens its frozen PDF page. Clicking or selecting inside that PDF
clears the temporary focus in the reading workspace. The PDF loading effect
then treats the missing focus documentId as a new default-document lookup,
unmounts the existing viewer and restores an earlier position (often page 1).

The reader now retains its loaded document when the temporary citation focus
is cleared. An explicit different document still triggers a lookup.

Verified in an isolated Native preview with the actual saved 47-page CAAF PDF
and its saved report. A local ACP fixture emitted the existing citation links;
no model response or scientific result was evaluated.

- Before the fix, opening citation 10 at page 15 then clicking the PDF returned
  its body to the cover while the pager initially still displayed 15.
- After the fix, clicking at citation targets on pages 15 and 25 retains the
  page and viewport. Selecting text at page 15 works; Next reaches page 16.
- Read → PDF retains page 25. Opening citation 10 again navigates to page 15,
  and a subsequent click retains that position.
- Paper Agent TypeScript checking and the app build pass.

Screenshots: `test-results/paper-reference-click/before-click-reset.png`,
`after-click-page15.png`, `after-select-page15.png`, `after-next-page16.png`,
`after-click-page25.png`, `after-read-pdf-page25.png`, and
`after-repeat-reference-page15.png` in that directory (local artifacts).
