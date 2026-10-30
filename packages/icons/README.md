# Shared content icons

`catalog.json` admits bundled, licensed glyphs and aliases. `content.json` maps
content formats, code languages, filenames, suffixes and built-in App IDs to
those glyphs. `node scripts/generate-icons.mjs` produces the same association
data for Rust and TypeScript, plus the existing GPUI and React artwork.

Resolve the known format before guessing from a filename. A declared language
wins over a conflicting suffix, and JSON/JSONL/Markdown kinds keep their format
icon. Otherwise exact filenames take precedence over the longest matching
suffix. Unknown code uses `file-code`, an unknown file uses `file`, and an
unknown App uses `layout-grid`. A content icon never grants file/App authority.

GPUI uses `UiIcon::for_document(document, dark)` and `UiIcon::for_app(name, dark)`.
A composition root that accepts custom contributions can keep its own
`ContentIconRegistry`, resolve `ContentIconInput`, and convert the validated
glyph with `UiIcon::from_content`. Registry updates return values; the owner
requests any UI redraw.

Apps import `ContentIcon` from `@pero/app-sdk/ui`. It shares `AppProvider`'s
theme and renders the same themed SVG as the ordinary `Icon`:

```tsx
<ContentIcon source={{kind:'code',language:'rust',path:'analysis.rs'}} />
```

The registry is an extension seam for associations to **existing bundled
glyphs**, including a different light/dark choice. Register before mounting a
view or request a renderer update after changing a registry:

```ts
import {ContentIconRegistry} from '@pero/app-sdk';
const icons = new ContentIconRegistry();
icons.register({type:'extensions',value:'.result.json'}, 'database', 'network');
```

Removing a contribution restores the built-in rule. The owning UI can pass
that registry to `<ContentIcon registry={icons} source={...}/>`; a declared
JSON source still keeps its explicit format rule. This does not introduce an
App manifest field, arbitrary remote SVG loading, or a full icon-theme package
installer. Glyphs use `currentColor`, so normal theme colors and visible labels
remain responsible for contrast and meaning.

`node --test packages/icons/content.test.ts` tests association precedence,
unknown kinds and reversible theme overrides. The matching Rust behavior test
lives in `pero-contracts::content_icon`; neither test depends on a native window.

## Local icon themes

Settings → Theme → Icon theme imports a JSON package, selects it, or removes it.
The runtime retains packages beside its settings in `icon-themes/<id>.json` and
persists the selected ID in the existing `icon_theme` settings key.
`tests/fixtures/icon-themes/source-shapes.json` is a complete sample.

The version 1 package has `id`, `name`, `icons`, and `associations`. IDs use
lowercase ASCII letters, digits, `-` and `_`. Each glyph has an embedded `light`
SVG and optional `dark` SVG; a missing dark variant uses light. Associations use
`kinds`, `languages`, `filenames`, `extensions` and `apps`, following the same
source precedence as built-in icons. They may reference an embedded glyph or a
bundled catalog name. Missing associations retain readable built-in fallback.

Import/load parses SVG once. The supported subset is SVG vector shapes,
groups, gradients, local `use`/clip/mask references, titles and descriptions.
DTD, processing instructions, script/event attributes, stylesheets and inline
CSS, `foreignObject`, text/fonts, filters, animation, raster images and external
resource references are rejected with an import error. The original package
file is retained when an installed copy is removed. GPUI uses its existing
monochrome SVG painter; `currentColor` follows the interface palette. Asset paths
include the actual SVG digest so replacement glyphs do not reuse stale drawings.
