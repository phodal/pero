---
kind: verification_report
date: 2026-10-28
---

# Native GPUI development preview

The optional `pero-ui/native` feature builds `pero-native`. It reuses the shared
workbench, conversation rendering, model selector, tool views and Rust stdio Host.
Browser bindings remain compiled only for Wasm. The native imperative shell owns
the child process, command pipe, typed Host event channel and native file picker.
No new Agent loop or task state machine was introduced.

Observed on macOS arm64:

- Native release build and Wasm compatibility check passed.
- UI tests with native feature: ten concept tests passed.
- The actual App was opened and inspected through computer use. Native window,
  fonts, menus, layout, local Host readiness and editable composer rendered.
- Clicking New session and Connect initialized real Codex ACP and advertised
  model `6.1 Sol`.
- A single real prompt requested exactly `PERO_NATIVE_OK` with no tool use or file
  modification. That exact assistant reply was visible in the native window.
  The Host journal independently contained the exact combined assistant chunks
  and a subsequent `turn_finished` receipt.
- `npm run check` passed with the current shared locale catalogs.

The native executable is approximately 27 MiB. This is not a whole-installation
size: the developer bundle references the checkout's Rust Host and installed ACP
adapters/model runtimes. It does not bundle Codex or Claude runtimes.

Preview state is isolated in `~/.pero/native-preview`. Cloud requests return an
explicit unavailable state; no cloud credentials are loaded or stored. Cloud
dispatch, GitHub OAuth/deep links, encrypted credentials, embedded App panels,
signed portable distribution and other operating systems are not accepted here.
Real Claude, Grok, physical IME and native permission/tool execution also remain
unverified. A successful Codex text reply does not establish those capabilities.

## Fresh build, 2026-10-29

Rebuilt from `2571af3692d830d39dd9dab9bbf383785062519a` with the pinned GPUI
snapshot `ec89cfc36404667b7947aeb3d40b1c2859d729dd`. Native release compilation,
arm64 inspection and deep strict ad-hoc signature verification passed.

The executable is 27,983,520 bytes. Its dynamic dependencies include AppKit,
CoreText and Metal; the window uses the native GPUI path. This measurement
excludes the checkout-owned Host, ACP adapters and model CLI dependencies.

Computer-use verification opened the actual `Pero Native.app`, inspected the
rendered window and editable composer, created a local session and connected
Codex ACP. The UI showed Host ready and advertised `6.1 Sol`. The test session
was ended without sending a model prompt. The real reply reported above belongs
to the earlier 2026-10-28 trial, not this fresh connection check.

Local evidence is `test-results/native-preview/result.json` and `connected.png`.
The development bundle is `target/native/Pero Native.app` in the release
worktree. It still references that checkout and its adapters, so the worktree
must remain available. It is not added to the portable Electron/Virtual Cell
release assets, and the cloud/Web App limits above still apply.

## Native App extension, 2026-10-31

The earlier embedded-App exclusion is superseded by [Native Apps](native-apps.md).
It records actual WebKit/Host/Python acceptance and the remaining native App limits.
