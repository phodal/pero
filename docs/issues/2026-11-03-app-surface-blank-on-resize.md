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
- Render a single-column shell outside hit-preview instead of a hidden Split pane.
- Keep inactive iframes with `visibility` instead of `display:none` so a resize
  flicker does not blank Chromium's compositor.

`node tests/e2e/app-use-bridge.mjs` passed after the shell change. Restart the
Electron Workbench to pick up `build:web` and the rebuilt Paper Agent assets.
