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
