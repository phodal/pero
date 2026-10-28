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
