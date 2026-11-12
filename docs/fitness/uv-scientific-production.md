# Managed scientific profile integration — 2026-11-11

This extends [locked Control preparation](uv-locked-control.md). The canonical
issue is [#163](../issues/2026-11-11-uv-locked-scientific-profiles.md).
The issue remains open until its remaining platform/acceptance scope is reviewed.

## Requirement and evidence map

| P0/P1 requirement | Implementation and observed evidence |
| --- | --- |
| Trusted uv acquisition | Legacy App preparation and locked computation use official uv 0.12.20 archives and binary SHA-256 checks. macOS arm64/Intel, Linux x86_64/arm64, Windows x86_64/arm64 artifacts are fixed. Additional four platform archives were downloaded, matched against official release digests, and unpacked in memory to verify layout/binary hashes. Execution of those additional platform binaries was not claimed. |
| Requested / resolved / observed identity | Managed CPython 3.12.14 archive/request, uv identity, generated project, complete lock, observed build/platform/executable/distribution contents are separate recorded fields. PC-Gym and Control share the canonical distribution observation source. |
| Immutable lock and publication | Actual macOS PC-Gym cold prepare, same-lock distinct-prefix rebuild, corrupt-lock refusal and interrupted-generation recovery passed. Control cold/rebuild/recovery also passed. Published profile mutation remains refused. |
| Explicit cancel and blockers | Real Electron Prepare→Cancel retained the previous PC-Gym binding and produced `failure.stage=cancelled` with no published profile. The real subprocess cancellation gate waits for a readiness line before cancelling its process group. Stage receipts distinguish bootstrap/resolve/install/observe/cancelled/interrupted, with original diagnostics. These are preparation stages, not a claim that every upstream ABI/network error has a normalized category. |
| Project/GitHub declarations | Actual local Control project and fixed PC-Gym GitHub commit `fbfb36bf84b494cd157cff88292e1fd1b864cee5` produced review proposals through Electron/Host. Hashes identify the four supported declarations; optional/dynamic/build/source ambiguity stays visible. No new profile was created by inspection. Absolute Windows paths take precedence over URL parsing; Windows execution remains unverified. |
| PC-Gym original approval→freeze→Use→attempt | Actual managed PC-Gym smoke passed through the existing private approval and CLI owner. Frozen profile/installation digest, original approval digest and Rust Use receipt were retained. Real numerical evidence passed its independent stdlib checker; a second worker was cancelled and its Use released. Paper verdict remains **INCONCLUSIVE**. Paper selection metadata in this scientific harness is synthetic; it is not original-PDF or scientific acceptance. |
| Control and native solver | Real PI computation had maximum analytic error `1.887379141862766e-15`. Actual managed active-filter ngspice calculation exported a Released Use containing the exact frozen native executable SHA. Independent path-switch test refused a changed ngspice executable, preserved exports and accepted the original again. |
| Process ownership / failure / restart | OS parent and process-group checks gate scientific worker execution. A real SIGKILL of scientific Python left ngspice alive; Rust refused release until the full scientific group stopped. The durable Use ledger's release/restart gate passed for registered and not-yet-started children. No Python `released` assertion substitutes for OS evidence. |
| Existing behavior and minimal UI | Real Electron verified PC-Gym selection, method-specific creation, real preparation cancellation, retained binding, local/GitHub proposal review, light/dark/narrow layout. Prior direct Control gate also covered unchanged backend PID, binding drift, missing dependencies, same-version byte drift, explicit recovery, cancellation and historical export after service restart. |
| Linux gate | Fixed Linux x86_64 uv/Python inputs and the official CPU torch index passed real preparation/rebuild, Control/ngspice and PC-Gym execution/cancellation/Use gates in [run 43018513361](https://github.com/phodal/pero/actions/runs/43018513361). See [downloaded receipt review](uv-linux-ci.md). |

## Commands and retained evidence

Generate shared sources before running standalone Python tests:

```sh
node scripts/build/scientific-runtime.mjs
node scripts/build/source-parsers.mjs
python3 -m unittest discover -s packages/scientific-runtime/test
python3 -m unittest discover -s apps/paper-agent/test -p 'test_pcgym*.py'
PERO_APP_PYTHON=/absolute/python3.12-or-newer node scripts/cargo.mjs test -p pero-runtime --lib
node --test packages/app-sdk/test/environments-ui.test.mjs packages/app-sdk/test/environments.test.mjs
```

The final macOS runtime suite passed 165 tests with 7 explicit opt-in gates ignored;
Control passed 56 tests using actual control/ngspice; PC-Gym passed 52 tests,
including default macOS temporary-path aliases after canonicalizing the ResearchStore
entry point. Declaration tests passed 3; UI/contract tests passed 24. SDK/App types,
contract generation check and Host compile passed.

A broad Paper suite was also attempted with the unprepared system Python: 372
tests ended with 19 failures, 51 errors and 17 skips, including missing `pypdfium2`
and `PIL`. That run is not a passing integration claim. The parent coordinator's
merged-source rerun in its prepared App environment completed 383 tests with
366 passing and 17 explicit skips. No unrelated dependency repair was added.

Scientific live gates use explicitly prepared inputs and do not download software:

```sh
PERO_SCIENTIFIC_LIVE_HOME=/absolute/fresh-evidence \
PERO_SCIENTIFIC_LIVE_PROFILE=/absolute/profile.json \
PERO_SCIENTIFIC_LIVE_CHECKOUT=/absolute/pinned-pc-gym \
PERO_SCIENTIFIC_APP_PYTHON=/absolute/app-python \
node scripts/cargo.mjs test -p pero-runtime --lib managed_pcgym_attempt_and_cancel -- --ignored --nocapture

PERO_UV_LIVE_HOME=/absolute/prepared-control-home \
PERO_SCIENTIFIC_APP_PYTHON=/absolute/app-python \
node scripts/cargo.mjs test -p pero-runtime --lib managed_control_attempt_and_cancel -- --ignored --nocapture
```

The final scientific verifier was copied before execution and hashed:
`211b21343ababf5d660c347778f2c566ff019d54acc431dcacbe25fe93f2b507`.
PC-Gym took 84.08 seconds; the extended Control/native gate took 24.71 seconds.
The Electron Host copy hash was
`1615d0a957800244ea7742313c328d1696ceaf8b036782b3ad2220488649cbad`.
The later Windows-archive table and path-parser fixes were source/test verified,
not attributed to this earlier macOS UI binary.

Local evidence under `test-results/issue-163-production/` includes PC-Gym
results, Control result, native group-stop receipt, uv artifact checks and local/GitHub
proposals. `test-results/issue-163-production-ui/` holds five inspected Electron
screenshots and its JSON receipt. Artifacts are local, ignored verification output;
no binaries/screenshots were committed.

## Remaining scope

No Native GPUI, signed distribution, Windows execution or full Linux production
acceptance is established here. Arbitrary project build execution, GPU/HPC and
general environment repair remain outside this fixed-recipe integration. A network
failure fault-injection gate was not separately run; observed failure evidence
covers lock refusal, import/content drift, interruption and cancellation.

The #59 Linux ARM PyBaMM source/ABI conflict is a concrete possible Pixi follow-up,
recorded separately in `scripts/science/pybamm-sweep/linux-arm64.md` by that task.
It does not establish that Pixi resolves the exact conflict. No unused provider
interface or speculative Pixi installation was introduced in this pass.

The later [2026-11-12 Pixi fit experiment](pixi-pybamm-fit.md) tested that exact
candidate. Its frozen Linux ARM64 gap remains unresolved by Pixi; macOS same-lock
installation/rebuild and 12 numerical comparisons passed as positive controls.
The candidate-specific no-go introduces no new provider. The user approved
finishing #163 with that decision; future Pixi adoption needs a separate task.
