---
kind: verification_report
date: 2026-10-28
status: verified_local
---

# Local App platform verification

Implementation: [ADR 0007](../adr/0007-local-app-platform.md).
These checks ran against the uncommitted working tree on 2026-10-28. They cover
the Rust Host/App runtime, its stdio contract, and the actual Electron Desktop
with the real Virtual Cell Python backend. Sources include concurrent unrelated
worktree changes; this is development-build acceptance, not a packaged release.

## Completed runtime checks

| Command | Observed result |
| --- | --- |
| `cargo test -p pero-runtime apps --lib` | Five App tests passed |
| `cargo test -p pero-host -p pero-runtime --offline` | All 18 runtime tests passed; Host had no unit tests |
| `node scripts/cargo.mjs check -p pero-host --offline` | Host and runtime compiled with the repository's GPUI patch configuration |
| `node tests/contracts/apps.mjs` | Real Host stdio App install, enable, restart recovery, private resolve and uninstall passed; generated App request/result schemas matched |
| `node tests/contracts/host.mjs` | Existing Host protocol conformance passed; 24 of 35 declared event kinds observed in that suite |
| `node scripts/codegen/contracts.mjs --check` | Generated Host and remote contracts were current |

The App tests exercise manifest refusal, transactional installation cleanup,
durable enable state, retained user data and one-time builtin seeding. A real
stdlib Python HTTP backend binds a dynamically allocated loopback port, refuses
an incorrect token, handles an authorized request and stops on disable. A new
backend start receives a new token. The stdio test separately proves the actual
Host adapter and generated wire contract are connected.

The Rust package tests were initially run with direct Cargo. Subsequent checks
used `scripts/cargo.mjs` to retain the repository's local GPUI patch configuration;
the shared lockfile was resolved using that helper before Desktop integration.

## Desktop integration

`npm run build`, `npm run check`, `npm test`, `npm run test:apps:contracts`
and `npm run test:apps` passed. The full Rust suite passed 42 tests across
contracts, runtime, UI, Worker and Worker integration. App typecheck passed;
the port's 33 Python tests and three scientific frontend tests passed separately.

The Electron test used an isolated temporary profile, a real Rust Host, installed
assets and the actual authenticated Python backend. It proved:

- Builtin installation, App catalog navigation and opening the Web panel.
- The observed 660-cell atlas, real WebGL volume canvas, editable reaction
  parameters, recomputation, and native JSON download containing the edited value.
- Import of the explicitly synthetic perturbation fixture, actual Python
  evaluation and three rendered model results: control, train_mean and additive.
- Live English/Chinese switching, light/dark styling, and 1000px window layout
  without horizontal page overflow. Navigation retains the frame and parameters.
- No Electron bridge inside the App frame. Disable disposes the frame and refuses
  opening with a recovery message. Disabled state survives Desktop restart;
  re-enable and reopen retain the imported immutable inputs.

No page exceptions were recorded. Screenshots are in `test-results/apps/`:
`catalog.png`, `atlas.png`, `reaction.png`, `volume.png`, `perturbation.png`,
`dark-zh.png`, `narrow.png`, and `disabled-error.png`. The machine-readable checks
are in `result.json`; `simulation.json` is the exported edited reaction model.
The images were visually inspected for content, clipping, controls and theme.

`npm run dev:apps` builds and opens an interactive preview with a separate durable
profile at `target/apps-preview`. It requires local Python 3. Frontend dependencies
are pinned in the App's lockfile and installed on first build if missing.

The existing generated Wasm glue emits a Vite direct-eval warning; the build
completes. Packaging includes the App payload, but no packaged build was tested
for this change.

## Acceptance limits

The first slice accepts trusted local App packages with one HTML panel and an
optional Python backend. There is no App process sandbox, Task/Run or Agent tool
integration, remote App provisioning, marketplace/update service or packaged
release acceptance. Virtual Cell's numerical results and source attribution
require their own domain checks; UI and transport success are separate evidence.

## Shared Python environment and App overrides — 2026-10-29

