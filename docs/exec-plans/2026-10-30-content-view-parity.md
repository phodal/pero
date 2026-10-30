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
- The early file receipt covered close/reopen within one session. The final
  receipts below add restart, distinct-document panes, Markdown anchors/source
  mapping and Save As. Physical native UI acceptance remains separate.
- Generic HTTP(S) Web sources now have separate retained workspace identities,
  Electron WebContentsView and native GPUI Kit/Wry engines. Actual Electron
  and hidden macOS WebKit receipts are in [Web view acceptance](../fitness/web-documents.md).
  Two-page visibility, overlays and teardown are covered. This does not supply
  MCP Apps, inline HTML admission or full browser parity. Last-URL restart
  recovery is recorded in the later acceptance receipt.
- Table sorting/filtering, column resizing, keyboard cell copy and source mapping
  are implemented with Kit DataTable; details are in [reader acceptance](../fitness/content-reader.md).
  Cell ranges, advanced editor operations, MCP Apps and the Data Agent workflow
  remain separate work; the shared icon registry is covered by this closure. Cross-platform package,
  physical native UI and assistive-technology proof is pending.

## Current delivery status

| Capability | Current implementation and verified boundary | Remaining gate |
| --- | --- | --- |
| Source admission | Typed metadata and conversation/file/App revision ownership | Real MCP resource authority and metadata |
| Markdown | Actual Desktop anchors, exact rendered/source ranges, regex and whole-word navigation pass | Arbitrary HTML/plugin anchors and assistive-technology receipts |
| Files | Host open/edit/save/Save As, copy authority, conflicts, persisted drafts and unload checkpoints | Physical native dialog interaction |
| Workspace lifecycle | Host snapshots, revision-bound source-location back/forward, restart recovery and two distinct document panes | General pane tree, lazy inactive-source restore and edit-anchor migration |
| Web | Electron and macOS Wry engines; stable ID and last URL restoration | Inline HTML, restored engine history/form/scroll and other OS receipts |
| MCP Apps | Origin namespace only; a Pero compatibility extension | Real server/resource connection, metadata, AppBridge and acceptance |
| App SDK | Actual Virtual Cell source handoff plus themed ContentIcon | Standalone Web reader still uses textarea |
| Icons | 61 bundled glyphs, shared Rust/TS associations and themed registry overrides | Arbitrary SVG/theme-package installation is outside this registry seam |
| Editor | Regex/whole-word, JSON folds, exact selection and persistent source-position navigation | Wider Editor operations and anchors that migrate through edits |
| Data projections | Kit virtualized table, Worker sort/filter, resize, cell copy, exact source ranges and compact nested JSON | Ranges/export and dataset context are Pero/Data extensions |
| Performance | Shared source indexes, real preview/syntax/transform Workers, actual 8k and 100k UI operations | Full-selection budget, large nested projections and cold distributions |
| Data Agent | Future Pero workflow, separate from Zed parity | Schema/grain/provenance, selection context and actual Agent consumption |
| Platform/accessibility | macOS hidden Electron and native compilation lanes | Physical focus/IME, screen reader and installed OS-package evidence |

## Next implementation boundary

The explicit content-flow gaps now have source implementation and real Desktop
gates: Save As, source-position history through reload and Worker transformations.
Old history geometry is discarded when its source revision/identity changes;
this is not Zed's live-edit anchor migration. File copies rebind compatible active
reading state to the destination revision. The tests preserve original source
text and authority rather than constructing a new Agent result.

Remaining infrastructure work is lazy inactive-source restore, large nested
projection and the browser's native full-selection layout cost. Two different
documents side by side are not the arbitrary pane tree or same-buffer clones.
MCP Apps and Data Agent remain separate Pero extensions, with real resource/
AppBridge and schema/grain/provenance/selection acceptance still required.
