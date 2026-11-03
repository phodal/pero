---
kind: verification_report
date: 2026-11-03
---

# Figures in Paper answers

Paper questions can find a relevant figure in an approved matching TeX archive,
read its original source lines, request its image, and embed that image in the
final Chat answer. `research-source-read` adds `operation=figures` with `paperId`
and an optional caption/label/path query. Associations are literal and retain
ambiguous or missing members. Adjacent images in one figure environment keep
their own captions and labels.

Existing raster previews and single-page PDF figures return bounded PNG images
through the existing MCP image representation. PDFium renders PDFs in a bounded
child process; TeX is not compiled. Original archive/member records stay intact.
Derived PDF previews live in `source-figure-previews`, with separate original and
preview hashes. Source-image evidence records remain `visualReview=not_reviewed`.

The MCP metadata supplies `answerImage.markdown`, using
`pero-image://<PNG-sha256>`. Shared Chat resolves that reference against actual
image content delivered in this conversation. It uses the existing journal/ACP
history to recover images after restart. No App-private HTTP URL, external image
hosting, filesystem lookup, base64 prose or global image registry is required.

Text-only providers retain tool images in the conversation while sending an
explicit unread-pixels notice with the tool's text metadata to the model. User
image attachments still require declared image capability; image-capable models
retain the existing bounded PNG/JPEG input path.

## Actual Native question

The isolated Native profile copied the existing approved archive for
`2610.27435v1`. The normal Paper Ask action provided the selected paper context;
the built-in `pero` Agent used the configured `deepseek-chat` provider. The
question requested an explanation of the HE/ER ablations with the original
figure, caption and TeX location, without new downloads or experiments.

The actual journal records `figures`, `list`, `read` and `image` source operations.
The final model answer embedded the exact returned image reference and disclosed
that it had not inspected the pixels. Native Chat visibly rendered the original
plot, caption and source location. Terminating and restarting the Native process
restored the image; tool calls remained eight, with one turn and one request
header, so recovery did not rerun inference or image acquisition.

| Observed identity | SHA-256 / location |
| --- | --- |
| Approved archive | `d685f8dca43eab3c91e88a8558ede027c566e9f2ca617384b54984004f61218b` |
| Original figure PDF | `54a7e0165a498515e06a18a1b48683d80f4f27fd9a8596690c81e6454774a3cf` |
| Delivered PNG, 476 × 267 | `d3a0c75381f2cce3ec673c6bb1689b741bcd845955ffc3c0da96c03866ad7b22` |
| TeX association | `rsi_harness.tex` lines 813–815, `figure05_ablations.pdf`, `fig:ablation-comparisons` |

The source image was inspected locally. It preserves the original plot and
separate axes. This verifies source delivery and display, not the paper's
scientific claims or an independent reproduction. No new source acquisition,
TeX compilation or experiment occurred.

## Checks

- Paper Python suite: 260 tests, 259 passed and one existing platform skip, using
  the configured Python environment and `TMPDIR=/private/tmp`.
- OpenAI provider and ACP: `go test -race ./providers/openai ./acp` passed.
  Loopback tests cover real image input for declared image models, text-only
  tool projection, retained image bytes, and rejection of user images without
  image capability.
- App-use adapter: nine tests passed, including exact image metadata/reference
  and invalid image/provenance rejection.
- Chat functional library: 17 tests passed. The Native integration test verifies
  image replay/deduplication, conversation isolation and existing data-URL images.
- Native application builds and the shared WASM Chat target checks successfully.
- Paper TypeScript and App bundling pass. The running Native UI was inspected
  at 420px and 320px chat widths, in light/dark themes, with process restart.
  Original images retain their colors and fit the available width.

The deterministic ACP driver in `tests/fixtures/paper-figures.mjs` independently
checks real approved source reads and MCP image delivery. Its answer visibly
identifies itself as a fixture; the real-provider run above is separate.

Local ignored evidence is in `test-results/paper-answer-figures/`:
`native-live.json`, `native-live-answer.png`, `native-live-replayed.png`,
`native-narrow-answer.png`, `native-dark-answer.png`, `real-source.json` and
`native-delivery.json`. No credentials, binary figures or screenshots are
committed. This pass does not certify Electron rendering, other operating
systems or a real image-capable provider. Macro-dependent mappings, multi-page
PDFs, EPS and SVG conversion remain unresolved.

## Figure source navigation and readable side-chat figures

Follow-up verified on 2026-11-03 against master `8fb38958` plus this change.
Actual delivered image bytes bind to `pero-app-location` archive/member links.
The same projection upgrades historical unlinked Markdown images during journal
replay. Research images receive separate paragraphs: mixed text/image flow
otherwise reduces unsized images to line-height icons. Other web images and
code samples retain their existing representation.

An immutable `FigureReference` finds literal TeX caption anchors in an existing
PDF compiled from the same approved archive. A unique page is returned with its
preview/document/file hashes and up to 4800 characters of page text through
`research-source-read operation=reference`. It does not download or compile,
assert vision, or turn derived TeX PDF text into independent original-PDF evidence.
Missing or ambiguous page anchors open the original figure and TeX lines.

The isolated Native profile used the real saved archive and real MCP reads. Its
ACP fixture emitted an old unlinked image embedded within caption prose; Chat
displayed a readable standalone plot at 320px and 420px panel widths. Clicking
the restored answer opened TeX page 10/38 and visibly showed Figure 5 and its
body explanation. The reference operation returned 2975 characters from that
exact PDF page. Temporarily withholding only the QA profile's cached TeX index
opened the original plot and `rsi_harness.tex` lines 813–815 instead; the index
was restored after the check. Light/dark themes and keyboard Escape dismissal
were inspected. No model inference, source download or experiment was performed
in this follow-up; the earlier real-provider run remains separate evidence.

Local screenshots and source-reference JSON are in the ignored directory
`test-results/paper-figure-references/`: `native-reference.png`,
`native-narrow.png`, `native-light.png`, `native-inline-figure.png`, and
`native-fallback.png`. Source tests cover missing members, exact archives,
literal/TeX-fragment captions, duplicate page anchors and the reference read
route. The Python suite ran 263 cases (262 passed, one existing skip);
App-use passed nine tests and Chat passed 20 pure tests. Paper typechecking,
the native build and the shared WASM Chat check pass.
