# Workspace content and shared Chat verification

Date: 2026-10-29. Target: macOS arm64, development Electron build.
Source: the working tree above `93044af`, including parallel App Chat/App Use
work. These results are development acceptance, not signed-package or real-model
acceptance. The decision is [ADR 0013](../adr/0013-workspace-content-tabs.md).

## Implemented slice

- `crates/pero-ui/src/workspace.rs` owns stable Conversation, Project, Task and
  App identities, open/selected content, deduplication, neighbor selection,
  source reconciliation and keyboard cycling as value transitions.
- `workspace_view.rs` projects source titles/icons into one content tab strip
  and uses the existing shared ChatPanel beside Project/Task/App content.
  Closing a tab removes the view. Source deletion/disable uses the existing
  Host controls and reconciles to the adjacent available content.
- `LayoutPreferences` stores chat visibility and a preferred width of 320–640
  pixels through the existing Host workbench settings. Narrow windows do not
  overwrite the saved preferred width. The divider accepts pointer dragging
  and Left/Right keys, has a named splitter role and visible keyboard focus.
- The App iframe uses its GPUI slot's actual prepaint bounds, including space
  taken by global errors. It remains mounted across view switches and tab
  closure; disable/uninstall/disconnect retains the existing cleanup boundary.
- `packages/icons/catalog.json` is the shared semantic catalog: 48 icons,
  including nine selected Kit assets. `npm run gen:icons` generates GPUI assets
  and Web SDK artwork; `npm run check` checks drift. All selected assets are
  bundled. The unsupported SDK `family` parameter was removed.
- Conversation content exposes its real session and logs. Placeholder overview,
  changes and verification tabs were removed. Task/Run verification remains
  with its existing owner.

## Checks observed

| Level | Command | Result |
| --- | --- | --- |
| L0 | `npm run build` | Passed: Apps, both Wasm entries, Host, Worker, Web, Desktop |
| L0 | `npm run check` | Passed: TypeScript, theme, 536 bilingual messages, contracts, 48 shared icons |
| L0 | `npm test` | Passed: workspace transitions, layout rules, runtime persistence and existing Rust suites |
| L0 | `node tests/contracts/host.mjs` | Passed: legacy settings defaults, explicit layout save/restart, existing protocol cases; 33/48 event kinds observed |
| L0 | `node scripts/cargo.mjs +nightly-2026-10-28 check --locked -p pero-ui --features native --bin pero-native` | Passed; native preview only, no native WebView claim |
| L1 | `node tests/e2e/workbench.mjs` | Passed: streaming, followup, cancel, permission, long stream, reader scroll, history reload, locale, dark and narrow |
| L1 | `node tests/e2e/apps.mjs` | Passed: actual App installation, Python calculation/import, document retention, shared Chat, disable/restart, locale and narrow |
| L1 | `npm run test:sidebar` | Passed: project/task selection, pending HTTP stability, shared task Chat, settings persistence and error recovery |
| L1 | `npm run test:workspace` | Passed: ten workflow checks, no frontend errors |

The workspace suite sends one prompt to an ACP fixture and checks that App
compose only fills its draft. It verifies separate unsent drafts, forward and
reverse tab switching, closing/reopening a view, source-conversation deletion,
App parameter retention, pointer and keyboard resizing, Host preference restart,
light/dark and narrow layouts, visible global save errors and App disable/recovery.
It also confirms that closing the final App tab returns to the library and that
explicitly reopening the App restores the same retained document.

An intermediate run encountered the parallel App Use SDK's runtime schema
compiler being blocked by App CSP. After that parallel implementation switched
to validation without eval, the assembled build and final workspace/App suites
passed. This record does not claim acceptance of App Use tools or permissions.


## Commit scope verification

Before commit, the selected changes were exported into an independent source
snapshot that excludes the concurrent App Use implementation. `npm run build`,
`npm run check`, `npm test`, Host protocol conformance, `test:workspace` and
`test:sidebar` passed in that snapshot. The existing Desktop adapter remains
the owner of task selection; duplicate renderer writes were removed before
freezing the source. The sidebar test now waits for pagination after mounting
the task page and derives the same-name checkout fixture from the actual source
folder name, so restart and isolated-source validation do not depend on a
startup response order or a checkout named `pero`.

Frozen-source logs, the source-tree identifier and captures are retained in
`test-results/workspace-commit/`. These establish the committed workbench slice
independently of uncommitted App Use changes.

## Captures and limits

Machine-readable results and screenshots are in `test-results/workspace/`:
`result.json`, `conversation-light.png`, `app-chat-light.png`,
`retained-app-light.png`, `workspace-dark.png`, `narrow-chat.png`,
`narrow-app.png`, `restored-layout.png`, `app-error-layout.png`,
`disabled-app-error.png` and `app-recovered.png`.
Project/task screenshots are in `test-results/sidebar/`, including
`02-pero-tasks.png`, `03-task-detail.png` and `03-task-chat.png`.

Tabs are current-window state and do not restore across restart in this slice.
Ctrl+Tab/Ctrl+Shift+Tab cycle content while focus is in the GPUI tree; iframe
key events do not cross documents. App manifests still declare one panel and
use the generic App content icon; package-defined logos are a separate change.
Arbitrary external websites, WebContentsView, free pane docking, native WebView,
real provider/model execution and signed installation were not added or certified.
