---
kind: feature
status: in_progress
github_issue: 59
github_state: open
github_url: https://github.com/phodal/pero/issues/59
---

# Frozen PyBaMM experiments on existing Workers

Base: `561e2850157f3a0b406289dba9488206188451ab`. No existing canonical
tracker or PyBaMM PR was found on 2026-11-11. The current Worker runs locally
allowlisted ACP executables; the control plane already owns idempotency,
Task/Run attempts, Worker slots, leases, cancellation and durable events.

Provide a fixed CPU method and a narrow deterministic ACP executable, not a
model agent or new scheduler. Six experiment identities map to six existing
Tasks, with explicit Worker targets and idempotency keys. Small result documents
travel through existing persisted session events and remain visible in Task
details; the batch report references those Task/Run records and keeps all six
rows, including failure, cancellation, reconciliation and missing evidence.

The method is PyBaMM 25.10.2 DFN / Chen2020, isothermal, constant-current
discharge at 0.5/1/2 C and 298.15/308.15 K, bounded to 600 seconds. Freeze
inputs and tolerances after the six-case preflight, before reference/distributed
comparison. Verification checks numerical consistency, not experimental battery
accuracy. No new Battery App, generic Compute job or environment platform.

## Environment observations and boundaries

- Local macOS has Python 3.12.11, uv, PostgreSQL tools and a built Rust Worker.
- `limactl list --json` reports no VM; the Docker daemon is unavailable.
- No second independent machine with execution authorization was supplied.
  Two local Workers can establish loopback wiring only, never two-machine acceptance.
- All new computation/database state stays in the isolated worktree's ignored
  `test-results/pybamm-59/`. No model providers or external servers are started.

Initial PyBaMM installation selected NumPy 2.5.4, which removed `np.trapz` used
by PyBaMM 25.10.2's initial-SOC calculation. The preflight failed before solving;
pin a compatible numerical stack in the method lock rather than patching PyBaMM.

## Implemented and verified locally

Implementation and operator commands:
[scripts/science/pybamm-sweep](../../scripts/science/pybamm-sweep/README.md).
The scientific template is commit `f93601b6bbb4e885c75e1a67597f16650ed6b0a5`.
Method source SHA-256 (including final pure domain / file-boundary separation):
`52953a5a8bdd44f39ff29c3a721998d2a4cccebfcbe550c8115cea86155e64a1`.
The committed six-row reference and the final real Worker results all carry
this exact digest. Earlier preflight outputs were not reused as final evidence.

- Frozen Python 3.12.11, PyBaMM 25.10.2, NumPy 2.2.6, SciPy 1.15.3,
  CasADi 3.6.7 and pybammsolvers 0.3.3; the entire installed dependency set is
  pinned in `requirements.lock`. No runtime dataset download or model calls.
- Actual sequential CPU reference: 6/6 reached 600 s and exported all 61 samples.
  Fixed units, mesh, solver settings and comparison tolerances are in the manifest.
  A standard-library checker independently checks shape, finite values, input,
  source/environment identity, constant current, charge balance and voltage.
- Explicit six-Task / six-Run list via the existing APIs; each of two explicit
  Worker IDs receives three inputs. Idempotency keys survive local receipt-file
  recovery. No template scheduling, auto-retry or new execution state owner.
- Results and bounded log tails travel through existing persisted Run events;
  the report preserves raw events, Task/Run/generation/Worker binding, file bytes,
  SHA-256, local output reference and observed hostname. Local full logs remain.
- Summary always has six rows. State comes from the Run and verification remains
  separate; missing/truncated/conflicting evidence and superseded attempts cannot
  become verified success.

## Final real loopback acceptance — 2026-11-11

Executed in `/Users/phodal/workspaces/pero-issue-59` on macOS with a fresh
Unix-socket PostgreSQL cluster, freshly built Go control plane and Rust Worker,
two local Worker processes, and real PyBaMM calculation subprocesses.

| Check | Observed result |
| --- | --- |
| Scientific reference versus actual Worker outputs | 6/6 consistent; each Worker completed 3; one physical host |
| Repeat submission after completion | Same six Task/Run IDs; zero extra tasks or calculation files |
| Repeat real event batches and completion payloads | Six original receipts, unchanged event histories |
| Conflicting late result events | 6/6 refused with HTTP 409 |
| Occupied Worker, second process-instance claim | No assignment; one slot preserved |
| Unprepared Python environment | Failed before PyBaMM solve; real error/log retained |
| Cancel running calculation process | Run cancelled; actual child PID no longer exists |
| SIGKILL Worker; restart with original journal | Original Run becomes `reconcile`; exactly one calculation-start event, no replay |
| Fault batch full denominator | `failed, cancelled, reconcile, queued, queued, queued`; 0/6 consistent, no hidden rows |

Cancellation and crash injection wait for the persisted child-start event and
SIGSTOP that actual child before requesting cancellation/killing the Worker.
This proves process supervision; it is not evidence of cancellation at a
particular numerical timestep. All test-owned processes and PostgreSQL stopped.

Exact final integration command:

```sh
python3.12 scripts/science/pybamm-sweep/loopback.py \
  --server-bin /Users/phodal/workspaces/pero-issue-59/test-results/pybamm-59/pero-server \
  --worker-bin /Users/phodal/workspaces/pero-issue-59/target/debug/pero-worker \
  --python /Users/phodal/workspaces/pero-issue-59/test-results/pybamm-59/venv/bin/python \
  --unprepared-python /Users/phodal/.local/bin/python3.12 \
  --output /Users/phodal/workspaces/pero-issue-59/test-results/pybamm-59/loopback-3
```

Evidence root: `/Users/phodal/workspaces/pero-issue-59/test-results/pybamm-59/`.
`loopback-3/receipt.json`, `normal-report.json`, `fault-report.json`, individual
Worker logs and local result/log files retain the complete denominator.
`loopback-3.log` is the command output. `reference.log`, `reference-check.json`,
`unit.log` and `worker-build.log` record the other checks. Four unittest methods
cover value corruption, replay/conflict, stale identity and non-success reporting.
The MCP #185 worktree/commit was left unchanged.

The first loopback run exposed a null `data` field in ordinary lifecycle events;
the test now observes only content-bearing data, then the complete test passed.
An attempted custom Cargo target under `test-results/` hit workspace inheritance
in the existing GPUI path patches; the supported root `target/` build passed.
No unrelated build or control-plane source was changed.

## Remaining issue acceptance

GitHub #59 remains open. No second authorized independent machine/VM was available.
The README supplies exact installation, allowlist, Worker, submission, report and
fault-reproduction steps for the two-machine operator run. Real two-machine
execution and network disconnect/recovery remain unverified. No Electron/Native
GUI, packaged installation, remote deployment, or experimental battery-model
accuracy acceptance is claimed. The Task UI can already read the existing events;
the new batch report is a CLI-generated JSON projection, not a new product UI.
