---
kind: incident
status: resolved
---

# App chat font size reads below the design floor

## What

Floating App chat (Paper and other Apps) showed Chinese chrome, tool rows,
thinking status and composer labels smaller than the surrounding PDF and below
the 12px interface minimum. Users reported the panel as unreadable.

## Why

Two stacked shrinks:

1. `patches/gpui-pre-web-0.3.10-ime.patch` multiplied every non-emoji canvas
   face by `11.32 / 12.04` to optically match Han to SF. The factor applied to
   all canvas text, not only Han fallbacks. At the Root rem of 14px, Kit
   `text_sm` labels (0.875rem = 12.25px) painted around 11.5px.
2. Composer and tool toggle buttons used Kit `Size::Small`, which paints labels
   at `text_sm` rather than the UI body size.

CJK family names and `document.lang` on the canvas remain; only the size factor
is removed. Session title nowrap/ellipsis from the earlier follow-up stays.

## Repair

- Drop the canvas size factor from the IME/CJK patch.
- Float title, coverage hint and thinking status use `TextRole::Body`.
- Chat toolbar buttons use `Size::Large` with the shared control height so
  labels stay at 1rem body size.

## Verification

2026-11-03: patch applies to pristine `gpui-pre-web-0.3.10`; `pero-theme`
native tests pass; `pero-chat-ui` / `pero-ui` native libs and
`npm run build:wasm` complete (new web backend digest). Restart
`npm run dev` to load the rebuilt Wasm. Live Electron screenshot acceptance
of the floating Paper chat was not recaptured in this pass.

Follow-up the same day: tool rows showed wire names like
`mcp__pero-app-use__app__paper-agent__…`, so the useful suffix was clipped.
`display_tool_title` strips the MCP transport prefix to the leaf tool name.
Wire titles are unchanged.

Composer App object chips used `Label · rN · app-id`, which looked like a dead
reference and clicking removed the chip. Labels are now the object name; click
opens/docks the App; × removes; Preview stays for inspection.