Verified locally on macOS arm64, Python 3.14.7 and Node 26.8.1. Implementation
source: `af94bcc` (`feat(apps): support shared Python environment with app overrides`).
The tested development `target/debug/pero-host` SHA-256 is
`b74b7da4315d103bc1066e41c44ab8ef99eea18cf326b29bb6b6e0da6be5f120`.

- `node scripts/cargo.mjs test --offline -p pero-runtime -p pero-host`: 39 runtime
  tests and one Host test passed, including the environment policy table and
  existing Python/Node backend lifecycle checks.
- `node scripts/cargo.mjs build --offline -p pero-host`: passed.
- `node tests/contracts/apps.mjs`: passed with three Apps, two real temporary
  venvs and the rebuilt Host. Two Apps shared `app_python.default`; the third
  selected an `app_python.apps` override with a different version of the same
  fixture dependency. A child launched as `python` used its parent's venv.
  All backends retained sibling imports, disabled user-site packages, and
  exposed the selected `sys.prefix` and `VIRTUAL_ENV` only to this test fixture.
  Host restart loaded the persisted settings. Deleting the shared environment
  caused explicit resolution errors for its Apps while the overridden App
  still started. Enabling system-site packages in the override caused refusal.
  Temporary Apps, environments and processes were cleaned up.
- `npm run check`: TypeScript, theme, 523 bilingual messages and generated
  contracts passed. The App wire format is unchanged; interpreter paths stay
  in trusted Host configuration.

The runtime and stdio tests need loopback listeners. Their first sandboxed run
was denied by macOS with `Operation not permitted`; the same suites passed with
loopback access outside that sandbox.

Setup is in [App environment configuration](../../apps/README.md#python-environments).
Apps share one default environment, with optional dedicated overrides. Without
explicit environment settings, the existing Host interpreter policy applies.
Environment preparation and dependency installation remain external steps.
This verifies local dependency/process separation; Windows/Linux runtime,
packaged Desktop, filesystem/network sandboxing and scientific acceptance were
not verified by this change.

## Incremental builtin discovery — 2026-10-29

Resolved [new Apps missing from existing profiles](../issues/2026-10-29-builtin-app-discovery.md).
`BuiltinDiscovery` owns the per-identity decision to offer a new trusted App.
The Host scans the configured builtin catalog at startup and on list requests,
which Desktop issues on startup and Apps navigation/refresh. Newly encountered
packages are installed and enabled; existing package files and enable states
are retained. Explicit removals are recorded before removing the installation.
This is discovery, not hot reload or automatic package updating.

Legacy `.builtins-seeded` markers contain no identities. Migration retains all
installed names and the original Virtual Cell identity. A removal of some other
App before per-App receipts existed cannot be recovered from that marker alone.
New discovery/removal decisions persist in `.builtin-discovery.json`.

Validation passed:

- `node scripts/cargo.mjs test --offline -p pero-runtime -p pero-host`: 41 runtime
  tests and one Host test. The discovery table covers new/known/installed/legacy
  identities; the store scenario covers old/new profiles, an added builtin,
  disabled state, retained installed bytes, repeated scans and removal/restart.
- `node scripts/cargo.mjs build --offline -p pero-host`.
- `node tests/contracts/apps.mjs`: actual stdio/schema wiring, additions while
  the Host is running, retained disable/removal, and existing Python environment
  lifecycle checks.
- `node tests/e2e/app-discovery.mjs`: actual Electron catalog with a legacy profile
  containing disabled Virtual Cell. Paper Agent appeared without manual install;
  the old installation record and research-data sentinel were unchanged. Explicit
  removal stayed removed after restarting Desktop. No page exceptions.

Screenshots and result: `test-results/app-discovery/legacy-profile-discovered.png`,
`removal-retained.png`, `result.json`. They were inspected in the running Desktop
flow. These isolated checks did not restart the user's current Desktop or change
its App directories. The rebuilt development Host takes effect on its next start;
packaged-release acceptance is not established by this run.
