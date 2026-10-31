# App Python preparation verification

2026-10-31, macOS arm64, development worktree based on `91de2e3d`.
The worktree also contains concurrent changes; this record covers dependency
preparation and its Desktop presentation, not the unrelated Control Lab science/UI work.

## Observed acceptance

- L0: Host/runtime tests passed (7 Host, 64 runtime); the App stdio contract test
  passed, including generated progress-event validation, failed enable retaining
  disabled state, metadata-based recovery without network access, environment
  selection, backend auth and retained disable/removal.
- L0: `npm run check`, three Desktop home/settings tests and native compilation
  with `+nightly-2026-10-28` passed. Native GPUI's upstream macOS dependency requires
  nightly; the ordinary stable invocation failed in its `map_or_default` usage.
- L1/L2: `PERO_APP_PREPARATION_NETWORK=1 node tests/e2e/app-preparation.mjs`
  downloaded pinned uv 0.12.20 into a disposable profile, provisioned managed
  CPython 3.12, installed Control Lab's real pinned packages and opened its real
  Python backend in Electron. No model request or engineering experiment ran.
- The same real Desktop flow showed progress/logs, rejected an invalid isolated
  environment, recovered after configuration repair and retry, and reused the
  installed packages without invoking another installation. Browser errors: zero.
- Screenshots were visually inspected for creation, ready, failure, dark mode and
  the minimum Electron window size. Outputs: `test-results/app-preparation/`
  (`installing.png`, `ready.png`, `failed.png`, `control-lab.png`, `dark.png`,
  `narrow.png`, `result.json`). The window's minimum width prevents a 640px viewport;
  this is not evidence for a narrower supported window.

The initial system-Python trial selected 3.14 and failed building SciPy without
OpenBLAS. The verified managed-interpreter path avoids this by using Python 3.12
and requiring binary wheels. Existing explicitly selected environments remain
subject to their own interpreter compatibility and isolation checks.

## Remaining boundaries

The native installation view compiles but has not had the corresponding real-app
visual acceptance in this pass. Windows/Linux, first-use network failure,
shutdown during a download, signed/packaged installation and scientific results
remain unverified. External `ngspice` is not installed by this Python path.

Source SHA-256 for the preparation implementation used by the verified flow:

- `crates/pero-runtime/src/apps/preparation.rs`: `0c7a093876395ac0a2097270cb524f8154d376d49b77937a87f3c8befd5fafbc`
- `crates/pero-host/src/apps.rs`: `6f331a368da0d890a8b0302e262e8ec4aa2b24f09b627ce5dc7a8777990c581d`
- `web/src/app-preparation.ts`: `3cea06b5bc2853cec81a90d5cd9cfae8dec4b59b0a5451fa74ae6ce952cd948c`
