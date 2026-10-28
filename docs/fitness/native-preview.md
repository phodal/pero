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
