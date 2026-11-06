---
kind: verification_report
date: 2026-11-05
status: local_desktop_verified
---

# Local environment creation and preparation

The Environments App now starts with the managed local environment list. A
separate Software checks tab retains the existing fixed-method observation UI.
Create opens a compact form, then preparation details. Installation progress,
retryable errors and expandable logs stay with the selected environment. Bind
requires explicit confirmation of the App restart and interrupted calculations.
This implements local App-wide binding, not the planned attempt-scoped Use or
independent scientific interpreter separation in ADR 0029.

## Evidence

On macOS arm64, `tests/e2e/environment-preparation-host.mjs` created three new
CPython 3.12.11 venvs through the real stdio Host. All three completed installation
and binding: Control, Circuit (Homebrew ngspice 47), and PC-Gym (including actual
Torch, SB3, CasADi and JAX wheels). Each bind restarted the actual Python backend.
Pinned top-level packages were checked for installed versions and importability;
software requirements were re-observed before binding. Transitive wheels are
resolved by uv; this is not a complete artifact lock or from-scratch reproducibility
claim. Scientific computation remains separately authorized by its existing owner.

`tests/e2e/environment-preparation.mjs` used the real Electron App origin, Host
and Python backend to create, install, cancel a binding confirmation, bind,
read the saved runtime setting, and run the pi-golden Control Lab search with
one candidate. The saved result contains actual solver trials. This establishes
binding use for that calculation, not PC-Gym training or paper reproduction.

Screenshots under ignored `test-results/environment-preparation/` were inspected:

1. `catalog-empty.png`, `catalog-light.png`: one primary Create action; managed
   environments and software checks have separate tabs.
2. `create-light.png`: labeled name/method fields, fixed software summary, native
   package installation information only for Circuit.
3. `prepared-light.png`, `confirm-light.png`: dependencies, expandable logs,
   explicit restart consequence, and cancel recovery.
4. `bound-light.png`, `bound-narrow.png`, `catalog-dark-narrow.png`: actual usage,
   narrow layout without horizontal overflow, and propagated dark theme tokens.

The original append-only UI was rejected during review and replaced before
handoff. No nested cards, duplicate open/detail actions, permanent installation
form, or global App-preparation overlay is used for the new flow.

Repository checks: `npm run check`, Environments TypeScript check, 16 SDK tests,
44 Host tests and 106 Runtime tests passed (one existing ignored test). The Rust
suite used `PERO_APP_PYTHON` pointing to an existing CPython 3.12 interpreter;
the machine's default Xcode Python 3.9 cannot import the existing PC-Gym domain.
Native code compiled with its real route adapter; its environment route test passed for both inspection and profile management. The restart-recovery shell test preserved partial logs and made interrupted preparation retryable. Native visual checks were
attempted, but the CUA app resolver did not admit the isolated preview identity;
final redesigned-state visual acceptance is Electron-only. Signed packages,
Windows/Linux installation, independently selected per-attempt compute and
managed EnvironmentUse remain outside this acceptance.

## Reproduce

```sh
PERO_ENVIRONMENT_PREPARATION_REAL=1 node tests/e2e/environment-preparation-host.mjs
PERO_ENVIRONMENT_PREPARATION_REAL=1 node tests/e2e/environment-preparation.mjs
```

These opt-in suites download real packages. Circuit invokes Homebrew. Outputs
and created venvs stay in their isolated temporary profiles for inspection.

## 2026-11-06: creation page Design correction

Source: PR #147 core head `faa1919c` plus the local page changes in this commit.
The migration replaces the page-local heading with LibraryHeader, the outlined
Back control with the shared ghost Button and Shell ArrowLeft, and the two ruled
software lines with a shared blue soft Card containing named software facts.
The App workspace now fills its viewport with `bg`; embedded inspections retain
their existing surfaces. Field, Input, Select, Button and Card own control skins.
No theme token values or sandbox permissions changed. Actual consumers are the
Environments App and its Native shared manager; task inspectors are unaffected.
Name/method input, IME handling, preparation logs, retry and binding confirmation
remain owned by the existing manager/Host.

