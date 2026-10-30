---
kind: exec_plan
status: active
date: 2026-10-30
---

# Complete content-view coverage and end-to-end acceptance

The scope is the content workflow in the Zed research: sources enter a workspace,
render in the right view, retain identity and interaction state, and integrate
with Apps. JSON is one projection. Output budgeting is already implemented in
part and is not the focus of this work.

Each row requires source implementation plus observable acceptance. A fixture
proves local wiring; real-provider, platform and installed-package acceptance
remain distinct. Do not mark a row complete for an interface, placeholder or
simulated result alone.

| Capability | Baseline at b2f2259 | Required implementation | Acceptance gate |
| --- | --- | --- | --- |
| Source identity and admission | Conversation-owned immutable documents | Typed conversation, file, App and MCP origins; one admission boundary and revision owner | Equal content from different authorities stays distinct; no renderer guesses authority |
| Markdown | Chat rendering only | Independent rendered/source document, links and source ranges, stable updates | Open a real Markdown source, switch modes, follow a link and return with state |
| File documents | Result documents only | Explicit open, edit/save, dirty state and external-change conflict | Real temp file open/edit/save/reopen; changed disk source cannot be silently overwritten |
| Workspace lifecycle | Retained open result tabs | Saved descriptors and reading state; reopen/restart recovery, back/forward and pane layout | Close/reopen and restart recover the same source and position without re-running tools |
| Generic Web content | Installed App iframe cache | Typed HTML/URL content item with loading, retry, navigation, context and teardown | Actual isolated Web view opens, switches, restores, fails/retries and closes cleanly |
| MCP Apps | No host implementation | Host-owned server/resource binding, preserved UI metadata, official AppBridge, CSP/sandbox and teardown | Real loopback MCP resource discovery, initialization, tool input/result, interactive tool call and teardown; external-provider evidence separate |
| App SDK consumption | GPUI source reader only | Shared reference contract and Web reader; managed App can open its source in the workspace | One actual App result opens completely, retains provenance, returns to App and keeps its state |
| Icons | Fixed shared action catalog | One content/language/App icon mapping with themed fallback and extension admission | Same source has the same icon in tabs, GPUI and Web; unknown types remain readable |
| Editor reading | Basic search, selection and brace folds | Regex/whole-word search, structural JSON folds and stable source navigation | Actual typed interaction, nested folds and source location with exact text copying |
| Structured data | Basic source-backed records | Sorting, filtering, resize, cell selection/copy and mappings | Reordered/filtered values still locate the original source and preserve precision |
| Large-source work | Known main-thread stalls | Shared parse/index lifetime, actual worker work and bounded viewport/IME paths | Full functionality retained; all interaction long tasks recorded; large datasets measured |
| Data Agent | No dataset workflow | Dataset schema/grain/provenance and table/chart/selection context | Real dataset -> view -> selected context -> source verification |
| Cross-platform/accessibility | macOS background fixture proof | Keyboard/focus, light/dark, minimum width, accessibility and platform builds | Separate OS/package receipts; physical IME and screen-reader proof identified explicitly |

## Implementation order

1. Complete typed source admission and Markdown/file/document lifecycle across GPUI and Web.
2. Build Web and MCP resource hosts against the same workspace lifecycle; use the official MCP Apps SDK.
3. Migrate a real App and verify all supported source/view kinds in one workflow.
4. Complete reading/data interactions and shared parse performance, then Data Agent consumption.
5. Run restart/error/accessibility/platform acceptance and close remaining gaps with evidence.

## Decisions

- Existing WorkspaceNavigation owns selection. Source stores own buffers;
  views own selection, search and scrolling. Host owns files, MCP credentials,
  permissions and execution. App frames do not receive those credentials.
- A source reference never grants file or tool authority. MCP server metadata
  is not reconstructed from rendered text. The current ACP route must preserve
  metadata and provide a real resource transport before claiming MCP Apps.
- Browser/HTML/MCP views use distinct source identities from installed Apps.
  Reuse geometry and lifecycle primitives, not AppCatalog entries or grants.
- Closing a view does not execute, delete or cancel its source. Restoring a view
  does not rerun an Agent tool. Missing/expired sources have explicit recovery.
- Source snapshots remain immutable. Edits and saves use a named buffer model;
  sorting and filtering retain source positions rather than rewriting source.

## Progress

