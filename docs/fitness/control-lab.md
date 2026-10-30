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

The Agent data route now rejects experiment creation and changes to frozen
criteria, modeling inputs and candidate budget; human creation remains on its
existing route. This is an entry-point restriction, not a trusted research
goal: the Host does not yet bind an approved experiment ID and spec hash to a
session, and generic App Use can still operate the human UI. The two supplied
read-only Skills give workflow guidance but do not enforce this boundary.
Do not count the scripted ACP fixture as a real model or run the proposed
single-goal acceptance until Host binding and bypass rejection are verified.
The authorized DeepSeek budget for this continuation is six provider HTTP
attempts total, at most 8192 output tokens per request; none was used here.

On 2026-10-30, the narrowed Agent route and its negative cases passed the strict
science suite on Darwin 27: 21 tests, zero skips, with Python 3.12.11,
python-control 0.10.2 and ngspice 46. The locked SciPy 1.15.3 macOS 12 ARM
wheel was needed because the macOS 14 wheel failed to load on that host.
The frontend typecheck, six UI/schema tests and read-only Skill catalog tests
also passed. These results do not establish a real-model run.
The headed Desktop → scripted ACP → Host MCP → python-control fixture also
passed with `realModel: false`: its independent persisted report was FAIL,
the four invalid proposals or budget requests were rejected, and all owned
processes exited without recovery. The local receipt is
`test-results/control-lab-app-use/result.json` (an ignored test artifact).

The remaining binding must use trusted Host state tied to the actual submitted
context and session, verify the ID and hash against the backend's frozen Spec,
and reject unbound or mismatched requests as well as generic UI and computer
operations that bypass the goal. It needs a single cross-process attempt ledger,
real ACP/MCP tool evidence, independent exported-evidence re-evaluation and
process cleanup before a real-model result can be claimed.

- Run actual Desktop interaction, dark/light/narrow screenshots and App Use
  acceptance. The current cloud workspace has no native display; do not
  substitute headless screenshots for a native-window gate.
- Validate the exact published PR commit and its merge with current master.
- Real-provider Agent and signed-product installation remain opt-in separate
  acceptance levels, not implied by solver or ACP-fixture tests.

See [design](../design-docs/control-lab.md) and
[App instructions](../../apps/control-lab/README.md).
