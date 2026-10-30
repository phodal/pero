---
kind: exec_plan
status: active
date: 2026-10-30
---

# ACP content flow: integration evidence and scope cleanup

## Corrected scope and integration order

The user clarified that the target is Zed's ACP flow: conversations, streaming
messages, tool calls, permissions, and readable code/JSON results. A general file
editor is outside that goal. Data Agent and MCP Apps remain deferred.

This branch expanded into file editing and general editor/workspace behavior.
The user requested pushing and merging the current code first so others can
test, then cleaning up that excess scope. The infrastructure and File receipts
below describe current code; they do not establish ACP flow completion. Next work
must compare actual ACP workflows and separate or remove the general editing
surface without discarding useful read-only result rendering or lazy artifact IO.

The live comparison uses `/Applications/Zed.app` 1.26.2 (build
`20261028.143738`), separately from source baseline
`37faef81f74fc1bb08be9939c4cffc8ede6ced2f`. A new restricted-mode window and
disposable files preserve the user's existing project and settings.

Observed in the actual app, with captures in `test-results/zed-reference/`:

- Cmd-P opens in the focused pane. Cmd-Backslash clones the source view; opening
  two more files in that pane leaves the other pane's tab set unchanged (`05`–`08`).
- Markdown's side preview has its own view and tab, while editing focus remains
  in the source pane (`09`–`10`).
- Editing in one clone updates both texts and dirty indicators. Undo from the
  other clone reverses the shared edit (`11`–`12`).
- Closing a dirty clone collapses the empty pane without a save prompt. Closing
  the last view offers Save / Don't Save / Cancel; Cancel preserves the view
  and draft (`13`–`15`).
- Cmd-Shift-T reopens from the current pane's independent closed-item history
  (`16`). Back/forward and ordered tab cycling are different actions.

`PaneTabSet` now owns items, active/preview identities, pinned prefix, MRU,
located navigation and closed-item history. `ViewId` identifies an editor view;
the source owns its buffer and Undo. The pure model covers preview promotion,
history preview restoration, drag across the pinned boundary, keyboard close
protection, background-tab reopening, and location clearing after discarded edits.
The full contracts suite passes. Actual Desktop acceptance now passes all eight
pane/editor workflows, the separate recent-content keyboard workflow, six close
workflows, OS window close/reload, and 100k-row File checkpoint/restart/save.

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

## Original implementation order (extensions now deferred)

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

## Current implementation before ACP scope cleanup

| Capability | Current implementation and verified boundary | Remaining gate |
| --- | --- | --- |
| Source admission | Typed metadata and conversation/file/App revision ownership | MCP resource work is deferred |
| Markdown | Source and rendered preview have separate ViewIds/item kinds; side preview retains source focus; exact anchors/ranges, regex and whole-word navigation | Arbitrary HTML/plugin anchors and assistive-technology receipts |
| Files | Host open/edit/save/Save As, disk conflicts, acknowledged close/reload, bounded source/draft references and real 100k-row crash recovery | Physical native dialog interaction |
| Workspace lifecycle | General pane tree, pane-local tabs/preview/pins/MRU/closed history; same-buffer clones share Undo; lazy source restore, edit-anchor rebasing, bounded history and legacy snapshot migration | Cmd-P searches known recent descriptors; full project filesystem indexing is outside this implementation |
| Web | Electron and macOS Wry engines; stable ID and last URL restoration | Inline HTML, restored engine history/form/scroll and other OS receipts |
| MCP Apps | Separate Pero compatibility extension | Deferred by the user; no AppBridge compatibility claim |
| App SDK | Actual Virtual Cell source handoff, shared Kit Web reader and themed ContentIcon | Real provider/platform acceptance stays separate |
| Icons | 62 bundled glyphs, shared Rust/TS associations and admitted local SVG theme packages; install/select/remove and restart persistence | Final actual Settings workflow receipt is recorded below |
| Editor | Regex/whole-word, JSON folds, exact native selection, shared Undo and per-view cursor/search/scroll; shared runtime macOS keymap | Physical IME and wider IDE operations |
| Data projections | Two-dimensional Kit virtualization, Worker sort/filter and nested analysis, resize, cell copy, exact original source ranges | Ranges/export and dataset context are Pero extensions |
| Performance | Retained source indexes, actual Workers, complete 100k native EditContext selection; old whole-selection textarea Layout removed | Cold distributions and residual 58–71 ms tasks remain open; no universal frame-budget pass |
| Data Agent | Development preview and local fixtures preserved in separate commits; absent from the default product | Deferred: dataset/Agent end-to-end acceptance |
| Platform/accessibility | macOS hidden Electron and native compilation lanes | Physical focus/IME, screen reader and installed OS-package evidence |

## Integration evidence and remaining boundaries

The isolated build records every copied runtime input in
`test-results/content-reader/source-fingerprints.json`. The local Desktop gates
use real keyboard/pointer input and real temporary files/Host persistence. Only
native file-picker return values select the explicit fixture paths.

- `zed-content-parity.mjs`: eight workflows pass, including shared Undo, pane-local
  tabs, drag/pinning, same-pane source/rendered kinds, restart, light/dark and the
  configured 1000-pixel minimum width. Captures were visually inspected.
- `recent-content.mjs`: all five keyboard workflows pass after preventing late
  source materialization from stealing the active picker's focus.
- `workspace-close.mjs` and `workspace-window-close.mjs`: earlier snapshot
  `T4HKhB` passes six and seven close/reload workflows, including Cancel followed
  immediately by another close and changed-disk conflict behavior. On the final
  `SPnOdn` snapshot, the close fixture reads a newly opened Reader's null layout
  bounds before pointer input (`workspace-close.mjs:20`); that latest batch stops
  there. This is an outstanding fixture-readiness failure, not a passing final gate.
- `workspace-file-references.mjs`: 100,000 rows / 13,688,892 bytes pass actual edit,
  acknowledged checkpoint, forced process loss, restored draft, Save and Save As.
  Session metadata is 3,144 bytes, journal 653 bytes, and every observed reference
  command is below 4 KiB. A real optional App catalog error does not block this.
- `icon-themes.mjs`: all five actual Settings workflows pass on `SPnOdn`, including
  real restart and removal; three tabs restore icons with only one source loaded.
- `wide-content.mjs`: 2,001 columns, exact end-column/nested source spans, one real
  4,000-row Worker analysis and cached reopening pass on `UWtLMd`.

The final `SPnOdn` batch repeats and passes `zed-content-parity.mjs` and
`recent-content.mjs` before the close fixture failure. The remaining batch gates
were not rerun after that failure. Per-suite receipts retain their own build
boundaries; this document does not claim a fully green final aggregate.

Contracts (44 tests), pure UI (14 tests), native compilation, release-Wasm build,
TypeScript/codegen/locales/icons and the focused File/source tests pass. Host
protocol conformance exercises 39 of 78 event kinds; this is not all-event coverage.
Data preview typechecking and five Python tests pass separately.

These are source and local-runtime receipts, not Binaryen-Oz, downloaded-package,
production, physical IME or screen-reader acceptance. The canonical large-source
performance incident remains open for residual long tasks and cold distributions.
General Zed editor/IDE parity is not the product goal. MCP Apps and Data Agent are
deferred. The ACP comparison and removal/separation of excess File editing are the
next work after the requested test integration. Source location/authority must be
retained without reconstructing Agent output.
