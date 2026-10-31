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
