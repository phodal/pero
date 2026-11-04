---
kind: verification_report
date: 2026-11-03
status: desktop_observation_verified
---

# Environments observation UI

Integrated the source bundle based on `399d2c35bc9fb2c3e63f55d193f7c8fd67c05525`
into the working tree starting at `37a66e91` on macOS arm64. Concurrent work
advanced HEAD to `ac13a80d` during verification; Environments changes remain
uncommitted. Existing unrelated changes were retained. Finder `.DS_Store` files were excluded from the bundle before
application; all 18 source payload hashes matched its manifest. No Environments
commit, push, PR, release or signed-package acceptance is claimed.

The optional Environments App uses the existing configured-interpreter probes
and Rust requirement matcher. `/host/environment` carries only a fixed method;
the App origin determines the caller. The manager requires its `environments`
grant, while Paper and Control Lab can inspect their own methods. Inspection
does not prepare software, start scientific execution or change historical results.

## Repository verification

| Check | Result | Scope |
| --- | --- | --- |
| `npm run gen:contracts` and `npm run check` | Passed | Generated Host schema/types, TypeScript, theme, locale and icon checks |
| `npm --prefix apps/environments run check` | Passed | New App and shared SDK typechecking |
| Paper and Control Lab `typecheck` | Passed | Both task entrypoints and shared inspector |
| SDK + Desktop parser Node tests | 17 passed | Observation boundary, filtering, freshness, client failures, deduplication, disposal and transport input |
| `node scripts/cargo.mjs test -p pero-runtime -p pero-contracts` | 89 + 93 passed | Runtime/domain and contracts, including existing binding freshness and Use rules |
| `node scripts/cargo.mjs test -p pero-host` | 43 passed | Host wiring and existing approval/App boundaries |
| `node scripts/cargo.mjs +nightly-2026-10-28 test -p pero-ui --features native native_apps` | 3 passed | Actual Native adapter request/reply wiring, origin, method, body bounds and malformed input |
| `npm run test:apps:contracts` | Passed | Real stdio Host, generated schema, Python environment and builtin lifecycle |
| Builds of Environments, Paper and Control Lab; Host and Desktop | Passed | Development artifacts |
| `tests/e2e/environments.mjs` | 7 groups passed, no page errors | Real Electron, React mount, Host and existing configured Python |
| Existing `tests/e2e/paper-reproduction-component.mjs` | Passed | Synthetic component regression for freeze, approvals gate, cancellation, unknown result, preflight failure and narrow layout; no scientific execution |

Native compilation initially exposed a missing `Sizable` trait import in the
existing workbench error-dismiss change. Only that import was added to unblock
compilation; the existing dismissal behavior and other edits were retained.

## Actual Desktop observations

The Electron suite binds its disposable profile to an already prepared Python
3.12.11 venv. It installs no scientific dependencies and calls no solver/training
entrypoint. Its three actual observations were:

| Method | Software requirements | Missing |
| --- | --- | --- |
| Control / python-control | Matched | None |
| Circuit / ngspice | Blocked | ngspice |
| Paper / PC-Gym | Blocked | torch, gymnasium, stable-baselines3, casadi, do-mpc, jax, equinox, diffrax |

The suite checks initial unobserved state, search/empty recovery, three independent
observations, table/grid navigation, exact requirements and JSON, actual file
export, malformed/caller-injection requests, and cross-App scope refusal.
Disabling Control Lab produces a visible error and removes the previous report;
re-enabling it and Retry returns a fresh observation. It also checks live English/
Chinese and light/dark changes, a pane narrower than 581px with visible software
versions and no horizontal overflow, and the actual Control Lab inspector's scope,
Escape handling and focus return. Paper's actual App-origin route is checked;
its PDF-annotation reproduction entrypoint was covered only by the component
regression, not an end-to-end PDF interaction.

Evidence under ignored `test-results/environments/`:

- `results.json`, `observations.json`, `exported-observation.json`
- `catalog-light.png`, `observation-light.png`, `disabled-error-light.png`
- `software-dark-narrow-zh.png`, `control-inspector.png`

Captured screenshots were visually inspected against `DESIGN-REVIEW.md`.
The reproduction fixture has separate evidence under `test-results/paper-reproduction/`.

Reproduce the Desktop suite after building the three Apps, Host and Desktop:

```sh
PERO_ENVIRONMENTS_TEST_VENV=/absolute/path/to/existing/venv node tests/e2e/environments.mjs
```

## Remaining acceptance

This establishes development Desktop observation/integration evidence (L1) and
actual local software metadata, not scientific execution or acceptance. The
Native adapter was compiled and tested, but a running Native WebView and its file
export were not exercised. Full PDF-to-reproduction-inspector interaction,
signed-package installation, screen-reader testing, managed EnvironmentUse,
independent compute interpreters, remote resources, real solver/training runs
and scientific reproduction remain unverified. Metadata matches do not establish
importability or the identity of libraries loaded by an already-running process.
