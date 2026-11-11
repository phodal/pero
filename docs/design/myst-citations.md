# Offline CSL citation rendering

The authoritative inputs remain the exact project snapshot, Markdown sources,
notebook JSON, bibliography records and optional CSL XML. Formatting is a
replaceable derived projection, shared by preview and publication codecs.

## Engine and license provenance

The exact runtime is `refkit-js@0.4.0` (Apache-2.0), using its real Hayagriva
Rust/Wasm engine, not a handwritten APA formatter or citeproc-js.

- Release source: <https://github.com/peter-gy/refkit/tree/61214d8ead34cf2aea799e7cc675e94363c432b2>.
- npm integrity: `sha512-KKhwNUnMSmzmiWJ40cGAGYjIdMgfIwyugwdi6Y+hZ53kbk7dg7aDFFvE7A95zR+eBFyzUKn1bPc3R/vNHnwYqw==`.
- The release's source fingerprint function reproduces npm `dist/build.json`:
  `3dd29458e6bbc405eac6745505a0c2c6a50aed8a5a9bfb3480f7071c0ad3626d`.
- Hayagriva revision: `e7a9e7cecbbf774fd0d5226faeec12a7f8481a2e`.
- Citationberg revision: `06a591e2f237d25e1dfdedac3f3d1494c496c52d`.
- All 89 registry archives in the exact Wasm Cargo.lock were downloaded and
  SHA-256 checked; two git dependencies and two local crates complete its
  conservative 93-package closure, including build-time crates.
- The audited code offers MIT, Apache-2.0, Unicode-3.0, CC0/0BSD and other
  permissive alternatives. No CPAL or AGPL processor is included. MIT is
  selected where offered; additional Unicode terms are retained.
- `roman-numerals-rs@3.1.0` omits a license file from its crate. Its original
  complete license was taken from the crate's recorded git revision
  `ec81337f99d8b557a6fce10f674c054050551444` in AA-Turner/roman-numerals.
- The bundled CSL styles/locales are separate CC-BY-SA 3.0 data. All 157 archive
  items' recorded attribution and source links are preserved, with the official
  full legal text. The runtime and bundled data are not modified.
- `apps/notebook/licenses/myst-csl-*.txt` contains original license texts and
  attribution, not generated paraphrases. The installed App payload includes
  these files alongside its runtime.

This establishes source/dependency correspondence, not an independently
reproducible binary build or a security certification. Upstream documents a
maintenance-only `paste@1.0.15` advisory with no patched release in its pinned
engine closure. License compatibility does not imply freedom from defects.

## Explicit project authoring extension

`pero.citation` is a Pero extension, not a claim that these are native MyST
configuration keys. It accepts only `style` and `locale`:

```yaml
version: 1
project:
  bibliography: refs.bib
  pero:
    citation:
      style: styles/local.csl
      locale: en-US
```

The default is the bundled APA Style 7th edition and `en-US`. The rendered
bibliography identifies the selected style, locale and engine version.
Page frontmatter overrides project fields individually. A relative style path
is based on the file declaring it (`myst.yml` or the page), and resolves only an
explicitly supplied `.csl` text resource. Unknown fields, missing paths, remote
paths and invalid values diagnose instead of silently selecting APA.

For notebooks, precedence is project < direct notebook metadata < frontmatter
in cell zero, consistently across every Markdown cell. Later cells do not
change page citation settings. Relative paths use the notebook's path. The
existing MyST metadata compiler owns bibliography inheritance/union.

## Pure formatting and I/O boundary

`initializeMystCitations(bytes)` accepts the bundled Wasm bytes/module.
The App shell loads the esbuild-emitted package asset relative to its module,
from the same origin; authored values never control this URL. Asset fetch has
an explicit 15-second timeout. `myst-wasm-asset.d.ts` has a distinct basename
from the runtime module to avoid TypeScript declaration shadowing.

`renderMystCitations(document, records, suppliedStyle, options)` is a pure
projection. `compileMystProjectCitations(snapshot, baseProjection)` is the
shared async project stage, used by UI and HTML export. It does no file or
network I/O and does not initialize the engine itself. Non-UI callers initialize
once with their own admitted package bytes before invoking the stage or the
source-only HTML descriptor. Callers can also pass the already-enriched typed
projection to the HTML descriptor.

The App keeps the synchronous resource graph while formatting is pending,
ignores stale completion after edits/unmount, and disables derived downloads
and print until the current projection finishes. Source recovery remains
available. Preview, HTML, print and scientific codecs consume the same current
projection; there is no UI-only citation formatting branch.

Every cite/group receives a deterministic document-path occurrence ID. Group
children are not formatted a second time. A notebook has one ordered visible
Markdown-cell context, so numeric labels and repeated references do not reset
per cell. Its bibliography is rendered once. The shared visibility rule removes
hide/remove-cell content before collecting citations, so hidden-only references
do not reappear in the bibliography. Original cells/JSON are unchanged.

## Supported scope and truthful boundaries

- Real numeric and author-date styles, grouped citations, narrative citations,
  author/year partials and recognized page/chapter/section/volume/paragraph/
  figure/line locators use the engine.
- Unknown arbitrary prefixes/suffixes retain unstyled fallback with diagnostics.
- Supplied independent style XML is data, never code. Dependent parent styles
  are not fetched. Custom locale XML is not supported; an explicit locale must
  be present in the bundled archive, or formatting diagnoses instead of silently
  substituting another locale.
- Note-class styles are explicitly unsupported because numbered note placement
  is not implemented. Their note bodies are not silently printed inline.
  XML parsing checks the validated root class, including character references.
- The engine's raw HTML is never used. Structured output is serialized with
  escaped text and fixed formatting tags. Engine links remain plain text;
  arbitrary markup is escaped. Source HTML, scripts and style data cannot add
  active tags or URLs through this boundary.
- Strict CSL-JSON decoding does not silently discard unrepresentable input.
  Unsupported conversion retains source and the existing unstyled projection.
- Project admission bounds text/asset sizes. The engine additionally checks
  2 MiB style XML, 100,000 nodes, depth 64, attribute and macro-expansion budgets,
  and macro cycles. The adapter caps records and citation groups at 1,000.
  Wasm rendering is synchronous after initialization: these are input bounds,
  not a hard worker CPU deadline. A separate worker time budget is not claimed.
- This adapter is not a claim of full CSL or MyST conformance. Standalone source
  without admitted external records/style resources does not claim project CSL
  support. Scientific formats have their own explicit loss reports.

## Verification

Real-engine tests cover grouped APA/locators, custom numeric XML, stable IDs,
notebook-global order, source preservation, safe markup, invalid/dependent/
recursive/note styles and unknown locales. Shared renderer tests verify one
bibliography. Editor tests load real pinned bytes through the esbuild data URL
loader and native Node fetch, with no engine stub or global fetch override.
Production uses a file asset, checked by the packaged-Wasm regression and the
CI browser journey. Local unit/build tests do not establish actual browser,
PDF, Word visual, or Native acceptance; those checks must be reported separately.
