---
kind: verification_report
date: 2026-10-30
---

# Floating App Chat verification

Source: uncommitted working tree based on `1350cf7f`, including unrelated
concurrent workspace changes. This record covers development Electron builds
of [ADR 0021](../adr/0021-floating-app-chat.md); it does not claim a clean
commit, real-provider, signed package or cross-platform acceptance.

## Workbench behavior observed

The existing dock remains the default. In a single-pane App, the user may switch
to a floating Composer or expanded conversation and return to the dock. The
same GPUI ChatPanel and App iframe remain in use. A float masks the covered part
of the iframe; App Use can read the panel but rejects operation and capture
until the float is docked or closed. An explicit user App capture temporarily
removes the mask while taking the capture and then restores it.

- `npm run check` passed before the final copy-only clarification.
- Native Workbench compilation and 29 `pero-ui` / `pero-chat-ui` Rust tests
  passed; both Wasm entries and web assets built.
- `npm run test:product` passed all six product and payload checks.
- `node tests/e2e/app-use-bridge.mjs` passed against cross-origin loopback
  documents: partial overlap denies operation and capture, read remains
  available, removal and `visibility:hidden` restore access, and temporary
  suspension restores the mask afterward.
- `PERO_TEST_HEADED=1 node tests/e2e/workbench-floating.mjs` passed with actual
  Electron on macOS and a scripted ACP Agent. It exercised the App draft,
  floating input, prompt submission and transcript expansion, light/dark and
  narrow viewport, and a native App capture returning its two context references.
  The overlay was restored and no renderer errors were observed. Screenshots
  are local and ignored under `test-results/workspace/floating-*.png`.
- The larger `node tests/e2e/workspace.mjs` run did **not** pass: after a dock
  resize, ArrowLeft left the recorded width at 502 instead of the expected 522.
  An isolated rebuild of `1350cf7f` with the unrelated modifications present
  at the start of this task reproduced the same failure without the floating
  Chat changes. The cause and behavior on a clean HEAD remain unverified.
- Direct `node --test desktop/src/main/app-context.test.ts desktop/src/main/app-use.test.ts`
  passed seven cases and failed three on Node 26.8.1, which cannot strip the
  existing TypeScript parameter property in `app-use-mcp.ts`. Node 24 with
  `--experimental-transform-types` instead failed to resolve that file's
  extensionless `./computer` import. The cross-origin bridge and Electron
  results above are separate from this unit-suite failure.

## Standalone Product behavior observed

`PERO_TEST_HEADED=1 node tests/e2e/product-chat.mjs` passed in macOS Electron
with a scripted ACP Agent. Chat starts collapsed, opens as a compact Composer,
and expands on submission. The test exercised minimizing a running turn and
canceling it after reopening, App scope and draft retention, theme and narrow
layout, and a user-requested capture while the float was open. The captured
fixture image was inspected and showed the full App without the Chat overlay;
the overlay and draft returned afterward. There were no recorded renderer errors.
The fixture does not support image input; the UI reported that limitation and
retained the draft. Evidence is local under `test-results/product-chat/`.

## App-owned conversation slot

The Data Agent enables the SDK slot after a dataset is loaded. On macOS,
`PERO_TEST_HEADED=1 node tests/e2e/data-agent.mjs` exercised the actual SDK,
GPUI input focus and draft, light/dark, narrow layout, hidden and clipped slot
release, return to the App, and closing and reopening the slot. The existing
Python backend and scripted ACP/MCP flow were also exercised. Screenshots are
under `test-results/data-agent/embedded-*.png`.

`node tests/e2e/product-chat.mjs` exercised the separate Product Chat iframe,
App scope switches and restoration, and draft retention. The same test rejects
invalid, undersized and out-of-frame slot rectangles and synthetic messages with
an incorrect source or origin. Its Agent is a fixture. Neither test establishes
real-provider or packaged release acceptance. The SDK checks active slot and
ancestor layout each animation frame so layout-only movement is observed;
the runtime performance cost has not been measured.

Virtual Cell also offers the SDK slot alongside its research views. On macOS,
`node tests/e2e/virtual-cell-embedded-chat.mjs` exercised the real App in
Workbench Electron with a scripted ACP Agent: a frozen Virtual Cell object is
added to the existing draft without sending, the same session and edited reaction
parameters survive closing the slot, and light, dark and narrow layouts work.
Screenshots are under `test-results/virtual-cell-embedded-chat/`. The fixture
does not establish real-model behavior or scientific acceptance.

The `virtual-cell-chat` development Product was also built to an isolated
temporary output and exercised in Electron. After the build, its shell HTML was
rebuilt from current source to include the slot readiness fix. The test covered
input after slot acceptance, context without automatic submission, reopening the
draft, a manually submitted scripted ACP reply, theme and narrow layouts.
Screenshots are under `test-results/virtual-cell-product-chat/`. The ordinary
`virtual-cell` Product has not been changed to enable Chat; this check is not a
signed package or a real-model acceptance.

## Remaining verification

This does not establish real-provider behavior, signed release or Windows/Linux
acceptance. The float's running, permission, cancellation, keyboard navigation,
physical IME and error states need focused end-to-end verification. The
Workbench capture check establishes returned references, not independent
inspection of the image pixels. Multi-pane App layouts keep the existing dock;
the embedded slot supports the current App scope, not arbitrary Session or
Project bindings. Narrow-window capture while using the existing dock is not
covered by this floating capture test.