Real macOS arm64 Electron verification passed with the rebuilt App, Desktop main
and Host; the unchanged GPUI/Web shell assets were reused from the primary
checkout. `environment-preparation.mjs` created and installed a real Python 3.12.16
Control environment, cancelled and accepted binding, read its persisted setting,
and ran the existing pi-golden calculation with actual solver trials. Evidence:
`test-results/environment-preparation/result.json`, `calculation.json`;
isolated data home `/var/folders/wh/2vh0v5g106jbhjxmzgj2zcvc0000gp/T/pero-env-page-drA7XW`.

Inspected `create-light.png`, `create-dark-zh.png` and
`create-dark-narrow-zh.png`: consistent full-height canvas, distinct input and
software surfaces, single primary submit action, legible labels, no narrow-window
horizontal overflow, and visible Select keyboard focus. Live language/theme
switching retains the entered name; ArrowDown opens Select and Escape restores
focus. The suite also checks actual creation response and unchanged preparation,
confirmation, binding and calculation behavior. SDK regression: 23 tests; App
TypeScript and build passed. Native visual acceptance and signed installers have
not been rerun, so this evidence is Electron-only.

The real iframe check found and fixed blocked native form submission; see the
[incident](../issues/2026-11-06-environment-form-submission.md). The older report's
form-submit evidence predates the shared selector/native form migration and does
not establish that broken revision. Creation now validates and dispatches through
explicit pointer/Enter handling without enabling frame navigation.


## 2026-11-06 HTML design integrated into the real App

After the user rejected the first visual revision, a dedicated design sub-agent
produced and inspected a standalone HTML proposal. The production page now uses
a centered content column, directly visible method choices and a blue software
summary beside the main form. At narrow widths, software and App impact precede
the submit region in both DOM and visual order. The catalog retains its real
comparison table with method identity icons and subordinate runtime information.

Migration: `Select` for the three methods becomes shared
`RadioGroup` / `RadioGroupItem variant="card"`; shared `Card`, `Field`, `Input`,
`Button`, `Badge`, `Table` and `LibraryHeader` remain in use. The radio's selection,
hover, focus, disabled states and keyboard behavior belong to the public library,
with a real catalog example. Card exposes a radius composition token for the
joined form/footer. Page styles use generated theme roles; no token output or
icon artwork is edited. Consumers are Environments' shared workspace manager
and its component catalog. Host preparation, polling, status, bind/restart
confirmation, permission revocation and saved state retain their original owners.

Actual macOS Electron acceptance reran `tests/e2e/environment-preparation.mjs`:
creation, real Python wheels, name retained across locale/theme switches, radio
arrow-key selection/focus, narrow summary-before-submit order, cancel/accept
binding, backend restart, persisted binding, and actual Control pi-golden output.
Observed screenshots are in ignored local `test-results/environment-preparation/`:
`create-light.png`, `create-dark-zh.png`, `create-dark-narrow-zh.png`,
`create-dark-narrow-summary-zh.png`, `catalog-light.png`, and the prepared/bound
states. Light/dark show distinct canvas, form, selection and software surfaces;
keyboard focus remains separate from selection. Narrow content scrolls vertically
without horizontal page overflow. These local artifacts are attached to the UI PR.

The initial standalone proposal and its screenshots remain in ignored
`test-results/environment-design/`. They are design evidence, not production
acceptance. Native GPUI, signed packages, screen-reader output and other operating
systems remain unverified for this change.

## 2026-11-06: review against DESIGN and DESIGN-REVIEW

This review supersedes the creation-page visual conclusion above. Merely using
shared controls and theme tokens did not establish the requested design quality.
PR #151 retained a promotional heading, repeated local/method information, and
unnecessary outer form/footer frames. Its page CSS also reached into the radio
card's internal content and marker layout. Its acceptance omitted font-size
changes and the create-refusal recovery path.

