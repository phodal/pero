# GPUI Kit 0.9.0 upgrade

Source: Pero `62d004809af24983a6203a713df93a05703efc24` plus the upgrade
working-tree changes, 2026-11-06, macOS arm64. Existing unrelated UI edits
were present during verification. Upstream release:
https://github.com/longbridge/gpui-kit/releases/tag/v0.9.0

## Dependency and consumer migration

- Kit, Base, Component, macros, assets and WebView: 0.8.1 → 0.9.0,
  pinned checkout `7591a35eced761e3613c01e71ff04c10129dae1a`.
- Default/Web GPUI family: 0.3.10 → 0.3.11. Native Fast: 0.1.12 → 0.1.13.
- Shared consumers: `pero-theme`, `pero-chat-ui`, workbench `pero-ui`,
  standalone `pero-chat-web` and `pero-reader-web`.
- CI and release packaging use the same release commit. Font URLs remain at
  their existing checksum-pinned asset revision; this upgrade does not change fonts.
- The clean maintainer reference checkout `/Users/phodal/test/gpui-kit` was
  switched from `ec89cfc3` to the release tag. Local patches still apply only
  to generated copies under `target/patched-dependencies`.

## Old problem comparison

| Concern | 0.9.0 evidence and decision |
| --- | --- |
| Web Pinyin leading Latin characters | Stock `gpui-pre-web 0.3.11` still handles keybindings before its late composition guard and lacks the early keyCode 229 guard. Retain the Web IME patch. This is not an upstream resolution of the local Pinyin incident. |
| Native IME candidates / Command-Return | GitHub issues [#3605](https://github.com/longbridge/gpui-kit/issues/3605) and [#3456](https://github.com/longbridge/gpui-kit/issues/3456) both remain OPEN on 2026-11-06. Physical native IME acceptance was not performed. |
| Large-source selection stalls | Stock Web backend still uses a hidden textarea. Retain Pero's EditContext conduit and no-wrap fallback; no claim that the upstream release resolves the large-file incident. |
| Shared editor edits and Undo | New upstream `InputEditsEvent` provides immutable batches, but explicitly does not emit for marked preedit text and has no external document transaction/history API. Retain Pero's existing edit/transaction patch, rebased around `ime_original_text`; preserve live split-view edits, preedit and canonical Undo. |
| Source search/folding/reveal | Upstream still lacks Pero's external search-match, fold restoration and reveal cancellation methods; its Wasm folding guard also remains. Retain source-search patch. |
| Menu rows at larger UI fonts | Upstream still sets a fixed item height. Retain the font-aware minimum-height patch. Submenu activation and placement fixes are separate upstream changes. |
| Wasm nightly requirement | `wasm_thread 0.3.3` still enables `stdarch_wasm_atomic_wait`; retain nightly-2026-10-28. |
| Wasm native-App clipboard compile failure | Pero's existing platform guard remains necessary; this is an application boundary fix, not a Kit release fix. Rebuild the actual Wasm workbench as its regression gate. |
| Patch-cache workspace inheritance | Keep the existing workspace exclusion; the current cache regression test passes. |

Upstream additionally reports fixes for layout-cleanup shutdown deadlocks,
reference-style Markdown images, highlighted-text contrast, padded message
scrollbars, filtered Combobox confirmation, table resizing and accessibility.
These release claims are not individual Pero acceptance results.

## Verification

- All four Wasm outputs built and wasm-bindgen packaging completed: workbench,
  standalone Chat, standalone Reader and content worker. Vite and Desktop builds passed.
- Native `pero-ui --features native-probe --bin pero-native` built with the pinned
  nightly. Existing unused-code warnings remain; no theme-struct migration was
  needed because Pero already configures theme values through existing instances.
- Focused Rust tests passed: 47 tests across `pero-theme`, `pero-chat-ui` and
  `pero-ui`; standalone Web crates have zero host-side tests and are covered by
  their actual Wasm builds instead.
- Build/cache/Windows patch-checkout/CI contract tests: 11 passed, 1 existing
  opt-in runtime archive case skipped.
- `npm run check`: TypeScript, theme/design/contracts, 984 bilingual messages,
  and 85 shared icons passed. The terminal needs Homebrew's Rust shims on PATH
  (`/opt/homebrew/opt/rustup/bin`) for Cargo and rustfmt.
- Actual hidden Electron: `test:ime` and `test:composer` passed. The latter
  includes menus, references, undo, permissions, light/dark and narrow layouts.
- Actual Native Wry probe passed page DOM, authority, retained state, history
  and teardown in a hidden GPUI window.
- Actual visible Native 0.9.0 workbench was inspected in an isolated profile:
  light-theme session navigation, Composer and the Agent dropdown displayed
  readable text without clipped menu rows; Escape dismissed the menu.
  This inspection does not cover native dark theme, physical IME or all Apps.
- Inspected Electron screenshots: `test-results/ime/pinyin.png`,
  `test-results/composer/permission-narrow-dark.png`, and the reader source/table
  captures. Chinese input contains no leading Latin characters; dark permission
  text wraps inside its card. The source reader retains syntax and a fold control.

The old `zed-content-parity.mjs` suite stopped at its first Cmd+O step. The
current workbench (including the pre-upgrade HEAD) has no Cmd+O file-open binding;
its file-edit/split-view Undo lane is not accepted by this run. No editor entry
point was added as part of this dependency upgrade.

The development-build reader suite passed all functional assertions: missing
result/retry, 8,000-row preview/source, folding, exact partial/full clipboard copy,
read-only input, search, table filter/sort/resize, nested navigation, light/dark,
narrow layouts and conversation switching. The fixture now uses the existing
painted New Chat bounds and the observed fold-gutter location. Its partial-copy
assertion compares exact selected UTF-8 bytes, allowing Home/End to select a
wrapped visual line rather than assuming the complete logical source line fits.

Its development-build first Source sample was 48,233.4 ms with a 48,199 ms long
task; preview was 23.4 ms and the retained source/preview switch was 38.4 ms.
This does not resolve the [large-source incident](../issues/2026-10-29-content-reader-main-thread.md).
The receipt is `target/gpui-upgrade-review/reader-debug-performance.json`.
The optimized Cargo release workbench also built and passed the complete reader
suite (without an additional Binaryen pass). Its first Source sample was
2,930.5 ms with a 2,919 ms long task; preview was 15.3 ms and retained switching
18.5 ms. Receipt: `test-results/content-reader/performance.json` (build `release`);
archived alongside the debug result at
`target/gpui-upgrade-review/reader-release-performance.json`.
These are single samples, not a controlled before/after version benchmark or a
latency distribution. No upstream performance-resolution claim is justified.

This is local L0/L1 evidence. Signed packages, production Pages, Windows/Linux,
physical Pinyin and exhaustive upstream-fix scenarios have not been verified.
