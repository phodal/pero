# Content reader acceptance

Implementation follows [the Zed research](../design-docs/zed-content-view-data-agent-research.md).
The current acceptance gate is equivalent user operations for the first Chat
reader slice. Transport integration and output savings do not establish full
Zed editor or MCP Apps compatibility.

## Verified user operations

`node scripts/verify-content-reader.mjs --functional` copies the source into a
disposable build directory and runs a release Wasm build in real background
Electron. The synthetic fixture contains 8,000 records and 1,086,892 UTF-8 bytes,
including Chinese, integers beyond JavaScript's safe range and long decimals.
It does not call a real model.

| Operation | Evidence |
| --- | --- |
| Open a complete file-backed result | Actual Desktop IPC reads the conversation's stored file; the same reader shows all 8,000 rows. |
| Missing result and retry | The first read fails visibly; creating the fixture file and retrying opens it. |
| Keep Agent output bounded | The original tool result remains the short reference. Opening the reader adds no user turn. |
| JSON and source switching | Both views read the same immutable source. Syntax colors remain enabled for large source. |
| Native partial and whole-source copy | Actual Electron clipboard contents equal the selected original line and complete original file respectively. |
| Readonly source | Typed text cannot change the source length. |
| Find a value | Command-F opens a retained query field; actual typing and Enter find the final exact integer. Keyboard case toggling covers 8,000/zero matches, and previous/next changes the active match. |
| Collapse and reopen | View mode, query, match count and selection survive disclosure changes. |
| Nested JSON and source location | A nested object opens as properties, Back restores records, and a scalar opens at its source line. |
| Theme and narrow window | Actual screenshots cover light, dark and the Desktop minimum-width window. |

The query field uses Kit's existing source matcher and navigation. It has one
retained owner rather than reopening Kit's overlay for query echoes; that
avoids the observed first-character replacement when the viewport anchor
changes. Search supports case matching, previous/next and Escape. The native
source editor still owns text selection, syntax colors, scrolling and copying.

Core and shell checks are:

- `node scripts/cargo.mjs test -p pero-chat-ui`.
- `node --test desktop/src/main/content-artifacts.test.ts desktop/src/main/app-use.test.ts web/src/content-results.test.ts`.
- `node scripts/cargo.mjs +nightly-2026-10-28 check -p pero-ui --features native`.
- `npm run check`.

The artifact loading state tests cover cancellation, stale completions, retry
and failure. Loader tests prove exact chunk reconstruction and that a canceled
read does not deliver a completion. Loopback MCP tests use the official client:
over 1 MB of App state produces less than 2 KB of reference text, then a JSON
Pointer returns the selected value. File tests reconstruct UTF-8 exactly and
prove conversation namespace separation.

Generated receipts, source fingerprints, source digests and screenshots are
under ignored `test-results/content-reader/`. `--functional` skips Binaryen;
the ordinary verifier also optimizes Wasm with `-Oz`. `--benchmark` measures
repeated retained view switches. A one-run functional receipt is not a p95
performance certification or a cold-start benchmark.

## Source-backed table interactions (2026-10-30)

The reader now uses Kit's virtualized `DataTable` for record, value and property
projections. `TableProjection` owns transformed row indices; it never rewrites
source bytes or converts JSON numbers through floating point. Keys are built
once per sorted row. Missing, null, booleans, exact decimals, strings and
structured values have a defined type order, with stable ties and original
source order when sorting is cleared. Filtering is case-insensitive, decodes
JSON string escapes and also matches names in a property projection.

The table supports filtering with a visible result count, ascending/descending/
original order, column-width dragging, cell selection, keyboard movement and
exact cell copying. A double click or Enter expands a nested value or opens
its original source range. Sorting/filtering clear the old visual selection,
so a shifted row cannot accidentally copy the previous value. Missing cells
cannot claim an original value. Long display labels are shortened with an
ellipsis; cell copy and Source retain the complete serialized token.

A retained reader shares its preview metadata with the table and reuses it
when an unchanged immutable source switches modes. Query, sort and column
width survive those switches. The current immutable source snapshot now shares those indexes across its
inline and workspace views; it releases them when the source is released.

The existing actual Electron probe now checks filtering 8,000 rows down to 11,
exact big-integer and Unicode cell clipboard values, ArrowRight, sort/reset,
empty-filter recovery, column dragging, retained widths and source navigation
from a transformed row. It also inspects nested values and light/dark/minimum
width layouts. The shared appearance installer supplies Kit's table tokens,
including a translucent selected-cell overlay that does not cover its text.
Screenshots and performance receipts remain in `test-results/content-reader/`.
Use `--benchmark` for thirty retained source/preview switches. Full operation
long tasks are stored in `allLongTasks`, not only `measuredLongTasks`, which
covers the timed opening/switch samples.

