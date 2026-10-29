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

## Current boundaries

- This is a Chat result reader, not the complete Zed editor/workspace. Code
  editing, multi-buffer operations, regex search, persistent reading state,
  App SDK migration and a global document cache remain separate work.
- Kit's selected Syntect backend folds multiline braces, but does not provide
  structural JSON array folding. Full JSON folding remains a functional gap;
  merely rendering an Editor does not complete that requirement.
- Record previews do not yet provide sorting, filtering, cell-range selection,
  column resizing or Data Agent dataset/chart integration.
- Preview parsing is explicitly bounded to 2 MiB and 128 columns. Complete
  source remains available. Malformed records and duplicate keys report errors;
  missing values, nulls, exact numeric spelling and source positions stay distinct.
- Large-source highlighting and native full selection can still block the
  Wasm thread. [The incident remains open](../issues/2026-10-29-content-reader-main-thread.md).
  Functionality is preserved; neither best performance nor a frame-budget pass
  is claimed.
- Desktop-owned `app_use`, `app_describe` and `app_write` results keep up to
  16 KiB inline. Larger JSON is stored by conversation and SHA-256. Both the
  Agent's ordinary `content_read` tool and the trusted UI use the same range
  and UTF-8 chunk rules. UI reads do not become Agent tool results.
- Byte reads seek into the file. JSON Pointer reads currently scan the whole
  stored source. The App producer may already have normalized numeric values;
  preserving its serialized text cannot recover previously lost precision.
- External ACP Agents control their own model context; this Host cannot
  rewrite those independent requests. Complete-file UI loading is a Desktop
  capability; native preview and installed Windows/Linux packages are not
  certified by this probe.
- MCP Apps capability negotiation, resource discovery, sandbox policy,
  `AppBridge` and `ui/*` lifecycle are not implemented. Existing iframe and
  file-read capabilities do not establish compatibility.
