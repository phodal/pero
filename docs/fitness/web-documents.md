# Workspace Web views

The workspace now owns a Web source independently of installed Apps, files
and conversations. `WebDocument` retains the initial normalized URL as its
identity while the browser engine owns the current URL, title and history.
Opening the initial source again activates the retained engine and form state;
closing its tab releases that engine. This is the HTTP(S) source slice of the
[active content-view matrix](../exec-plans/2026-10-30-content-view-parity.md).

## Implementation

- The GPUI toolbar provides address entry, Back/Forward availability, Reload,
  loading and failure state. Cmd/Ctrl-L, the globe action and the Desktop menu
  open address entry. Native page keyboard routing still needs physical proof.
- Electron owns sandboxed `WebContentsView` children without preload, Node or
  Host/App bridges. `WebCommand` is private renderer-to-engine IPC; it is not a
  Host stdin command. Page permission requests are denied in this slice.
- Native uses the existing GPUI Kit `gpui-webview`/Wry integration. WebKit on
  macOS supplies actual navigation capabilities. Linux composition selects
  X11; the Windows composition option is set before application startup.
- Both adapters hide inactive/covered children and retain them while another
  workspace source is selected. Narrow content-with-chat layouts hide the
  embedded child. One source cannot cover another tab or a settings overlay.
- Navigation admission accepts HTTP(S). File opening remains the explicit
  Host-owned document workflow. New-window requests navigate the current page.
- Native mount/navigation errors expose failure and Reload recovery. A 30-second
  load deadline handles failures before WebKit commits, where Wry supplies no
  page-start event. It is a timeout, not an HTTP status diagnosis.

## Reproduce

From a configured GPUI Kit checkout with the existing fonts and App dependencies:

```sh
PERO_GPUI_KIT_PATH=/path/to/gpui-kit node scripts/verify-content-reader.mjs --functional --web-documents --app-documents
PERO_GPUI_KIT_PATH=/path/to/gpui-kit node scripts/cargo.mjs +nightly-2026-10-28 build --locked -p pero-ui --features native-probe --bin pero-native
node tests/e2e/native-webview.mjs
```

`--functional` builds release Wasm without the extra wasm-opt pass. The verifier
snapshots sources, builds/copies its Host, and builds Desktop and renderer in
that snapshot. Its hashes and source root are recorded under
`test-results/content-reader/`. Run Electron suites sequentially against the
same root using `PERO_CONTENT_TEST_ROOT`; do not mix in concurrent build outputs.

The opt-in `native-probe` feature exposes only diagnostic engine evaluation for
the native acceptance program. Ordinary `native` builds exclude it. The probe
launches a copied executable with a hidden, unfocused GPUI window, loopback
fixtures and no Host, Agent, credentials or URL-handler registration. It does
not activate the user's desktop.

## Observed on macOS, 2026-10-30

The actual hidden Electron suite passes:

- An actual browser child renders a page carrying `X-Frame-Options: DENY`.
- Page code has neither `window.pero` nor Node `require`.
- Switching workspace routes and reopening retains the same engine ID, DOM
  identity and input value; it does not reload the page.
- Real page navigation drives Back/Forward. HTTP 500 is visible as Failed;
  Reload renders the recovered response. A file URL leaves the Web source intact.
- Two separately opened Web sources show one child at a time. Opening settings
  hides the child; choosing dark appearance reveals it again. A narrow window
  remains operable, and tab close destroys the corresponding webContents.

`test-results/web-documents/` holds the receipt and screenshots. The workspace
canvas capture shows the chrome; a separate engine capture shows the page.
They are not a composite OS screenshot of the native child over the canvas.

The actual hidden macOS Wry suite passes page DOM inspection, absence of the
Host bridge, retained DOM/form state, engine Back/Forward capabilities and
complete teardown. Two real native child handles also pass visibility
reconciliation for inactive and covered sources. Hidden GPUI windows do not
paint, so that part drives the same layout/visibility boundary explicitly;
it does not certify native compositing, physical pointer or keyboard focus.
Its receipt deliberately records `visual_acceptance: false`. Receipts and
captured native logs are in `test-results/native-webview/`.

Native shipping-feature compilation and TypeScript/generated contract/locale
checks pass separately. The final snapshot also passes, sequentially: real
file edit/save/conflict, real Virtual Cell computation/source handoff, retained
code document, 1 MiB source/JSON reading and Web IME suites. No Agent/model,
remote deployment or installed-package acceptance is implied.

## Open boundaries

This does not implement MCP Apps, a standalone HTML source, browser popups,
download UI, permission prompts, workspace restart restoration or App authority
inside a generic page. Native Wry Finished reports rendering completion rather
than an HTTP 2xx result; cross-platform HTTP failure callbacks are unavailable.
The native HTTP(S) navigation policy also applies to subframes, so pages that
navigate frames to about/data/blob URLs are outside accepted coverage. Native
page Cmd-L/focus and composed screenshots need physical UI verification.
Windows/Linux runtime and installed-package acceptance remain open; Linux
Wayland is unsupported by this integration.
