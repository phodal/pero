---
kind: issue
status: in_review
date: 2026-11-13
github_issue: 220
github_state: open
github_url: https://github.com/phodal/pero/issues/220
related: https://github.com/phodal/pero/issues/219
---

# Self-hosted Worker: deployed single-machine acceptance

Implement the first execution slice from architecture reference #219 without changing that reference issue's scope. Reuse the deployed Task/Run APIs, device enrollment, independent Rust Worker and frozen PyBaMM ACP method. A unique acceptance project/workspace/Agent isolates every run from ordinary repository work.

The missing evidence is production HTTPS dispatch to an independent execution machine with actual numerical output, cancellation and connection-loss recovery. Existing loopback/VM checks do not establish the deployed path. No model provider, new scheduler, blanket tool approval or control-plane deployment is needed.

Deliver a reusable opt-in operator command and retain exact Task/Run/Worker identities, method and binary hashes, bounded process/event evidence and numerical checking. Inject connection loss only through this Worker's explicit local CONNECT proxy; other network traffic is unaffected. Interrupted execution must retain its original Run and never replay the scientific prompt. An unresolved Run remains retained for operator review; do not bypass its Worker fence.

## Acceptance

- [x] Real deployed HTTPS enrollment and frozen calculation with independently checked output.
- [x] Actual calculation child stopped after cancellation.
- [x] Worker connection loss stops its child on lease loss; original journal reconciles without replay.
- [x] Repeated create/dispatch returns original identities.
- [x] Evidence records retained resources and the boundary between numerical consistency and scientific acceptance.

## Observed recovery defect

The first deployed run completed real numerical calculation and cancellation. Its connection-loss case stopped the actual calculation child and recovered the original Run as `reconcile`, but its start event had not reached Cloud before the tunnel closed. The initial acceptance incorrectly required that event in the server history.

Source review confirmed a separate product defect: when recovery observes a terminal Cloud Run, it clears the local active journal even if events were never acknowledged. That loses the only durable execution evidence available for reviewing effects. The server must continue rejecting late writes after lease expiry; recovery should retain an execution receipt locally before clearing intake state, without replaying events or the prompt.

The fix belongs to the existing Journal owner. Unacknowledged events and their original Run are saved beneath the journal's `.retained/` sibling directory before intake is cleared. A failure to durably retain the receipt leaves the original journal intact. The deployed check must distinguish uploaded server events from retained local evidence, and verify one calculation attempt across recovery.

First attempt evidence: `test-results/self-hosted-worker/online-20261113-1/`. Its failed receipt remains separate from the final acceptance run.

## Final deployed acceptance — 2026-11-13

Control plane: existing deployed revision `8b55dd835587cc8c9fdbadba2eae3548f45fd032`; no server deployment or database change. Execution: newly built local macOS Rust Worker, Python 3.12.11 and the existing locked real PyBaMM method; no model requests.

Final evidence is `test-results/self-hosted-worker/online-20261113-2/` in `/Users/phodal/workspaces/pero`. `receipt.json`, per-case details, `calculation-check.json`, original/disconnected Journals and `journal.retained/` record the complete result. Credentials remain in private files and are not included here.

| Case | Observed result |
| --- | --- |
| Calculation | `run_49dd9b9bbe5a4f69225aff533810a0f1`, succeeded, 11 server events, one start; all 61 samples consistent with the frozen reference |
| Cancellation | `run_193a797faae2de84d953a52d409ca4a7`, cancelled; observed calculation child no longer exists |
| Connection loss / recovery | `run_2545cba67bb8326aa9a4d46c712e25df`, original Run reconcile; child stopped; one local start and three total attempt directories across the three cases; unacknowledged evidence retained |
| Duplicate create / dispatch | All three cases returned original Task/Run identities |
| Scope / cleanup | Unique project `selfhost-4831f39d5f5a4138`; all owned Worker/proxy processes stopped; unresolved Run prevents device disable with 409, as required by the existing fence |

Worker SHA-256: `157eec601d9ebb779f76af7f4baff1f3158ea6e5537b3629e6966cf0542e4f3b`.
Method SHA-256: `52953a5a8bdd44f39ff29c3a721998d2a4cccebfcbe550c8115cea86155e64a1`.

The first and final attempts retain dedicated Workers with unresolved Runs: `worker_c220c68f52e9d8667f08aaa2c6498891` and `worker_8cbc5df7fedcb2ab3f963c907d2a3d3d`. Do not create replacement workers to bypass those fences; each invocation uses its own project and original identities.

`node scripts/cargo.mjs test -p pero-worker`: 18 unit and 17 process/protocol tests passed. Five frozen-method Python tests passed; new command compiled and its deployed integration passed. This is numerical/transport acceptance, not general writable Agent, GUI, signed-package, multi-machine or scientific acceptance. GitHub #220 remains open pending integration.
