# Control Lab: computational verification

Status: implementation in progress; no acceptance claims yet.

## Outcome

One local App covers two actual engineering workflows: robust controller design
using python-control, and second-order active low-pass filter design using
ngspice. An experiment freezes its model, scenarios, constraints and budget;
candidates produce observations; an independent verifier evaluates the saved
observations. Process success is not an engineering pass.

The user supplied a Python Control App design as a reference, explicitly not as
an unquestionable specification, and requested both engines in this first App.
The implementation reuses the App Host, prepared Python environments, App SDK,
App Use and existing Agent sessions. It does not add another scheduler, Agent
session store, remote compute protocol or connector marketplace.

## Domain boundary

- ExperimentSpec fixes a concrete model, units, numeric scenarios, sampling,
  search ranges, baseline, verification policy and execution budget. Content
  changes produce a new revision rather than mutate an approved experiment.
- Candidate describes a complete controller or component selection.
- Trial binds one candidate to one scenario; an execution attempt preserves
  the actual process outcome, environment, logs and output artifacts.
- Observation binds data to input digests and solver versions. It retains
  actual time/frequency coordinates, units, output traces and diagnostics.
- VerificationReport is computed from saved observations and frozen policy.
  PASS, FAIL and INCONCLUSIVE are distinct; solver failure is an execution
  outcome and never implies that an engineering property has been proved.
- Evidence references bind report values to immutable input/output artifacts.
  An Agent explanation cannot overwrite observations or verification results.

These concepts stay within Control Lab until two working domains establish a
useful extraction boundary. Transport parses external JSON once into typed
values. Domain functions own invariants; the shell owns processes and storage.

## Control workflow

Continuous-time SISO transfer functions with P, PI or filtered PID controllers.
The demonstration plant is 1/(s² + 2s + 1). Scenarios define concrete plant gain
and damping variations, not names that are resolved differently at execution.
Tracking, plant-input disturbance and control effort are separate signals.

The initial mathematical oracle is G=1/(s+1): C=1 yields
0.5(1-exp(-2t)); C=1+1/s yields 1-exp(-t). A verifier using the reference target
must not claim the first response satisfies tracking simply because it settles
quickly around its own final value. Stability checks must retain internal modes
rather than conceal unstable pole/zero cancellations. An observation window
that cannot establish settling or a steady state is inconclusive.

Search is bounded and deterministic/reproducible where possible; numerical
candidate generation does not require an LLM call per trial. A final candidate
is locked before the frozen verification scenarios are evaluated. Exhausting a
budget without a feasible candidate is a valid recorded outcome, not success.

## Circuit workflow

The first active circuit is a constrained Sallen–Key second-order low-pass
filter. The adapter generates a trusted template from bounded component values;
it does not accept arbitrary SPICE control commands or executable netlists.
The first model uses an ideal op-amp and labels that assumption. It does not
establish real-device bandwidth, saturation, noise or manufacturing compliance.

Frequency-domain constraints retain circuit units and meanings. Hz and rad/s
are converted explicitly. An RC analytical fixture can additionally validate
solver and observation plumbing, but does not replace the active-filter scenario.
Each solver is checked against an independent oracle; agreement between two
possibly incorrect implementations alone is not proof.

## Runtime and Agent boundary

The backend is trusted local code, not an arbitrary-code sandbox. Dependencies
must be prepared explicitly. Missing python-control or ngspice is reported as
unavailable; analytical fixtures never silently replace a missing engine.
ngspice runs with an argument vector, a private attempt directory and startup
configuration disabled. Logs, generated netlists and observed solver versions
are evidence. Timeouts/cancellation must terminate owned computation before a
terminal receipt. Restart retains incomplete attempts without replaying them.

App-bound Agent operations expose structured reads and bounded candidate/run
requests through existing Host approval. Frozen policies cannot be rewritten by
an Agent. Final human acceptance is separate from a numerical pass. Fixture ACP
tests do not establish real-provider Agent verification, and shared process
modules are not a security-isolated verifier.

## Verification and scope

Acceptance is incremental: pure contracts and analytical checks; real solver
checks; authenticated API/persistence/cleanup; actual Desktop interactions and
screenshots; opt-in real Agent verification only with an authorized budget.
Each level records its source revision, environment and limitations separately.
UI covers both domains, failure details, complete scenario denominators,
history/rerun/export, narrow widths and light/dark themes.

Not included: arbitrary Python or netlist execution, graphical block editors,
HPC scheduling, real devices/HIL, MIMO/H-infinity or a generic plugin registry.

## Primary references

- [python-control 0.10.2 API](https://python-control.readthedocs.io/en/0.10.2/)
- [python-control dependencies](https://github.com/python-control/python-control/blob/0.10.2/pyproject.toml)
- [ngspice manual](https://ngspice.sourceforge.io/docs/ngspice-manual.pdf)
- [ngspice licensing](https://ngspice.sourceforge.io/devel.html)
- [Local App platform](../adr/0007-local-app-platform.md)
- [App Use](../adr/0014-app-use.md)
