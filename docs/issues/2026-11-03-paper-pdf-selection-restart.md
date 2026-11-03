---
kind: issue
status: resolved
---

# PDF selection lost before Desktop restart

Desktop acceptance `paper-reading` failed after restart: the Highlight toolbar was
missing even though `data-selection-ready` was true. CI traces showed the pointer
selection was written to `localStorage`, then overwritten with `selection: null`
when leaving the reader (Back to library) before Electron closed.

EmbedPDF clears the live selection when its pointer handler deactivates. The
reader persisted every `onSelectionChange(null)`, so navigation wiped the saved
range the restart path restores.

Persistence now keeps the last saved selection when live selection becomes null,
unless the user explicitly discards it (selection toolbar Close/Escape, highlight
save, or empty-space click). Restart restore is unchanged.
