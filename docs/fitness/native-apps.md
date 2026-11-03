---
kind: verification_report
date: 2026-10-31
---

# Native App panels

This is development-build acceptance on macOS arm64 with Kit 0.8.1 and
nightly-2026-10-28, based on the current working tree. The native preview now
selects Kit's existing Fast 0.1.12 backend and WebView composition together;
the earlier App transport verification did not require that composition. PNG files
below are captured evidence; the running panels are actual Wry/WebKit views.

## Implementation

Native uses the existing stdio Host App catalog, grants and Python lifecycle.
The composition root reads the Pero product's builtin/required App names and
keeps the preview's App packages, data and preferences under its isolated data
home. An explicit environment override remains available for acceptance runs.

Each retained panel serves `pero-app://<name>/…`. Static resources are confined
to its installed asset directory. `/api/…` proxies only that enabled App's
backend, supplies its private token and preserves response status/content type.
`/host/agent` and `/host/insights` use the existing Host grant checks. Private
resolve replies are consumed before Workbench event delivery. Generic Web
sources receive none of this App transport.

The SDK receives locale, appearance and active state. Engine theme also updates
so CSS media queries agree with the workbench. Ordinary native uses docked
conversation; its floating-chat control is omitted. App chat open/compose uses the existing draft insertion path and freezes App
object references through the same context owner as Electron. Capture and general
native App UI operation return an explicit unsupported response. Declared App
data tools use the shared MCP authority and installed-route boundary. Source links open in the workspace Web view.
App-local standalone document readers remain inside the App.

## Automated acceptance

```sh
node scripts/cargo.mjs build -p pero-host
node scripts/cargo.mjs +nightly-2026-10-28 build -p pero-ui --features native-probe --bin pero-native
node tests/e2e/native-apps.mjs
node tests/e2e/native-webview.mjs
node scripts/cargo.mjs +nightly-2026-10-28 test -p pero-ui --features native --lib
node scripts/cargo.mjs +nightly-2026-10-28 check -p pero-ui --target wasm32-unknown-unknown
npm run check
```

The native App suite uses copied binaries, a temporary profile, actual React
assets, the real stdio Host and Virtual Cell's Python backend. It imports the
bundled synthetic example and runs its evaluation through authenticated GET and
POST requests. It also checks cross-App resource refusal, Host grant refusal,
absence of the Workbench bridge, retained DOM/form state, SDK and engine dark
appearance, and tab-close teardown. No model prompt or external data service is
needed. Receipts include binary and App asset SHA-256 values in
`test-results/native-apps/result.json`. A second Host saves the first run's
checkpoint, then the same native profile restarts and loads its App through
startup recovery without a manual open command; `restored.json` records this.
Hidden-window receipts deliberately keep
`visual_acceptance: false`.

The ordinary Web engine suite passes separately. Native UI tests passed 43 cases;
Wasm compilation and the repository TypeScript/theme/locale/contract/icon checks
passed. These are scoped checks, not a whole-repository or release certification.

## Visible-window observations

An isolated `Pero Apps Acceptance.app` was opened through computer use:

- Virtual Cell rendered its atlas, imported synthetic inputs and produced an
  actual evaluation after coordinate clicks. Its Open chat button opened GPUI
  alongside the live WebView. Light/dark switching retained the loaded result.
- Insights rendered through both the Apps library and the fixed sidebar shortcut;
  its `/host/insights` and Agent
  paths reached Host. Without model credentials its automatic brief visibly
  failed with Retry; no successful model result is claimed.
- Paper Agent loaded its empty library and responded to Add papers. PDF import,
  literature search and model research were not accepted in this native run.
- Switching among the retained panels showed one selected surface. Settings
  could be opened and dismissed while the App was present.

Captures live under `test-results/native-apps/`: `virtual-cell-light.png`,
`virtual-cell-chat.png`, `virtual-cell-dark.png`, `insights-dark.png` and
`paper-agent-dark.png`. `insights-sidebar-fixed.png` records the corrected
shortcut. The sidebar Insights rejection was found during this pass and tracked in [the incident](../issues/2026-10-31-native-app-embedding.md).

## Connector menu and Chat dock regression, 2026-10-31

The native preview now composes WebViews below GPUI popups rather than hiding
the whole App for a deferred menu. Both Connectors workspace menus were visibly
verified above the loaded directory before removing those redundant buttons.
Chat now has a close control inside its dock and a reopen control in the pane
bar. Actual close/reopen, saved closed state after restart and closing Chat in
a narrow window passed. Native build, 47 UI tests, App and Web engine suites,
Wasm compilation and repository checks passed. See the
[incident](../issues/2026-10-31-native-connector-menu-blank.md).

## Remaining boundaries

Native App Use/MCP, screenshot/reference attachments, embedded conversation slots,
full PDF/download workflows, physical IME/shortcut behavior, accessibility of the
WebKit child, cross-display scaling, Windows/Linux runtime and portable signed
packages remain outside this acceptance. These Apps still require their declared
Python dependencies. A successful synthetic calculation does not establish
scientific acceptance or real-provider research.


## Native App failure recovery (2026-11-03)

The failure surface presents a compact Retry action and optional technical
details, with a bounded scroll area and diagnostic-copy feedback. Refreshing
resets disclosure state. A retained WebView notifies its parent when its
loading state changes, so the parent also owns timeout failures.

Unpackaged debug previews select `target/debug/pero-host`; release previews
select `target/release/pero-host`. Portable installations still use
`bin/pero-host`, and an explicit `PERO_NATIVE_HOST` remains authoritative.
The relaunched local debug preview was observed running the debug Host.

Checks:

- Native build with `--features native --bin pero-native` passed.
- `cargo +nightly-2026-10-28 test -p pero-ui --features native --lib apps::tests`
  passed (one catalog behavior test).
- Wasm `cargo check -p pero-ui --target wasm32-unknown-unknown` passed.
- `node scripts/check/locales.mjs` and `git diff --check` passed.
- An isolated Native profile replayed the reported schema error through the
  stdio Host seam. Light/dark, a narrow window and split pane, details toggle,
  copy notification, a 60-line diagnostic scroll, Tab focus, keyboard disclosure
  and keyboard Retry were inspected. Repeated failures reset disclosure; removing
  the injected failure let Retry mount the real Paper App and its empty library.
- A static fixture without the SDK ready signal reached the real 30-second
  WebView timeout. The parent immediately displayed the same failure surface
  and its technical timeout message (`timeout.jpg`). Removing the fixture and
  retrying mounted the real Paper library again.

Local screenshots are in `test-results/native-app-error/`: `light.jpg`,
`dark.jpg`, `details-copy.jpg`, `narrow.jpg`, `long-diagnostics.jpg`,
`diagnostics-scroll.jpg`, `keyboard-retry.jpg` and `recovered.jpg`.
The injected error and long diagnostic are fixtures, not new production failures.
The isolated library contains no user papers. No packaged release was tested.
