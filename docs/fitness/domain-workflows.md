---
kind: verification_report
date: 2026-11-13
status: cpu_product_path_verified
---

# Virtual Cell domain task package verification

Source: independent checkout `p1-domain-workflows`, branch
`codex/science-p1-domain-workflows`, base
`c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23`. Runtime/UI source commits end at
`cdb1437c5`; verification used those same changes before commit. Platform:
Darwin arm64, Python 3.12.11, Node 26.8.1. The original repository and the other
Science checkouts were not modified. This report records compilation, real CPU
and loopback behavior, browser observations and unverified Desktop scope
separately. The [task record](../exec-plans/2026-11-13-science-domain-workflows.md)
owns scope and consumed boundaries.

## Delivered behavior

The comparison view now connects a versioned method declaration to frozen
inputs/parameters, Host environment inspection/preparation, reusable additive
model state, actual CPU comparisons, immutable predictions/evaluation, an
independent arithmetic check, export and rerun. The sample input is explicitly
synthetic. The additive endpoint computes empirical μ(A)+μ(B)−μ(control) from
training means; it is not a trained biological model and has no weight assets.

The existing App Agent Plugin mounts only `import-inputs` and `comparison-step`,
with 12 calls per mounted connection. Its typed commands call the same owners;
the backend test performs actual CPU work. This does not establish that a real
Agent provider has selected/invoked the skill or that Host approval UI has been
accepted end to end.

## Checks and results

| Check | Observed result |
| --- | --- |
| `PYTHONDONTWRITEBYTECODE=1 python3.12 -m unittest discover -s apps/virtual-cell/test -p 'test_*.py' -v` | 73 tests: 61 passed, 12 optional Norman preparation tests skipped because numpy/scipy are absent |
| `node --test apps/virtual-cell/test/*.test.ts` | 7 passed; retained comparison denominators and existing atlas/reaction/volume behavior |
| `npm run typecheck --prefix apps/virtual-cell` | Passed |
| `npm run typecheck --workspace @pero/app-sdk` | Passed |
| `node --test packages/app-sdk/test/environments.test.mjs packages/app-sdk/test/environments-ui.test.mjs` | 24 passed, including the fifth method choice and existing IME/navigation/recovery behavior |
| `PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit PERO_APP_PYTHON=python3.12 node scripts/cargo.mjs test -p pero-runtime apps::tests -- --nocapture` | 13 passed |
| Same Rust invocation with filter `apps::environment` | 5 passed |
| `node scripts/codegen/contracts.mjs --check` | Passed; TypeSpec is the edited source |
| Targeted Virtual Cell App build | Passed; existing reader bundle was read only from the original checkout using `--reader-dist`, while this checkout built its own changed UI |
| `node apps/virtual-cell/test/task-package-browser.mjs` | Passed: actual browser and real CPU backend with fixture parent SDK context |
| `git diff --check`; changed source file line counts | Passed; every changed code/test file remains below 1000 lines |

Host AppStore tests create a real offline Python 3.12 venv with `--without-pip`,
show that an unprepared declared interpreter blocks startup, prepare using the
existing owner without downloads/install, launch the production Virtual Cell
backend, read authenticated package/model APIs and observe its listener stop on
disable. An isolated Host test process proves the remote model deployment URL
and token reach Virtual Cell only. These are real process/loopback checks, not a
signed product or full Desktop UI acceptance.

Model endpoint tests exercise stopped→starting→ready→in_use→ready and explicit
unload, repeated use, differently bound input refusal, failure/reset, two real
loopback services using the remote contract, and no implicit remote startup.
Disconnect detaches the local connection; the remote service stays ready.

Independent checker tests verify content identities, input/model/prediction
binding, unequal-size batches with an equal-batch estimand, per-condition ΔMSE,
complete attempted/evaluated/failed denominators and summary arithmetic. Resealed
prediction/metric/summary/denominator/provenance tampering fails. Checks remain
bound to their original run and repeated checks do not refer to themselves.
The checker imports no production evaluator/baseline code. Other metrics,
preprocessing, biological validity and scientific acceptance are outside PASS.

## Browser observations

Local evidence directory: `test-results/virtual-cell-task-package/` (ignored;
screenshots and runtime outputs are not committed as binary assets).

The actual built App completed these steps with the synthetic bundle: load CPU
example → inspect the visible package requirements → prepare additive endpoint →
ready → run four-model comparison → independent PASS → rerun with a fresh run ID
and the same immutable output → export → exact offline numerical recompute and
standalone checker PASS → unload. Endpoint use count reached 2. The rerun had no
check until explicitly checked, while the first run retained its own receipt.

Inspected `prepared-light.png`, `completed-light.png`, `checked-light.png` and
`stopped-narrow-dark.png` at 430px. Full task title and endpoint controls remain
readable in the narrow theme and the document has no horizontal overflow. The
result retains all four methods, failed-count columns, original identity,
separate check state and its scientific limitation text. Table metric strings
can wrap at dense widths; no values/denominators are hidden. No page errors were
observed.

`host-inspection-unavailable-fixture.png` shows the shared environment inspector's
explicit 503 failure in this standalone fixture, plus dismissal/focus return.
No green Host metadata was fabricated. The real Host method probe and AppStore
preparation were checked separately in Rust. The navigation target continues to
be the existing Environments App.

## Remaining acceptance scope

- The full `tests/e2e/virtual-cell-comparison.mjs` was attempted; Electron exited 1
  before its surface loaded. This checkout lacks its full Desktop/Host/Wasm
  build. Failure details remain in
  `test-results/virtual-cell-comparison/failure.json`. Full Electron, Native and
  signed-package acceptance are unverified.
- No public Norman source matrix or researcher-reviewed preparation was present
  in the available local data. No large dataset/model was downloaded. Historical
  reference reports were not presented as new scientific runs. The 12 optional
  preparation tests did not run.
- No LCMS2Yield weights, GPU, external model account, cluster or paid resource
  were used. Remote wiring is verified over loopback only; a live deployment
  must separately provision the exact input and ready model.
- The result retains existing App-local artifact/input/output references.
  Automatic shared Task/Run dispatch, Project catalog registration for Virtual
  Cell and managed EnvironmentUse admission remain with their existing owners
  and separate work. No alternate provenance database was created.
- A transient Rust archive ENOSPC error recovered without deleting other
  checkouts or shared caches; the final targeted Rust commands passed.
