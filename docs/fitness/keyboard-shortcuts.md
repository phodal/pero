# Keyboard shortcut verification

Date: 2026-11-07. macOS arm64 development builds, L0/L1. Source baseline
`5085287b` plus this shortcut implementation; remote environment changes are
integrated before delivery. Design: [ADR 0031](../adr/0031-keyboard-shortcut-contract.md).

## Implemented behavior

41 commands share defaults, labels, conflict rules and effective bindings.
Settings supports name/key search, modified-only filtering, multiple bindings,
disable, reset, recording, explicit conflict reassignment and Host persistence.
Cmd+/ opens shortcut settings; Cmd+Shift+P opens the existing Spotlight in command
mode. Existing Actions retain ownership of navigation, tabs, chat and terminal.

## Automated checks

- Contracts/runtime/Host/UI Rust suites: 299 passed, 5 ignored. These default UI
  tests do not substitute for Native rendering; Native feature build passed.
- Keymap concept tests cover canonical modifiers, reserved editing keys including
  chord prefixes, defaults for both platforms, disable/reset, same-scope and
  prefix conflicts, explicit reassignment and serialized round trips.
- Host protocol conformance passed (40 of 100 event kinds exercised): older
  preferences acquire empty overrides, overrides survive restart, conflicts fail.
- TypeScript, locales (1039 messages), contract generators and shared icons pass
  `npm run check`; Native, Wasm, Web and Electron builds pass.
- `desktop/src/main/shortcuts.test.ts`: App-frame policy, extra modifiers, DOM
  arrow-key names, key-up, repeat, composition and top-frame exclusion pass.
- `npm run test:shortcuts`: real isolated Electron and Host verify Cmd+/,
  remapping the sidebar command, removal of its previous binding, persisted
  disabled chat-panel binding, restart, menu click and the shortcut from a
  focused Insights App frame using Electron native input events. No model call.
- Existing Composer and browser IME suites pass: composition commit/cancel,
  boundary keys, successive Pinyin events, editing and shortcuts.

The existing `workspace.mjs` suite fails before its tab shortcut cases: its first
fixed-coordinate click does not select Sessions. A diagnostic trial using the
shared new-chat button reached another stale fixed-coordinate Composer input;
that trial was reverted. This suite is not counted as passed. Its broader App
and tab acceptance is not established by this work.

## Observed interfaces

Actual Native GPUI utility window: first-open Cmd+/ selects Keyboard shortcuts;
editing Cmd+N to Cmd+P displays an inline conflict and an explicit Reassign
button; cancellation preserves the saved mapping. Recording Cmd+Shift+N saves
through Host, updates the binding row and single-item Reset restores Cmd+N.
Clicking inside Scientific Viewer then Cmd+/ opens the shortcut page. The initial
navigation defect and save-focus correction are documented in the
[incident record](../issues/2026-11-07-shortcut-settings-focus.md).

Electron light/dark screenshots were inspected. Selected navigation, input
borders, action labels, modified/unassigned values and reset controls are legible.
An initial top-of-page clipping problem was fixed by resetting the exclusive
page scroll offset; final snapshot reports offsetY=0. Missing Wasm Shift/Alt
symbols were replaced with textual modifier labels rather than adding a font.
Evidence: `test-results/shortcuts/01-light.png`, `02-dark.png`, `03-app-entry.png`
and corresponding JSON snapshots. Screenshots are local test output, not source.

Native validation used isolated `/tmp/pero-shortcuts-native`. Final Native build
passed after the focus-return and label refinements. The Mac subsequently locked,
so the final rebuilt Native window could not be reopened; earlier observed
record/save/reset and App-entry behavior must not be presented as a fresh visual
check of those final refinements.

## Remaining acceptance

Windows/Linux runtime, non-US layouts, physical macOS IME, narrow-window and
large-font settings review, nested Native App frames, standalone chat-only
products, external web documents and signed packages remain unverified or outside
this implementation. App entry commands deliberately reject chords; GPUI-local
commands support them. Terminal-specific key interception was not separately
exercised. Browser composition events are not a physical IME certification.
