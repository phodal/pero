# 0020: Computer Use input gaps

Status: proposed (design only, no implementation), 2026-10-30.

Builds on [0016: Computer Use v1 contract](0016-computer-use-contract.md).
Independent of 0019 (isolated Linux desktop): everything here applies to the
local backend and to any later backend.

Numbering: 0017 and 0018 are reserved by draft PR #20 (isolated Agent runtime
and Agent Sandbox runtime), hence this ADR is 0020.

## 1. Context

`protocol/computer-use.tsp` v1 has
`ComputerActionKind { click, type_text, press_key, scroll, drag }`, and
`computer_set` (`protocol/computer-runtime.tsp`) only carries `enabled`.
Known gaps:

- No pointer move without a click, so hover menus, tooltips and
  hover-revealed controls are unreachable.
- No long press (press, hold, release) for context menus, press-and-hold
  buttons and touch-style UIs.
- No per-app scope: once enabled, Computer Use may target any window the
  runtime can see.
- No scroll-to-element and no explicit window focus; the model has to loop
  scroll + observe, and foreground delivery relies on implicit focus.

## 2. Decision (draft)

### 2.1 Required

- `move`: new `ComputerActionKind`. Moves the pointer to an element anchor or
  pixel point of the current observation, no button events. Same admission
  and staleness rules as `click`.
- `hover`: `move` plus optional `dwell_ms` (bounded, for example
  `<= 5000`). The receipt records the dwell actually waited. Could be modelled
  as `move` with `dwell_ms`; one kind is preferred if adapters agree.
- `hold_ms` on `click`: optional, bounded (for example `<= 10000`), for long
  press. `0`/absent keeps today's behaviour. Cancelling during the hold must
  release the button; an interrupted hold reports `dispatched`/unknown, never
  retried blindly.
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
- `focus_window`: explicit focus/raise of a target window, only for
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
- Fitness rows in `docs/fitness/computer-use.md` for hover menus, long press
  and allowlist refusal per platform.

## 5. Open questions

- One `hover` kind or `move` + `dwell_ms`?
- New `app_not_allowed` error code or reuse `permission_required`?
- Allowlist identifiers across macOS, Windows and Linux X11.
