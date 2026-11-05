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