Source: `bab57286` (including shared radio correction `f0e55001`), based on
`ebc13c66`, plus the expanded `environment-preparation.mjs` checks in this commit.
Built with `node scripts/build/apps.mjs --app environments --reader-dist
web/dist-reader`. Observed in real macOS arm64 Electron/Chromium with the existing
Desktop/Host binaries and GPUI Wasm shell, 14px and Host-persisted 24px UI size.
Before images are attached to [PR #151](https://github.com/phodal/pero/pull/151);
the new default light/dark captures use the same initial window and Control input.

| Document criterion | Correction and observed evidence |
| --- | --- |
| DESIGN: content, hierarchy and density | A concrete Create environment heading, first-field name focus, compact method choices, one software summary and an unframed footer form one column. Removed repeated local badge, destination block, method fact, generic name help and joined outer frames. `create-light.png` / `create-dark-zh.png` show all primary inputs and the action in the initial wide view. |
| Component boundaries | Radio marker stays in the shared component's flow, reserving space beside content at large fonts. Removed all page overrides of the radio's internal marker/content classes. Installation log now uses public inline Disclosure; existing catalog example consumes the same radio variant. No generated tokens or icons changed. |
| DESIGN: conditions before action | Python/local placement, dependencies and related App remain visible. Shared Control/Circuit binding is stated once. Circuit's Homebrew consequence appears in the software section; `create-circuit-dark-zh.png` retains the actual installation warning. Preparation is explicitly distinct from starting a calculation. |
| DESIGN-REVIEW: color and focus | Default light/dark: neutral canvas and input, blue software identity, apricot Circuit identity, teal selection and primary action. Dark narrow 24px screenshot shows a separate exterior keyboard focus outline, an interior selection border and persistent radio dot. Muted descriptions remain legible on selected and unselected surfaces. No new color roles or contrast-certification claim. |
| DESIGN-REVIEW: input, appearance, narrow window | Real Host rejects a whitespace-only name; `create-refused.png` shows one local error before submit, preserves the input, and offers the original action after correction. Cancel/reopen preserves the draft. Locale/theme/14→24→14px changes preserve name and method; 720×800 window has no horizontal page overflow. `create-large-narrow-focus.png` / `create-large-narrow-footer.png` show wrapped labels, separate indicator space and reachable footer. Scroll checks allow one CSS pixel for fractional device-pixel rounding. |
| DESIGN-REVIEW: keyboard and recovery | Radio arrows select/focus the next method. Installation Disclosure opens/closes with Enter. Cancelling the bind dialog returns focus to Use this environment. IME non-submission and permission/refresh retention pass the focused component tests. |
| DESIGN-REVIEW: actual state transitions | Real create → install wheels → ready → cancel/accept bind → restart → persisted setting → Control pi-golden calculation passed again. Name refusal is from the actual Host validator, not an injected response. Existing domain and execution ownership is unchanged. |

Evidence: ignored `test-results/environment-preparation/` contains the named
screenshots plus `result.json` and actual `calculation.json`. The light, dark,
refused, Circuit notice, narrow focus/footer and bound states were opened for
visual inspection. The existing 11 focused environment/radio test cases and App,
SDK/catalog typechecks plus `npm run check` pass; these are separate from visuals.

Not covered by this correction: Native GPUI/Wry visual acceptance, signed
packages, screen-reader speech, other OS renderers, network-install failure and
cancellation, and a full disabled/pressed/hover visual matrix. Reduced-motion
preference was enabled in the narrow test; this page adds no animation. Shell
window dragging, sidebars, resizing and tab closing were not changed or re-certified.
There is no independent pane split in the new single-column form, so Split's
resizing/persistence contract does not apply. This scoped evidence does not claim
complete DESIGN compliance for every surface or environment backend.