The recorded thirty-switch release-Wasm run had median 30.2 ms, p95 32.8 ms
and maximum 369.8 ms. The full interaction trace still recorded 21 long tasks,
peaking at 776 ms around Select All. Keep the performance incident open; this
is a functionality and retained-state receipt, not a frame-budget pass.

## 2026-10-30 Worker and folding acceptance

The actual background Electron release-Wasm probe now asserts both preview
and syntax Worker requests completed without errors. The dedicated Worker
Wasm is about 174 kB before gzip; it has no GPUI startup. Preview exchange
contains column names and source spans, never a second graph of JSON values.
Revision crosses the JS boundary as bigint. Root JSON/JSONL previews above
64 KiB parse in that Worker; replacement parsing debounces 200 ms. Native and
small-source parsing stay synchronous. Worker parsing does not use the former
2 MiB synchronous-UI guard. The pure Worker test also verifies 100,000 JSONL
records, original big-number spans and u64 revision precision; this is not a
100k-row UI performance receipt.

The Kit cache applies its patch without editing the original checkout. Wasm's
blanket folding disable was removed: the probe actually clicks the JSON root
gutter to fold and unfold, then verifies full/partial native selection and
exact copying. Color, search, read-only protection and table operations remain.

Across three functional release-Wasm runs of the same 1,086,892-byte, 8,000-row
source, thirty retained switches had median about 30 ms, p95 30.6–31.3 ms and
maximum 31.5–33 ms. None of those timed samples contains a long task. The full
interaction trace still includes a 57–61 ms Select All task; the previous
trace had 21 long tasks with a 776 ms maximum. Keep the performance incident
open. Single preview/source opening samples are not a cold-start distribution.
Receipts and actual light/dark/narrow/fold screenshots remain under
`test-results/content-reader/`.

## Actual Markdown/search navigation

`tests/e2e/reader-navigation.mjs` passes on the real hidden Desktop: a heading
link scrolls to its target, opening Source selects that heading, and an actual
rendered drag hands its exact 3..11 byte range to Source and back. Canceling a
Source gesture then clearing selection cannot resurrect the old range. Kit
clears global selection before a button click, so the source button consumes
the observed selection from that pointer gesture. The observer always records
None too; it is not a last-nonempty selection cache.

Regex and Unicode whole-word matching use the typed source engine and Kit's
match painting/navigation. One Enter advances once and Shift+Enter reverses;
the reader consumes its focused search action so browser beforeinput cannot
cause a second navigation. Invalid regex is recoverable. Dark and narrow search/
error screenshots are in `test-results/reader-navigation/`; page errors are empty.

## Current boundaries

- Large nested projections and table sorting/filtering still run synchronously.
  A Worker for root parsing does not establish a bounded cost for every operation.
- Selection is one cell. Fixed Zed also uses single-cell selection; cell ranges,
  transformed export and Data Agent context are Pero extensions.
- Synchronous preview retains its 2 MiB guard and all previews have 128 columns.
  Missing/null/value identity and original numeric spelling remain distinct.
- Full native Select All still has a long task. No logical selection substitute
  or disabled highlighter is used to claim a performance pass.
- Source-position back/forward, Save As, generic pane trees, physical IME,
  assistive technology and installed cross-platform packages remain separate gates.
- Output files, SHA-256 references and UTF-8 range reads remain unchanged. JSON
  Pointer reads scan the stored source; external ACP Agents own their model context.
- MCP Apps transport/resource/official bridge and Data Agent dataset lifecycle
  remain unimplemented; generic Web embedding does not establish compatibility.

## Final combined verification

The final source snapshot matches 47 recorded source fingerprints, including the
Reader, StreamText and source table. Sequential hidden Desktop suites pass for
content/structural folds, Markdown navigation, crash recovery, Web IME, actual file
save/conflict, Web restart, retained workspace documents and real Virtual Cell
computation/source handoff. The App bundle was rebuilt from the merged SDK source;
its complete result is about 20 kB and retains App provenance. No actual model,
scientific conclusion or installed package is accepted by those local workflows.
Native shipping-feature compilation, 106 core tests, TypeScript/codegen/locales/
icons checks and Virtual Cell typechecking pass separately. The tested narrow
Workbench is 1000 px, its configured minimum; 800 px is not claimed.
