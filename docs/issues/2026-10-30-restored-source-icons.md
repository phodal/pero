---
kind: incident
status: resolved
---

# Inactive restored document tabs lose their source icons

## What

The actual icon theme gate on release-Wasm snapshot
`pero-content-release-L55R4N` passed installation, selection, Settings close,
opening Rust/JSON/unknown files, and switching light/dark artwork. After a real
restart, the inactive Rust and JSON tabs returned generic `file` icons instead
of their selected theme assets. The active unknown-extension document retained
its bundled fallback. No source data or selected-theme preference was lost.

The exact actual/expected paths are in that snapshot's
`test-results/icon-themes/result.json` and `failure.json`. Only the active
unknown-extension document appears in `documents`; this is the intended lazy
source materialization behavior.

## Why and repair

`Workbench::document_label` used the content icon registry for materialized
Readers, but its deferred-source branch used only the saved title and a literal
`file`. The saved `DocumentHeader` already contains source format, explicit
language, and title, so choosing an icon requires no source read.

Both branches now resolve through the same source-icon entry point using that
metadata. The existing content registry remains the sole association owner;
theme variants and bundled fallback are unchanged. The gate still checks
inactive restored tabs without activating them or loading their source bodies.
The next actual `pero-content-release-cdw5Co` run confirmed the metadata fix:
inactive tabs resolved the correct bundled Rust/JSON icons. It also exposed a
second startup gap: the selected package remained on disk, but the renderer's
theme state was empty. Host emitted its initial icon snapshot before the Web
renderer subscribed, and Desktop forwards those events without replaying them.
The Web bootstrap queried workbench preferences after subscribing but omitted
the existing icon catalog `get` request.

Bootstrap now requests that same Host-owned icon snapshot after installing its
event listener, alongside the existing preference query. This adds no cache,
selection owner, source loading, or alternate restoration path.

## Actual verification

The fresh release-Wasm `pero-content-release-SPnOdn` build passes all five actual
Settings workflows: install, select, themed/bundled fallback, dark/light variant,
real Host/Desktop restart and confirmed removal. The restarted workspace has
three tab icons but only one materialized document, asserted by the unchanged
interaction flow; inactive source bodies stay deferred. Removal clears the disk
package and saved selection and restores bundled icons. No page errors occur.
The receipt is `test-results/icon-themes/result.json`, with light/dark/restored/
removed screenshots. Native compilation and TypeScript checks pass separately.
