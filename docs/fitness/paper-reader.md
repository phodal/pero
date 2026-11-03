---
kind: verification_report
date: 2026-11-03
---

# Independent scientific HTML reader

`packages/paper-reader` is the private `@pero/paper-reader` browser package.
It has no React, App SDK, Host, storage, fetch or evidence dependency. An Article
is a DOM display projection of caller-owned frozen HTML. DOMPurify runs at the
entry; the reader preserves semantic lists, emphasis, tables, MathML and source
anchors. Pinned MIT ar5iv CSS and local overrides are served inside a same-origin,
script-disabled static frame. No Native navigation exception is needed.

Paper loads its existing integrity-checked original-byte endpoint. Existing IR,
IDs, parser revisions, observations and reports are unchanged. Recorded evidence
still opens the typed block view; Back to reading restores the HTML presentation.
A failed original read exposes Retry and the old structured fallback. Selection
returns text and source anchors as discussion context, never evidence offsets.
App-owned local storage retains the HTML scroll position independently of PDF.

Image acquisition is not implemented here. The package displays only resources
provided by the caller; current Paper integration supplies no image bytes. Missing
images retain a visible placeholder/caption. Upstream TeX conversion errors stay
visible. No HTML/PDF alignment, scientific acceptance or image observation is
inferred from rendering.

## Checks

- Package behavior table: three cases pass (nested lists/emphasis/MathML/table
  spans/anchors, inactive content and absent remote resources, supplied images).
- Clean Paper `npm ci --ignore-scripts`, App typecheck and bundle pass. The local
  package is installed as a packed file dependency with `install-links=true`,
  including its DOMPurify dependency, rather than depending on an uninstalled
  symlink target. Existing App builder tests: three pass.
- Current Host release and Native debug builds pass. No Rust source was changed
  for this reader. Native initially selected an older release Host that rejected
  the existing frameOrigins declaration; rebuilding the matching Host removed
  that mismatch. The App then exposed a pre-existing early/undeclared chat event
  subscription, fixed in the App boundary; see the local incident record below.
- Chrome: actual cached `2610.27435v1` HTML, document/section jumps, actual text
  drag-selection callback, light/dark presentation and a 490x840 viewport were
  inspected. The viewport override was reset. This is a standalone package
  preview of cached source, not a new network acquisition or a research run.
- Native: actual Paper library and the saved paper opened successfully with the
  new static-frame reader, source limitation warning, heading, authors, continuous paragraphs, contribution
  list markers/emphasis and original conversion errors. Final visual evidence is under the ignored
  `test-results/paper-reader/` directory.

Screenshots include browser-light.png, browser-dark.png,
browser-narrow-selection.png and Native captures. The source HTML and preview
files there remain local and are not committed or published.

Full Electron E2E, report reopen with existing observation IDs, signed packages,
non-macOS platforms, full assistive-technology coverage and real model execution
were not verified. Unit structure preservation is distinct from scientific
correctness; the visible upstream conversion limitations remain.

[Chat event startup incident](../issues/2026-11-03-paper-chat-event-declaration.md).

Final Native screenshots: `native-final.png`, `native-reading.png` and
`native-contributions.png`. The saved contribution-list capture was reopened
and visually inspected. The Native preview is left on that actual saved paper.
