---
kind: incident
status: resolved
---

# Electron workbench draws Han with the wrong face

## What

On 2026-10-30 the Electron workbench (Wasm GPUI, title "Pero · 工作台")
showed Chinese chat and chrome in a face that did not match the Latin UI.
Glyphs were present. The mismatch was the font, not missing characters.

## Why

Latin uses the embedded IBM Plex Sans face. That face has no Han, and the
151 KB Workbench subset only covers catalog strings, so chat Chinese is drawn
by the OffscreenCanvas fallback. The canvas font list ended at generic
`sans-serif`, and the canvas does not inherit `document.lang`. Electron then
picked a Latin fallback plus a Han face whose metrics do not match IBM Plex.

Full Noto Sans SC stays out of the package. Those files are about 10 MB each,
and the portable DMG budget already dropped the public font copies in favor of
catalog fonts plus this system fallback.

## Repair

`patches/gpui-pre-web-0.3.10-ime.patch` now names system CJK families before
the generic family for non-emoji runs: PingFang SC, Hiragino Sans GB,
Microsoft YaHei, Noto Sans CJK SC, Noto Sans SC. The same patch copies
`document.documentElement.lang` onto the canvas context. Emoji still uses the
emoji generic family. `npm run build:wasm` and `npm run build:web` completed,
and the rebuilt `pero_ui` Wasm contains those family names.

A window started before that rebuild still has the old canvas list. Restart
`npm run dev` to load the new bundle. Live appearance after that restart was
not recaptured in this record.
