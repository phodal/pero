# Control Lab

A local engineering App with two real computation adapters:

- **python-control**: continuous-time SISO P/PI/filtered-PID tracking,
  plant-input disturbance rejection and control effort.
- **ngspice**: a constrained second-order Sallen–Key active low-pass filter,
  with an explicitly idealized amplifier and frozen component scenarios.

Freeze a specification, run the bounded candidate search, inspect baseline and
candidate traces, lock a candidate, then run the separate final scenarios.
Saved observations are independently re-evaluated against the frozen policy.
Process completion does not mean engineering acceptance. Incomplete evidence is
inconclusive; a failed constraint remains visible rather than being hidden by a
weighted score. Final human acceptance is not automated.

## Prepare the computation environment

Installing or enabling Control Lab selects a CPython 3.12 App Python
environment — the same minor version as the bundled runtime — and installs this
App's locked `requirements.txt` when those packages are not already present.
Opening the App does not reinstall a satisfied environment. A failed install
stays visible; restart Pero to retry it. An older shared environment is left
on disk and is not used for this App.

ngspice is not a Python package. Install it from its official distribution or
an operating-system package manager and make its executable available on the
Host's inherited PATH. The App does not download ngspice.

The availability panel reports the observed engine version or an actionable
unavailable state. The backend does not substitute hand-coded analytic curves
for a missing scientific engine. ngspice uses the CLI, not a shared-library FFI.
The generated netlist is a trusted template; arbitrary Python or netlist code
is not accepted.

## Verification boundaries

P and PI golden fixtures use G(s)=1/(s+1): the respective unit-step responses
are 0.5(1-exp(-2t)) and 1-exp(-t). The P example intentionally fails unit-target
tracking even though it converges quickly around its own final value. An RC
oracle independently checks both adapters' basic transient/frequency plumbing;
it is not a substitute for the active-filter workflow.

Controller and filter metrics have different physical meanings. Saved traces
include coordinate units, input and solver provenance. Frequency coordinates
explicitly distinguish Hz from rad/s. Finite sampled-window criteria do not
prove asymptotic behavior, and idealized filter results do not prove real
op-amp bandwidth, supply-rail, noise or hardware performance.

Search and final verification scenarios are fixed independently. The robust-PID
search set is nominal, gain ±20% and damping ±20%. Final verification repeats
nominal and damping −20% as separate trials; those traces are not the search
chart. python-control stores classical gain and phase margins when the
frequency response supports them. An undefined crossover is inconclusive and
does not replace internal stability. The same local backend can read both
phases, so this is a methodological separation, not a security-isolated or
blind evaluator. App-bound Agent operations reuse Host permissions; there is
no second Agent runtime or paid model call in a numerical trial.

## Development

From the repository root:

- `node scripts/build/apps.mjs --app control-lab` builds the App through the
  existing product build pipeline.
- `npm --prefix apps/control-lab run typecheck` checks the frontend.
- `npm --prefix apps/control-lab run test:ui` tests presentation rules.
- `python -m unittest discover -s apps/control-lab/test -p 'test_*.py' -v`
  runs backend tests in the prepared computation environment.
- `CONTROL_LAB_REQUIRE_SOLVERS=1` makes missing solver dependencies fail the
  real-engine test gate instead of skipping it.
- `npm run test:control-lab` runs actual Desktop acceptance with prepared build,
  Python environment, both solvers and a working display. See its receipt for
  the exact scope and cleanup outcome.

No real LLM acceptance is implied by a scripted ACP fixture. See the
[design](../../docs/design-docs/control-lab.md) and the current
[verification record](../../docs/fitness/control-lab.md) for evidence and limits.
