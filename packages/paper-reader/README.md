# @pero/paper-reader

Browser-only LaTeXML/arXiv HTML reading. No React, App SDK, Host, download,
model, storage or evidence dependencies. An `Article` is a display projection
of caller-owned frozen HTML, not a new scientific document or observation.

```ts
const reader = mountPaperReader(container, {
  source: { id, html, sourceUrl, assets },
  frameUrl: new URL('./_paper-reader/frame.html', location.href).href,
  appearance: { dark: false },
  onSelection: selection => { /* quote + source anchors, not evidence offsets */ },
  onOpenLink: url => { /* caller handles external navigation */ },
});
await reader.ready;
reader.reveal('S2');
reader.updateAppearance({ dark: true });
reader.dispose();
```

Copy `frame.html`, `reader.css`, and `vendor/ar5iv.min.css` preserving paths to
one same-origin static directory. The frame has no scripts; its parent installs
reading interactions. This avoids `about:srcdoc` navigation exceptions in Native.
The frame auto-sizes to its body; the caller owns the scroll container and its
persistent position. Mount once per immutable source, update appearance in place.

HTML is sanitized once on entry. Lists, emphasis, tables, MathML, permitted SVG
and source IDs remain DOM. Source styles and active elements are removed. Only
caller-supplied image mappings are displayed; missing images keep a placeholder
and caption. The frame CSP disallows remote images, scripts and connections.
Upstream conversion errors remain visible; this package does not repair TeX.

`outline` contains heading text, level and source anchor. `reveal` returns false
for missing anchors. `onSelection` emits text and endpoint source anchors, or
null for an empty selection. Neither DOM offsets nor anchors are evidence
coordinates. Caller-owned evidence APIs must resolve and validate quotations.

Styles are pinned ar5iv CSS with local system-font/theme overrides. See
`vendor/README.md` and `vendor/LICENSE-ar5iv`. No CDN or remote fonts.

Validation: `npm ci --prefix packages/paper-reader`, then
`npm test --prefix packages/paper-reader`. The Paper App build copies static
assets; the App's normal typecheck also checks the reader source.
