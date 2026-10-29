---
kind: incident
status: resolved
---

# Web GPUI Pinyin leaves leading Latin characters

## What

On 2026-10-29 the user reported that the browser component Demo with macOS
Simplified Chinese Pinyin produces `n你h好s世界` when entering `你好世界`.
The user reports that the native Zed application in `~/test/zed` works.
The deployed Demo's exact build and browser version have not been captured.

## Evidence and likely cause

Pero resolves gpui-kit 0.8.1 and gpui-pre-web 0.3.10. The installed Web
backend's `src/events.rs` is identical to the local Zed checkout's
`crates/gpui_web/src/events.rs` at inspection time. Its keydown handler
dispatches keybindings, then checks composition flags, then inserts a
printable key directly. It does not check `KeyboardEvent.keyCode == 229`.

MDN documents that the keydown opening composition can precede
compositionstart, with isComposing false but keyCode 229:
https://developer.mozilla.org/en-US/docs/Web/API/Element/keydown_event#keydown_events_with_ime

This can explain the leading letters, but remains a source-based diagnosis
until a physical Pinyin event trace confirms it. Native Zed uses a different
backend: `crates/gpui_macos/src/window.rs` sends printable keys to the native
input context first when an IME input source is active. Native success does
not exercise the Web handler, and does not establish a component-layer bug.

## Proposed verification and repair

Capture the first keydown and composition events in the affected Demo.
Handle IME-owned keydowns before GPUI keybinding dispatch and direct text
insertion; preserve browser default handling so composition can start.
Verify Chinese word-by-word and phrase input, selection replacement,
candidate confirmation, cancellation, ordinary English and shortcuts.
Synthetic composition-only tests cannot establish physical macOS acceptance.
The local implementation and automated verification are recorded below;
no upstream issue or pull request has been submitted.

## Upstream comparison

Kit issue https://github.com/longbridge/gpui-kit/issues/3605 concerns native
candidate-window cleanup on focus transfer, especially accessibility AXPress.
Its 0.3.8 native reset candidate is experimental; the maintainer requested
retesting with current Kit. It is not a repair for Web leading characters.
Issue https://github.com/longbridge/gpui-kit/issues/3456 separately concerns
native Command-Return submitting a composition-ending event.

A directly relevant reporter-owned reproduction is available at
https://github.com/tgfjt/gpui-web-ime-repro. It reports native Japanese IME
producing `aあ` in Chrome with the original Web backend, versus `あ` with
the candidate patch. Chinese Pinyin has not been verified by that report.
The patch checks the internal composing flag, event.isComposing, and keyCode
229 before keyboard dispatch in both keydown and keyup, returns without
preventDefault, and removes the old late composition guard. This is a
downstream candidate, not evidence of an accepted upstream fix.

For a native component control, run `cargo run --locked -p
gpui-component-story -- Input` from `/Users/phodal/test/gpui-kit`.
For Pero's native workbench, run `npm run dev:native` from this repository.

## Local implementation and verification (2026-10-29)

`patches/gpui-pre-web-0.3.10-ime.patch` adds one shared IME-key predicate
before keydown and keyup dispatch, and removes the late cancelling guard.
`scripts/lib/gpui-web.mjs` prepares the checksum-pinned registry archive under
`target/patched-dependencies`; the Cargo wrapper resolves this patched Web
backend without modifying the registry cache or either reference checkout.
The other GPUI snapshot versions remain unchanged.

Both workbench and standalone chat Wasm builds passed, followed by the Vite
Web build, `npm run check`, and `npm run test:composer`.
`npm run test:ime` drives the actual compiled backend in hidden Electron:

- First 229 keydown with neither composing flag set does not insert text.
- Consecutive synthetic Pinyin compositions produce `你好世界`.
- Internal-only composition protects Enter, Backspace, Escape and arrows.
- Browser-only isComposing protects a printable key; boundary keyup remains
  uncancelled, as do the composition keydowns.
- Ordinary English, Backspace and Select All/delete still work.
- Chromium CDP composition confirmation and cancellation preserve the text.

An unpatched control build failed the same keyboard regression; restoring the
patch passed. Screenshot inspected: `test-results/ime/pinyin.png`.
The generated backend was also reused without rewriting on a second prepare,
and Cargo metadata resolved successfully with `--locked`.

The user manually retested local Pero with macOS Simplified Chinese Pinyin
on 2026-10-29 and confirmed the fix works. The browser and OS version were
not recorded. This resolves the local leading-character incident; the deployed
upstream Demo was not changed. No deployment or packaged release was made.
