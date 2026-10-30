---
kind: verification_report
date: 2026-10-30
---

# Optional GPUI Fast native composition

The `pero-ui/native-fast` feature selects GPUI Fast for Kit and `gpui-webview`
together. It retains the existing Wry engine, Web source identity, navigation,
visibility policy and Host boundaries. `native`, release packaging and the
ordinary Wasm build keep their existing backend. This is an opt-in experiment.

Verified on macOS arm64 with nightly-2026-10-28, GPUI Kit 0.8.1 at
`ec89cfc36404667b7947aeb3d40b1c2859d729dd` and Fast 0.1.12. Fast requires
`taffy = 0.15.0` and `unicode-properties = 0.1.3`; the lock downgrades only
those two existing packages and adds the nine Fast packages. The existing
checksum-verified gpui-pre-web IME patch remains selected for ordinary Wasm.

## Reproduce

Configure the Kit checkout and fonts as described in the Desktop README.

```sh
export PERO_GPUI_KIT_PATH=/absolute/path/to/gpui-kit
npm run dev:native -- --fast
```

The hidden engine suite verifies which backend the executable actually uses:

```sh
node scripts/cargo.mjs +nightly-2026-10-28 build --locked -p pero-ui --features native-fast,native-probe --bin pero-native
node tests/e2e/native-webview.mjs --fast
```

For the original backend, build with `native-probe` and omit `--fast` from the
test command. Both modes copy their executable into a temporary directory.

For visible composition inspection, use an available loopback fixture URL:

```sh
target/debug/pero-native --preview-webview http://127.0.0.1:PORT target/composition-preview.json
```

This diagnostic requires `native-probe`. It opens the actual Workbench without
a Host, credentials or URL-scheme registration, and places a deferred GPUI
button over the native page. Click the visible button by position, then a page
control outside it; close the window to save the receipt. The same command
supports the original backend for comparison. This is not a product overlay.

## Observed

- Fast and ordinary native builds pass the hidden Wry suite: actual page DOM,
  no Host bridge, retained form/document identity, back/forward, inactive and
  covered visibility, and teardown. Fast registers two actual native surfaces;
  the test rejects silent fallback to ordinary child views on macOS/Linux.
- In the visible Fast preview, the GPUI button paints above the page input.
  A coordinate click increments its label from 0 to 1. The adjacent page button
  independently updates the DOM to `Page interaction passed`. On close, its
  receipt records one native surface, one overlay click and complete release.
- In the same visible preview on GPUI Pre, the page covers that GPUI button.
  Clicking the same position leaves the GPUI counter at 0.
- The full native Workbench loads the loopback page, accepts ordinary text and
  page clicks, lays out the Chat dock, changes between light/dark chrome, and
  hides/reveals the retained page at the 1000-pixel narrow-window layout.
- The existing Settings overlay hide/reveal policy is retained. This change
  does not yet leave production pages visible behind every popup or dialog.
- `npm run check`, 22 UI/theme unit tests, and ordinary `pero-ui`/`pero-chat-web`
  Wasm compilation checks pass. Native shipping-feature compilation is
  recorded separately from the probe's visible runtime check.

Engine receipts remain `visual_acceptance: false`; they do not turn manual
observations into automatic visual acceptance. Screenshots are under
`test-results/native-webview-fast/`: `composition-overlay-and-page.png`,
`pre-overlay-obscured.png`, `pre-overlay-click.png`, `light-page.png`,
`split-view.png`, `dark-split-view.png`, `narrow.png`, and `narrow-page.png`.
The full Workbench was launched with a worktree-local data directory.

## Remaining boundaries

Physical Chinese IME composition, page-to-chrome keyboard shortcuts,
clipboard shortcuts and screen-reader traversal are not certified. Background
native automation is insufficient to establish those physical input paths.
Cross-display scaling and partial clipping through a scrolling GPUI ancestor
also remain open. The native composition adapter currently targets macOS and
Linux X11/XWayland; Windows and Linux runtime have not been exercised here.
No provider, installed package, performance, memory or release acceptance is
implied. Keep Fast optional until those boundaries and the production overlay
policy are verified.
