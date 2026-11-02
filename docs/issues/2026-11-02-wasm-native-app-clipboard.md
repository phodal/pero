---
kind: incident
status: open
---

# Native App paste breaks the Wasm workbench build

## What

Pages run `41366917972` failed building `pero-ui` for `wasm32-unknown-unknown`
at master `6f5f7e38`: the shared Paste handler called `paste_app_text`, which
does not exist on the Wasm `Workbench` (`E0599`). The ordinary CI run passed;
its core Rust check does not compile the GPUI Wasm view.

## Why

`native_app_surface` is compiled only for native builds. A Wasm fallback
inside that module's `paste_app_text` cannot make the method available when
the entire module is excluded. The shared action handler must respect that
platform boundary.

Guard the native App paste call at its call site. Native clipboard insertion,
WebView editing fallback and Copy remain unchanged. Wasm retains its existing
`forward_web_editing` / action propagation path; this does not add browser
clipboard access or a new clipboard implementation.

## Verification

The regression gate is the existing real `pero-ui` Wasm compilation used by
Pages (`scripts/build/wasm.mjs`), not a source-text assertion or a native-only
unit test. On Linux, with nightly `2026-10-28`, the Wasm target and the CI-pinned
gpui-kit `ec89cfc36404667b7947aeb3d40b1c2859d729dd`:

- Removing the guard reproduces `E0599` at `view.rs:470` (Cargo exit 101).
- With the guard, `cargo build --locked -p pero-ui --target wasm32-unknown-unknown`
  passes through the repository's `cargoArgs` path patches and emits
  `pero_ui.wasm` (development profile).
- Existing Wasm build-tool tests pass (5 cases); existing Desktop frame-editing
  shortcut test passes (1 case).
- `git diff --check` passes. No dependency lock, CI workflow or clipboard
  implementation changed.

This is an L0 compile fix, not a new browser/desktop clipboard acceptance
claim. Release optimization, wasm-bindgen packaging, Pages deployment and
native desktop interaction have not been rerun locally. Keep this incident
open until the published revision passes the Pages build.
