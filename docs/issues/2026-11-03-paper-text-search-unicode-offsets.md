---
kind: issue
status: resolved
github_issue: 114
github_state: closed
github_url: https://github.com/phodal/pero/issues/114
---

# Local text-search highlights drift after non-BMP characters

## Problem and reproduction

Reproduced on unmodified `master@1d4eec71fd0ff0fa6bc61f9c29a830e9e8baed4d`
on 2026-11-03 UTC, using the rebuilt Paper App in a macOS browser preview,
the actual Python backend, and an isolated persistent data directory.

1. Open Paper Agent → Add papers → Import text.
2. Set the title to `Unicode source location demo`, the original URL to
   `https://example.org/unicode-location-demo`, and keep Full text selected.
   The URL is synthetic metadata; no remote document is downloaded.
3. Paste the following three lines and save the source snapshot:

   ```text
   𝑥𝑦𝑧 🧪
   # Target
   quasarproof ends here.
   ```

4. Return to the library, search Local for `quasarproof`, and click the result.

Expected: highlight exactly `# Target\nquasarproof ends here.` and show Line 2.
Actual: highlight ` 🧪\n# Target\nquasarproof ends h` and show Line 1. The final
`ere.` is outside the highlight. The search result itself contains the complete,
correct passage.

The same result persists after restarting the actual backend and reloading the
browser. A separately imported control, `xyz 中文\n# Target\ncontrolproof ends here.`,
highlights the complete target passage and correctly shows Line 2.

## Evidence and cause

The real `/api/library/search` response returns `start: 6`, `end: 37`, and
`content: "# Target\nquasarproof ends here."`. Slicing the saved source with these
Python character positions reproduces the response exactly. The corresponding
JavaScript UTF-16 range is `[10, 41)`.

`SourceChunk.to_dict()` and `chunks()` in
`apps/paper-agent/backend/paper_agent/retrieval.py` use Python code-point
positions. `SourceLines` in `apps/paper-agent/ui-src/documents.tsx` passes them
directly to JavaScript `String.slice()`, which uses UTF-16 code units. Each
non-BMP character before a boundary contributes one extra UTF-16 unit, shifting
both the highlighted text and the calculated line number.

## Duplicate check

Searched local issue records and GitHub issues/PRs, including closed items, for
Unicode, UTF-16, non-BMP, emoji, text highlights and offsets. Reviewed #66 / #88,
#76, #109, and `2026-11-02-paper-arxiv-reading-navigation.md`.

The PDF anchor/navigation work maps extracted text to PDFium positions; this
reproduction uses a text-only snapshot with no PDF. The earlier literature
surrogate record handles malformed provider strings, not valid non-BMP text.
No matching active issue or competing PR was found at filing time.

## Accepted scope

The maintainer invited a PR in
https://github.com/phodal/pero/issues/114#issuecomment-6593963285.
PR #115 explicitly leaves this issue to its contributor.

Translate the existing code-point positions at the text-rendering boundary,
preserving the backend offset contract, immutable source content, chunk IDs,
ranking and PDF anchors. Add behavioral regression coverage to the existing
local-search flow.

Acceptance:

- Non-BMP characters before or inside a matched passage do not shift or truncate
  the highlight; highlighted text equals the saved search passage exactly.
- The displayed source line is correct.
- ASCII and BMP Chinese text continue to work.
- Saved text still opens at the same passage after backend restart/reload.
- No storage migration, source normalization or PDF-location changes.

## Verification boundary

The fix is based on `626e587d3b468ad837a743c998f8694c6bdcbac9`. `SourceLines`
translates code-point boundaries to UTF-16 in one forward pass, stopping at the
end of the selected passage. Original strings, stored offsets and chunk IDs
remain unchanged.

The existing Paper search fixture now checks four synthetic cases: ASCII/BMP
Chinese, non-BMP characters before a passage, non-BMP characters inside a passage,
and a complete source ending with an emoji. It asserts exact `textContent`, source
line and unchanged full text. The full Paper journey calls the same cases before
and after its Desktop restart, reopening saved IDs without reimporting.

Local verification:

- The assertions fail on the unchanged base with the reported offset mismatch.
- All four pass against the fixed bundle in an Electron iframe with the App's
  existing sandbox flags and the real Python backend. They also pass using saved
  IDs after stopping/restarting the backend and relaunching Electron.
- The original three-line reproduction was inspected in the browser: the full
  target passage is highlighted and Line 2 is shown.
- Light at 1280px and dark at 760px pass exact-text/line checks without horizontal
  document overflow; both screenshots were visually inspected. The preview
  supplies the existing Host context message for theme selection.
- Paper TypeScript and App bundle build pass. Reader assets are reused from an
  existing local build; PDF/GPUI Reader behavior was not exercised.
- Python: 260 tests, 259 passed and one platform skip, with CPython 3.12 and a
  canonical temporary-directory path on macOS.
- Theme, design, locale and contract generation checks, fixture syntax and
  whitespace checks pass.

GitHub closed #114 completed on 2026-11-03.

Full repository `npm run check` is blocked by the absent generated
`web/src/reader-wasm/pero_reader_web` module. The separate icon check needs the
external GPUI-kit asset checkout. Full Rust Host/Desktop, PDF, cross-platform
and signed release acceptance were not run for this change. The focused preview
replaces Desktop serving/transport; no model or literature provider was called.
