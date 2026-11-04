---
kind: verification_report
date: 2026-11-03
---

# Paper reading views and real TeX preview

Scope: local macOS arm64 development build, changes based on `2ffd9e78`.
The user's choice is a typeset TeX preview with source inspection as a secondary
entry. The reading header now has one row with Read/PDF/TeX/Original toggles.

## Actual paper and compilation

The already approved arXiv `2610.27435v1` source archive was compiled using
Tectonic 0.17.0, including `rsi_harness.tex`, `ailab.cls`, bibliography, logo and
seven figure PDFs. No original PDF was substituted for compilation output.

- Source archive SHA-256:
  `d685f8dca43eab3c91e88a8558ede027c566e9f2ca617384b54984004f61218b`.
- Preview ID:
  `b106006c76a6000183b47f6cff8c527e9612fe1d08e163969f953b49c4f6b223`.
- Result: 38 pages, 7,999,263 bytes. Text inspection found zero unresolved `??`
  references and zero raw `\contribution` macros.
- Visual inspection covered pages 1, 3, 4, 6, 10 and 38: title, authors,
  affiliations, contribution notes, algorithm, formulas, tables and figures.
- Tectonic reports an invalid-UTF-8 warning in its bundled `algorithm.sty`.
  The warning is retained in the preview and source details; the inspected
  algorithm page rendered normally. Compilation is not a byte-identity claim
  against arXiv's published PDF.

The first cold package download attempt timed out. A retry using the retained
package cache completed. The App exposes the running state and diagnostics,
then explicit retry; the normal runner bounds an attempt to 180 seconds.

## UI verification

Native Preview was updated from the current local build and opened the user's
actual paper data. It shows the compiled 38-page preview, one-row header and a
separate source dialog. The main TeX file opens automatically. Escape closes the
dialog, restores focus and leaves the header and preview in place. The existing
Data/Paper workspace tabs and sidebar width were retained.

An isolated loopback browser profile uses a copy of the actual approved source
data and the real Python backend. It verified:

- Read/PDF/TeX/Original switching; Original names the fixed official HTML URL
  associated with the selected Read source.
- Separate PDF/TeX page and zoom state: TeX page 10 and original PDF page 4
  retain their respective state while switching.
- Light desktop and dark 490×840 layouts. At 490px the document width is 490px,
  the toolbar scroll width equals its 360px available width, and all four
  toggles remain visible. Header height is 36px with top offset zero.
- Narrow zoom menu, Fit Page, source dialog stacking and keyboard dismissal.
  The stacked source dialog stays within the viewport with no horizontal
  overflow (456px outer width).

Local screenshots and rendered pages are in the ignored
`test-results/paper-reading-views/` directory, including
`native-tex-final.png`, `native-source-final.png`,
`tex-dark-narrow-final.png` and `source-dark-narrow-final.png`.

## Embedded original

The Original toggle embeds the fixed official source URL in a sandboxed iframe,
with an external-open link above it. Native initially displayed a blank frame:
the App response's default same-origin CSP and native navigation handler both
refused external frames. `permissions.frameOrigins` now declares exact HTTPS
origins at the existing manifest boundary. Paper declares only `https://arxiv.org`.
Both shells derive their frame policy from the private Host descriptor; Native
also accepts SDK IPC only from its own App origin.

After rebuilding/restarting the actual Native shell and Host, the embedded
`https://arxiv.org/html/2610.27435v1` displayed arXiv's header, authors, abstract
and document scroll area. The existing workspace tabs and 242px sidebar were
retained. Screenshot: `native-original-final.png`. The original site's visible
contribution-macro conversion errors are retained; iframe embedding does not
repair the publisher's HTML. Other sites need their own explicit frame origin
declaration and may also refuse embedding; the external-open link stays available.

## Checks and limits

- Pinned Python environment: 251 tests, 250 pass with one existing skip. Use
  `TMPDIR=/private/tmp` on macOS; the PC-Gym tests reject a symlinked temp root.
- Paper TypeScript typecheck, UI bundle, three App-builder tests and changed
  E2E script syntax checks pass.
- TeX main-file selection and compilation outcome tables cover ambiguous
  entries, comment-only declarations and failed/completed jobs.
- App runtime tests: 27 pass, including exact frame-origin declarations. Three
  Desktop transport tests pass under Node 24 with `--experimental-transform-types`,
  including declared/default frame CSP. Root TypeScript and generated contracts
  check pass. Native and Host builds pass and the original iframe was inspected
  in the actual macOS Native app.
- Full Electron E2E, signed release packages and non-macOS compilation were
  not verified in this change. The runner currently requires macOS/Tectonic.

Read remains the existing official-HTML parser. Upstream conversion errors and
partial-parse limitations remain explicit; this change does not establish
HTML↔PDF paragraph alignment or repair arXiv's own HTML conversion. The locally
compiled preview never becomes original-PDF annotation or research evidence.

## Library and saved text layout, 2026-11-04

The macOS development build based on `837a812c` was inspected in a loopback
browser against a copy of the Native library. Six saved library entries show
authors below titles and providers in a separate column. The reading preview
uses actual saved text, with 18px titles and 14px paragraphs. Saved text without
usable headings has no outline. Light, dark, Chinese, English, and 480px layouts
were inspected. Returning from a real text hit retained all 12 results.
Screenshots are under `test-results/paper-library-ui/`.

TypeScript, bundle build, root checks and the three library availability tests
passed. The Electron fixture run passed the initial PDF search reveal. Its
repeated reveal with the locate response held reported page 1 while waiting
for page 2. Full Desktop acceptance remains open for that interaction.
