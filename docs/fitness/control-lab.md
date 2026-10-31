---
kind: verification_report
---

# Control Lab verification

At the time of the 2026-10-30 local checks below, no full Desktop, real-provider or
release-package acceptance was claimed. The implementation branch starts from
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

## Goal binding development evidence (2026-10-31)

- On the working tree, strict Python science tests passed **22 tests with zero
  skips**, using real python-control and ngspice. This is scientific and
  backend evidence, not evidence of a model-run pass.
- App Use and SDK unit tests passed **21 tests**. They cover missing or changed
  references, foreign target IDs, cancellation, failed authentication,
  rejected and queued prompts, replay including truncated history and active
  restoration, generic App UI denial, and Computer Use authorization races.
  A separate loopback test passed through the actual Host `user_message`,
  scripted ACP and Desktop MCP with a simulated App backend; only the
  approved experiment was accepted. It does not open Electron or run a solver.
- Workbench and Product main-process bundles and TypeScript checks passed.
  A native Desktop test for this change has not run locally: the suite
  requires a headed, isolated desktop and the available Mac is the user's
  active desktop. The real-provider gate remains pending until that and the
  independent evidence checks are complete. The previous PR head's green CI
  does not validate this working tree.

## Earlier entry-point baseline (2026-10-30)

Before the Goal binding changes above, the Agent data route was narrowed to
reject experiment creation and changes to frozen criteria, modeling inputs
and candidate budget. Human creation remained on its existing route. At that
point the Host did not bind the experiment to a session, and generic App Use
could operate the human UI. The read-only Skills provided guidance rather than
enforcement. This is historical context, not a description of the current
working tree.

The narrowed Agent route and its negative cases passed the strict
science suite on Darwin 27: 21 tests, zero skips, with Python 3.12.11,
python-control 0.10.2 and ngspice 46. The locked SciPy 1.15.3 macOS 12 ARM
wheel was needed because the macOS 14 wheel failed to load on that host.
The frontend typecheck, six UI/schema tests and read-only Skill catalog tests
also passed. These results do not establish a real-model run.
The headed Desktop → scripted ACP → Host MCP → python-control fixture passed
at commit `2261733691751e0414fbd67cd7877d3360c7a3e3`, before the current Goal
binding, with `realModel: false`. Its persisted report was FAIL, four invalid
proposal or budget requests were rejected, and all owned processes exited
without recovery. This is not evidence that the present Goal binding passed
Desktop acceptance. The earlier local receipt was an ignored `test-results`
artifact and is not present in this checkout.

## Remaining gates

- Run the updated headed Desktop and App Use fixture in an isolated desktop,
  including the new Goal and Agent-route bypass negatives. The current Mac is
  the user's active desktop, so the suite was stopped before opening a window.
- Complete the opt-in real-provider acceptance with one shared attempt ledger,
  real ACP/MCP and Skill evidence, independent re-evaluation of exported
  evidence, and verified process cleanup. A scripted ACP fixture is not a
  real model. The authorized DeepSeek budget is **0 of 6 provider HTTP
  attempts used**, with at most 8192 output tokens per request.
- Validate exact-head CI and, separately, signed-product installation. Solver
  and fixture checks do not establish either acceptance level.

See [design](../design-docs/control-lab.md) and
[App instructions](../../apps/control-lab/README.md).