- Baseline inspected at `b2f2259`; parallel local changes excluded in an isolated worktree.
- Existing result document acceptance: docs/fitness/workspace-documents.md.
- Existing reader/output acceptance: docs/fitness/content-reader.md.
- Large-source incident remains open: docs/issues/2026-10-29-content-reader-main-thread.md.
- Typed source metadata, all-text admission, Markdown rendered/source view,
  Host-owned open/save/relative links, conflict/discard and App document admission
  are implemented. Their first real workflows are recorded in
  [workspace document acceptance](../fitness/workspace-documents.md).
- Actual file and real Virtual Cell computation workflows pass in background
  macOS Electron. The App source contains 20,021 bytes, including the previously
  omitted condition details; no truncation occurs in the workspace path.
- Original code-tab retention, 1 MiB JSON/source operations and Web IME pass.
  The 1 MiB probe still records a roughly 300 ms main-thread task. Performance
  remains open, and this is release Wasm functional proof, not release-Oz or a
  downloaded package receipt.
- File close/reopen is covered within one session. Restart recovery, split
  panes, Markdown anchors/range mapping, Save As and native runtime UI proof
  remain incomplete; therefore the broader lifecycle/Markdown rows stay open.
- Generic HTTP(S) Web sources now have separate retained workspace identities,
  Electron WebContentsView and native GPUI Kit/Wry engines. Actual Electron
  and hidden macOS WebKit receipts are in [Web view acceptance](../fitness/web-documents.md).
  Two-page visibility, overlays and teardown are covered. This does not supply
  MCP Apps, inline HTML admission, restart recovery or full browser parity.
- Table sorting/filtering, column resizing, keyboard cell copy and source mapping
  are implemented with Kit DataTable; details are in [reader acceptance](../fitness/content-reader.md).
  Cell ranges, advanced editor operations, MCP Apps, unified extensible content
  icons and the Data Agent workflow remain incomplete. Cross-platform package,
  physical native UI and assistive-technology proof is pending.

## Current delivery status

| Capability | Current implementation and verified boundary | Remaining gate |
| --- | --- | --- |
| Source admission | Typed metadata and conversation/file/App revision ownership | Real MCP resource authority and metadata |
| Markdown | Heading anchors, Unicode/duplicate slugs and rendered/source range mapping implemented | Actual navigation regression receipt; arbitrary HTML/plugin anchors excluded |
| Files | Host open/edit/save, conflict preservation, persisted draft and unload checkpoints | Save As and physical native dialogs |
| Workspace lifecycle | Host snapshots, reading state, tab back/forward and two distinct document panes | Actual crash/normal quit regression; source-position history, general pane tree and lazy inactive-source restore |
| Web | Electron and macOS Wry engines; stable ID and last URL restoration | Inline HTML, restored engine history/form/scroll and other OS receipts |
| MCP Apps | Origin namespace only; a Pero compatibility extension | Real server/resource connection, metadata, AppBridge and acceptance |
| App SDK | Actual Virtual Cell source handoff plus themed ContentIcon | Standalone Web reader still uses textarea |
| Icons | 61 bundled glyphs, shared Rust/TS associations and themed registry overrides | Arbitrary SVG/theme-package installation is outside this registry seam |
| Editor | Regex/whole-word search, JSON structural folds, exact source selection and serializable ReaderState | Source-position navigation history and wider Editor operations |
| Data projections | Kit virtualized table, exact sort/filter, resize, cell copy, source ranges and compact nested JSON | Background sort/filter; ranges/export are Pero/Data extensions, not missing fixed-Zed behavior |
| Performance | Shared source parse/index lifetime, real preview/syntax Worker and native IME selection without hidden wrapping | Full-selection budget, large nested projections and cold/100k UI distributions |
| Data Agent | Future Pero workflow, separate from Zed parity | Schema/grain/provenance, selection context and actual Agent consumption |
| Platform/accessibility | macOS hidden Electron and native compilation lanes | Physical focus/IME, screen reader and installed OS-package evidence |

## Next implementation boundary

Complete the actual regression receipts before claiming the implemented rows.
Then close Save As, source-position navigation history and background table
transformations. Two different documents side by side are not Zed's arbitrary
pane tree or same-buffer clones. Workspace restore currently reads all saved
sources at startup; editors are lazy, source I/O is not yet lazy.

MCP Apps and Data Agent are separate Pero extensions. The fixed Zed source has
no official AppBridge lifecycle, and its table uses a single-cell selection;
cell ranges/export must not be mislabeled as a missing Zed feature. A real
Host MCP resource transport remains a prerequisite for that extension.
