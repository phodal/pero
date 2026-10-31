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
  [CI 41151222995](https://github.com/phodal/pero/actions/runs/41151222995)
  passed all 18 jobs for head `2a43437d36329b83fd53c782a857fffe91b5d35f`.
  Its Linux Desktop runs passed the Goal-bound scripted ACP fixture and the
  isolated fake-provider budget-exhaustion fixture; neither is a real model.
  A subsequent native macOS scripted ACP fixture also passed for this head.

## Real-provider development evidence (2026-10-31)

Two synthetic tasks ran through the real macOS Desktop, Host MCP and
`pero-agent-acp` against the configured official DeepSeek endpoint. Each ACP
process reserved at most three HTTP attempts, with `max-tokens=8192` and
`max-retries=0`. The shared ledger reserved **6/6** and the transport audit
recorded **6/6** attempts; no further requests are authorized in this budget.
The audit is written before transport and can conservatively overcount if a
process stops between recording and sending. Both runs exhausted their
three-attempt allocation; neither completed the Agent workflow.

- **P golden:** the Agent listed Skills, read the pinned `control-design`
  digest, attempted generic App Use, received `APP_GOAL_DENIED`, and then
  discovered the declared data tools. It made no experiment read or solver
  call before `BUDGET_EXHAUSTED`. This observed failure informed the revised
  test prompt and is seen development evidence, not a blind evaluation.
- **Active filter:** with that revised prompt, the Agent listed Skills, read
  the pinned `active-filter-design` digest, discovered the data tools and
  successfully read the approved experiment. It made no search or solver call
  before `BUDGET_EXHAUSTED`. This is also seen development evidence, not a
  blind evaluation.

Both experiments remained idle with zero candidates, trials, observations and
reports. The export validator checked the original Spec hashes but returned
`reportReproduced: false` for both because no report existed. Thus neither
case has a scientific PASS, FAIL or INCONCLUSIVE report; the Agent acceptance
is incomplete and does not establish a full backend report re-evaluation.
The retained local receipts and raw session/export artifacts are under
`test-results/control-lab-live/p-golden-wuKQCe/` and
`test-results/control-lab-live/active-filter-MzDYZl/` (ignored test artifacts).
All owned processes exited and both temporary profiles were removed.

The actual advertised tool set included `skill`, `chart_render`, MCP resource
listing/reading, and the Host `app_describe`, `app_use`, `app_write`,
`content_read` and `computer_use` tools. Computer Use was disabled in the
isolated profile and denied for the research session; neither model called
it. Native workspace/shell, coding and subagent tools were not enabled.

Provider-reported usage per attempt is shown as input / cache-read / output /
total tokens; these are reported values, not a dollar-cost estimate:

| Scene | Attempt 1 | Attempt 2 | Attempt 3 |
| --- | --- | --- | --- |
| P golden | 7,552 / 384 / 69 / 8,005 | 476 / 7,808 / 200 / 8,484 | 410 / 8,448 / 31 / 8,889 |
| Active filter | 1,931 / 6,144 / 55 / 8,130 | 541 / 8,064 / 90 / 8,695 | 491 / 8,576 / 111 / 9,178 |

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

- A complete real-provider Agent run still requires search, a locked candidate,
  full final scenarios and independent reproduction of the saved report. The
  six-attempt budget above is exhausted; do not automatically retry or raise it.
- Signed-product installation remains a separate acceptance level. Solver and
  fixture checks do not establish it.

See [design](../design-docs/control-lab.md) and
[App instructions](../../apps/control-lab/README.md).
