# Sessions and App navigation

Implemented 2026-10-31. Reference: the user-provided KiroCrew screenshots and
`/Users/phodal/test/KiroCrew/website/src/pages/apps/{LibraryPage,LaunchpadTile}.tsx`.
The layout is adapted to Pero's existing theme and navigation ownership.

The global sidebar contains Sessions and Projects, an Apps group with Manage
apps first followed by enabled App shortcuts, then Terminal and Settings at the
bottom. Collapsing it retains labeled icon controls. Sessions owns
the presentation of its searchable, project-grouped list alongside the existing
shared Chat panel. Clicking a workspace group name expands or collapses its
sessions in place; it does not navigate to Projects or replace the active
conversation. Host history, workspace routes, tabs and retained App panels
remain the existing owners; there is no second session store or router.

Manage apps uses an icon grid. Opening an App uses its existing content item.
Optional Apps expose their version and an always-visible action menu, with
Enable/Disable and Remove. Disabled Apps retain an Enable control. Removal
requires the inline confirmation; preparation and errors keep their existing
progress and recovery controls. The toolbar contains Refresh and Install from
folder, both with icons.

## Verification

`node tests/e2e/sessions-apps.mjs` runs Electron against a real local Host with
temporary history, a fixture ACP agent and a local frontend App. It verifies
session selection, folding by workspace name without navigation, search, new chat, catalog-generated sidebar entries, opening
from the grid, retaining an App draft across navigation, and preserving history.
It captures light/dark and narrow-window layouts in
`test-results/sessions-apps/`, alongside `result.json`.

macOS native verification used an isolated data profile and the debug Host:
searching and selecting sessions, opening Manage apps, disabling and enabling
a disposable App, and navigating with the collapsed icon sidebar. Enabled
shortcuts disappeared and returned with their catalog state.

The UI library tests, native build, WASM/web build and `npm run check` were
also run. This verifies navigation and local presentation; it does not establish
real-model, scientific App backend, screen-reader or cross-platform acceptance.

## Resizable session list (2026-11-05)

The Native/Wasm Workbench session list uses the existing GPUI splitter pattern.
Host-owned LayoutPreferences stores sessions_width (200–480px, default 280px).
Dragging, Left/Right, Home/End and double-click reset are supported. The list
shrinks to preserve 320px for Chat and is hidden below 520px of available
content width without changing the saved preference.

L0: four workbench contract tests, npm run check, and Native UI/Host debug
builds passed with nightly-2026-10-28. Native CUA inspection in an isolated
/tmp/pero-resize-profile confirmed keyboard maximum 480, drag to 328,
double-click reset to 280 and Host/Native restart restoration to 300. Dark
screenshots were captured and inspected in chat. An initial run used the old
Host while its replacement was compiling; restarting with the rebuilt Host
resolved its settings rejection.

Light theme, narrow-window rendering, Wasm interaction and signed-package
acceptance were not exercised in this increment. Narrow sizing is covered by
the contract value tests. No real model request was submitted.

### Collapsible session list (2026-11-27)

The conversation titlebar has a dedicated session-list toggle beside the
content tabs. Host preferences save its open state and width independently.
The existing splitter and narrow-window threshold apply when the list is open.

In a dark macOS Native debug preview based on `9bdd7ef93` plus this change,
the toggle reduced the four-column conversation and Desktop view to three
columns. The same draft and the active noVNC control of Blender Run
`run_3f019ddda0f588b106404c75c532639d` stayed available while collapsing and
reopening. Screenshot inspection showed Blender and the draft side by side.
The preview also restored the collapsed state after a Native and Host restart.
Reopening after restart restored the adjusted width of 298px. The Host
protocol conformance and focused layout and titlebar tests passed. Electron
runtime, light theme and signed packages were outside this check.

## Sidebar creation actions (2026-11-23)

The shared GPUI sidebar uses full-width navigation rows for Sessions and
Projects. Sessions can start a chat from the workspace group or with the New
Chat shortcut. The Projects page exposes New Research Project in its action bar.

On macOS, the local debug build passed visual inspection of both selected
rows in a Native window with an isolated profile. The Electron
`sessions-apps.mjs` fixture passed against the rebuilt WASM and local Host,
including the Projects page action, session search, and a new chat from the
keyboard shortcut. It captures both selected states in
`test-results/sessions-apps/{projects-light,sessions-light}.png`.
The older `test:sidebar` suite stops at its fixed-coordinate click for the
inferred workspace project, which is listed on the Projects page.

## ChatDock new chat (2026-11-24)

The shared Workbench ChatDock now shows a New chat action above its message
stream. It calls the existing `ChatPanel` new-chat transition, so an App-scoped
conversation starts another draft in the same scope while the App view stays
open. The action focuses the composer and keeps the earlier conversation.

L0: the Workbench WASM, web, Desktop, and Native debug builds passed. L1:
`node tests/e2e/sessions-apps.mjs` passed with a temporary Host journal, fixture
ACP Agent, and local frontend App. It opened App Chat, docked the floating
panel, clicked New chat, and observed a distinct focused empty App-scoped draft,
the retained App content, and the earlier conversation. The actual Electron
rendering was inspected in `test-results/sessions-apps/app-chat-new.png`.
No Agent prompt was submitted by this action. The Native build passed, but
computer-use app selection could not distinguish the isolated preview from
other running bundles with the same identifier; this change has no Native
runtime visual acceptance or signed-package acceptance yet.
