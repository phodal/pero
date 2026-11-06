---
kind: issue
status: resolved
date: 2026-11-03
---

# App content blanks when the Workbench is resized

## What

With Paper Agent open and Chat docked, resizing the Electron Workbench window
leaves the App content slot white. Host chrome still shows the tab and
“截图到对话”; only the iframe document looks empty.

## Why

GPUI republishes App surface bounds on every prepaint. The shell treated each
geometry update like a Host context change and posted `pero:app:context` into
the iframe. AppProvider then reapplied theme/appearance every frame, which
thrashes EmbedPDF and the reading shell until the frame paints blank.

Secondary contributors: `100dvh` inside the Host iframe does not always follow
parent CSS resizes, and a non-preview two-pane Split could leave a blank flex
column after layout churn.

## Fix

- Deduplicate Host context posts when only geometry changed.
- Skip AppProvider state updates when locale/dark/active/appearance are equal.
- Prefer `height: 100%` for the Paper Agent shell inside the iframe.
- Target `#app` (the real mount), not `#root`, so short library/find screens fill
  the iframe instead of leaving a white Host slab under the content.
- Host App panel background uses `--pero-material-chrome`, not `--pero-surface`.
- Render a single-column shell outside hit-preview instead of a hidden Split pane.
- Keep inactive iframes with `visibility` instead of `display:none` so a resize
  flicker does not blank Chromium's compositor.

`node tests/e2e/app-use-bridge.mjs` passed after the shell change. Restart the
Electron Workbench to pick up `build:web` and the rebuilt Paper Agent assets.

## Native sidebar and Chat resize follow-up, 2026-11-06

The actual macOS preview also blanks its App while dragging the sidebar or Chat
splitter. This is a separate cause in the same resize incident: `view.rs` treats
an active layout drag as a full window overlay, so the retained App/Web view is
hidden for the entire gesture. Content remains loaded but is not painted.

Composited Native surfaces now keep the same document visible while geometry
changes. Uncomposited surfaces retain their coverage policy. Active layout drags
handle move/release through the window capture phase, so crossing the retained
WebView does not leave a resize stuck or send its release into App controls.
A transparent deferred input layer retains longer drags above the WebView.
Release also applies its final pointer position before saving: a quick gesture
can finish before the input layer's first frame is painted. The existing
preference/checkpoint owners still save the final sizes. Splitter feedback is a
1px line inside the existing 4px mouse target.

The layout policy tests include composited and uncomposited resize coverage as
well as an actual overlay during a drag. Native visible-window verification is
recorded in `packages/pero-design/VERIFICATION.md` after the rebuilt preview run.
