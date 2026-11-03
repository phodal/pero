---
kind: issue
status: resolved
---

# Imported molecular thumbnails overlapped the Viewer

The first browser screenshots for the imported-file redesign showed molecular
images covering the toolbar and gallery. Both the existing 3D illustration and
the imported-record grid used `.molecule-canvas`; the illustration's global
absolute-position rule therefore applied to each thumbnail.

Imported-record classes now use the App-specific `sv-molecule-` prefix. The
shared illustration and its geometry are unchanged. Browser acceptance checks
that every structure image remains inside its own selectable card, then verifies
pointer selection, keyboard selection and the resizable inspector. CI screenshots
remain the visual acceptance gate, independent of typecheck and unit results.

The containment regression passed in [CI run 41559708803](https://github.com/phodal/pero/actions/runs/41559708803).
The light, dark and narrow molecular screenshots in its
[evidence artifact](https://github.com/phodal/pero/actions/runs/41559708803/artifacts/13195937613)
were inspected: structures remain within their cards and the toolbar remains
unobstructed.
