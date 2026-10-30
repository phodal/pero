# 0020: Grok-style Computer Use input gaps

This ADR follows the Grok-style cloud isolated desktop plus human handoff pattern; it is a separate track from the Cursor-based documents in #44 and #45.

Status: partially implemented, 2026-10-30. Section 2.1 landed in #48
(`move`, `hover`, `hold`); `focus_window` from 2.3 is in the ADR 0016
contract. The app allowlist (2.2) and `scroll_to` remain proposed.

Builds on [0016: Computer Use v1 contract](0016-computer-use-contract.md).
Independent of 0019 (Grok-style isolated Linux desktop): everything here applies to the
local backend and to any later backend.

Numbering: 0017 (isolated Agent runtime) and 0018 (Agent Sandbox runtime) are
on master and 0019 is the Grok-style isolated desktop, hence this ADR is 0020.

## 1. Context

When this ADR was drafted, `protocol/computer-use.tsp` v1 had
`ComputerActionKind { click, type_text, press_key, scroll, drag }`, and
`computer_set` (`protocol/computer-runtime.tsp`) only carries `enabled`.
Known gaps:

- No pointer move without a click, so hover menus, tooltips and
  hover-revealed controls are unreachable.
- No hold (press, hold, release) for context menus, press-and-hold
  buttons and touch-style UIs.
- No per-app scope: once enabled, Computer Use may target any window the
  runtime can see.
- No scroll-to-element and no explicit window focus; the model has to loop
  scroll + observe, and foreground delivery relies on implicit focus.

## 2. Decision (draft)

### 2.1 Required (implemented in #48)

- `move`: new `ComputerActionKind`. Moves the pointer to an element anchor or
  pixel point of the current observation, no button events. Same admission
  and staleness rules as `click`.
- `hover`: a separate kind, `move` plus `dwell_ms` (`ComputerDwellMs`,
  0 to 5000). Cancellation ends the dwell early.
- `hold`: a separate kind with `hold_ms` (`ComputerHoldMs`, 1 to 10000),
  `click` keeps no duration field.
  Cancellation (Stop closes the runtime's stdin) ends the wait and releases
  the button once; an interrupted hold reports unknown, never retried blindly.
- Shipped support: Linux X11 delivers all three through XTest, macOS through
  its existing mouse events, Windows refuses them explicitly.
- Per-backend support is advertised through `ComputerActionSupport` like
  existing kinds; unsupported pairs fail with `unsupported`.

### 2.2 App allowlist

- `ComputerSetControl` / `SetComputerSettings` gain
  `allowed_apps: string[] | null` (null = current behaviour, any app). Entries
  are platform app identifiers (bundle ID, executable path or desktop file ID,
  per adapter), not window titles.
- Enforcement lives in `use/computer/crates/computer-runtime/src/runtime.rs`: target resolution
  (`remember` / `target`) and `observe` drop or reject windows whose app is
  not allowed, and `act` re-checks the resolved target before executing. A
  refusal returns `permission_required` (or a new `app_not_allowed` code) with
  the app ID, and produces a rejected receipt.
- Desktop and the settings UI (`crates/pero-ui/src/settings_computer.rs`) show and edit the list;
  the Host never trusts an Agent-supplied allowlist.
- Enforcing in the runtime, not only in Desktop, keeps a single admission
  point next to the native target handles.

### 2.3 Optional

- `scroll_to`: scroll until an accessibility element is visible, where the
  platform offers it (AX `AXScrollToVisible`, UIA `ScrollItemPattern`,
  AT-SPI later). Bounded attempts; falls back to `unsupported`.
- `focus_window` (in the 0016 contract): explicit focus/raise of a target window, only for
  `foreground` delivery, so foreground actions do not depend on implicit
  focus. Never available in background delivery.

## 3. Non-goals

- Isolated desktops, VNC and handoff (0019).
- Window management (resize, move, minimize), multi-touch gestures, clipboard.

## 4. Verification

- Contract: tsp + generated schemas + `pero-contracts` round-trip tests for
  new kinds and fields, including bounds rejection.
- Runtime: allowlist unit tests in `use/computer/crates/computer-runtime/src/runtime.rs` (observe filter, act
  re-check, null list keeps behaviour).
- Fitness rows in `docs/fitness/computer-use.md` for hover, hold (done for
  Linux Xvfb/Tk/XTest in #48) and allowlist refusal per platform (pending).

## 5. Open questions

- ~~One `hover` kind or `move` + `dwell_ms`?~~ Resolved in #48: separate
  `move`, `hover` and `hold` kinds.
- New `app_not_allowed` error code or reuse `permission_required`?
- Allowlist identifiers across macOS, Windows and Linux X11.
