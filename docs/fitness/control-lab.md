---
kind: verification_report
---

# Control Lab verification

Implementation and independent review passed the local gates below. No full Desktop, real-provider or
release-package acceptance is claimed. The implementation branch starts from
`bbf0e88f9df6ff891882d30473e1980f179827c7` (PR #62 merge).

## Local evidence (2026-10-30)

- Frontend strict TypeScript, five presentation tests, App write-schema validation and App bundle passed.
- The complete strict Python suite passed **21 tests, zero skips** on the locked
  environment: Python 3.12.14, control 0.10.2, NumPy 2.2.6, SciPy 1.15.3,
  Matplotlib 3.10.3 and actual ngspice 46. It includes P/PI analytic goldens,
  RC cross-engine checks, Sallen–Key AC/phase/transient oracles, child-process
  cancellation, authenticated transport, bounded proposals and saved evidence.
- Local ngspice was compiled into an isolated temporary prefix from the official
  `ngspice-46.tar.gz` source. SHA-256:
  `a0d1699af1940b06649276dcd6ff5a566c8c0cad01b2f7b5e99dedbb4d64c19b`.
  Configure options disabled X and readline; no system binary was installed.
- Real authenticated backend-process smoke passed all four templates: robust
  PID PASS (four final scenarios), P golden expected FAIL, PI golden PASS,
  and active filter PASS (three final scenarios). Wrong-token rejection,
  frozen-budget rejection, cancel, restart, rerun, export and missing-ngspice
  INCONCLUSIVE behavior passed. These are not Desktop screenshots.
- Independent review reproduced and fixed undersampled overshoot false PASS,
  near-resonance mistaken DC-gain false PASS, non-retryable failed attempts and
  stale previous final-batch evidence. Regression checks passed. Reports are
  deterministic across reopen/re-evaluation on saved observations.

## Open gates

- Run actual Desktop interaction, dark/light/narrow screenshots and App Use
  acceptance. The current cloud workspace has no native display; do not
  substitute headless screenshots for a native-window gate.
- Validate the exact published PR commit and its merge with current master.
- Real-provider Agent and signed-product installation remain opt-in separate
  acceptance levels, not implied by solver or ACP-fixture tests.

See [design](../design-docs/control-lab.md) and
[App instructions](../../apps/control-lab/README.md).
