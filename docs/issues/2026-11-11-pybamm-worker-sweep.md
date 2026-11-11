---
kind: feature
status: resolved
github_issue: 59
github_state: closed
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

## Initial environment observations and boundaries

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

## Initial remaining acceptance (superseded by the follow-up below)

GitHub #59 remains open. No second authorized independent machine/VM was available.
The README supplies exact installation, allowlist, Worker, submission, report and
fault-reproduction steps for the two-machine operator run. Real two-machine
execution and network disconnect/recovery remain unverified. No Electron/Native
GUI, packaged installation, remote deployment, or experimental battery-model
accuracy acceptance is claimed. The Task UI can already read the existing events;
the new batch report is a CLI-generated JSON projection, not a new product UI.

## Product and independent VM follow-up — 2026-11-11

Base `5072cbc606064cd6141848a23587c7bdcbdf997e`, isolated worktree
`/Users/phodal/workspaces/pero-pybamm-product-59`. The user authorized a dedicated
local test VM. Created Lima `pero-pybamm-59`, Ubuntu 24.04 ARM64 on Apple VZ,
2 CPUs, 4 GiB RAM, a sparse 12 GiB disk and only this worktree mounted read-only.
Existing Colima VMs were not used or changed; no SSH private key was read.

Compute's existing result workspace now has an imported experiment-report view.
It displays the observation timestamp and the collector's recorded numerical
verdict, retains all six rows and exports exact result bytes plus Task/Run events
and logs. Importing a report does not contact Workers, change their state or
certify a scientific result. Invalid imports preserve the previous saved report.
Task links retain the existing `pero://tasks/` route. The frozen scientific method
and numerical checker remain unchanged; `collect` adds report metadata only.

Linux ARM preparation exposed two upstream packaging/build problems in the
locked pybammsolvers 0.3.3: no suitable wheel, an sdist missing CMakeLists.txt,
and the Git-tag build's hard-coded old C++ ABI conflicting with the ARM CasADi
3.6.7 wheel. The pinned official source is commit
`6e0c9286e65a29b35ac9941951e738ddb58e1d5a` (`v0.3.3`); a one-line ABI build
adjustment passed import and real calculations without changing solver/model versions or tolerance.
The dedicated Linux Worker was built from the base source. Cargo resolution only
changed unused gpui-component-macros 0.9.0 to 0.9.1; the Worker dependency versions
were unchanged. Exact resolved lock and build logs are retained.

Evidence root: `test-results/pybamm-59-vm/` in that worktree. The macOS Server
and Worker binaries were copied from the previous isolated acceptance and their
hashes retained in `binaries.sha256`, rather than rebuilding a second Rust target.
Cross-machine numerical/fault acceptance passed as recorded below.


## Independent-machine and product acceptance — 2026-11-11

The completed run is `test-results/pybamm-59-vm/acceptance-2/` under
`/Users/phodal/workspaces/pero-pybamm-product-59`. `receipt.json` and
`inventory.json` record macOS physical host `Phodal-Studio.local` and independent
Linux VM `lima-pero-pybamm-59` (Ubuntu 24.04 ARM64, Linux 6.8.0-134-generic).
Both ran actual native Rust Workers and real pinned PyBaMM processes.

| Check | Observed result |
| --- | --- |
| Independent-machine normal batch | 6/6 consistent; macOS 3, Linux VM 3 |
| Repeat submit and persisted receipts | Zero extra Tasks; six original event/completion receipts |
| Conflicting late events | 6/6 rejected with HTTP 409 |
| Occupied VM slot | Second instance received no assignment |
| Unprepared environment | Actual Run failed, retained process error |
| VM cancellation | Actual child stopped, Run cancelled |
| Actual VM→host network loss | 25 packets / 3824 bytes rejected at ephemeral server port; lease loss stopped child |
| Network restored, original journal | Same Run `run_0396a50822ecfbfc4921574fd2735928`, `reconcile`, one start event, no replay |
| Fault denominator | `failed, cancelled, queued, reconcile, queued, queued`; 0/6 consistent |
| Compute real-report browser test | 8/8 passed; downloads match raw result digest and retained Run record |
| Persistence and error recovery | Restart retains report; invalid five-row import preserves previous six |
| Appearance | Real normal report light / fault report narrow dark visually inspected; no horizontal overflow |

`normal-report.json` and `fault-report.json` retain raw events, complete method,
inputs/environment and execution identities. macOS full result/log files are in
`acceptance-2/macos/workspace/pybamm-results/`. Linux originals remain in
`/home/phodal.guest/pybamm59/acceptance-7a0ae14e03f5/workspace/pybamm-results/`;
a host copy is in `acceptance-2/linux-raw-results/pybamm-results/` and
`linux-raw-results.tar.gz`. Neither binaries nor evidence archives are committed.
Screenshots: `test-results/compute/task-report-normal-light.png` and
`task-report-fault-narrow-dark.png`. `compute-browser-real-py312.log` and
`compute-browser-real-default.log` both show 8/8; the latter uses system Python
3.9 after adding deferred annotations to preserve existing App compatibility.
Compute Python tests (8), typecheck, build with existing Reader/font artifacts,
and scientific-template tests (4) passed. Electron/Native was not run.

The final solver source/build recipe and artifact hash are in
[linux-arm64.md](../../scripts/science/pybamm-sweep/linux-arm64.md).
`linux-build-provenance.txt`, `linux-python-provenance.txt`, `linux-Cargo.lock`,
`linux-worker-build.log` and `binaries.sha256` retain the exact local provenance.
Linux Worker SHA-256:
`cd89c63e6c3edcde0f420120e6b5c388ee571b9581b4d65816195fa467417eaa`.

Preparation encountered host disk exhaustion during linking, causing guest I/O
errors and a corrupted CMakeLists.txt. Only this task's VM was stopped/restarted;
only its image download cache and disposable build intermediates were cleared.
The fixed source file was restored from the pinned Git commit, ABI 1 reapplied,
and the build/preflight rerun successfully. Existing VMs and others' caches were
untouched. First fault attempt (`acceptance-1`) had already completed the fast
calculation before a remote SIGSTOP arrived; the final test observes and freezes
inside the VM, then asserts actual cancellation. That failed attempt is retained.
No production Worker logic was changed to make the test pass.

Re-run from this worktree with the retained binaries/environment; start the named
VM if stopped. Use a new output path every time (the script refuses overwrite):

```sh
limactl start --tty=false pero-pybamm-59
/Users/phodal/.local/bin/python3.12 scripts/science/pybamm-sweep/two_machine.py \
  --server-bin /Users/phodal/workspaces/pero-pybamm-product-59/test-results/pybamm-59-vm/pero-server \
  --worker-bin /Users/phodal/workspaces/pero-pybamm-product-59/test-results/pybamm-59-vm/pero-worker-macos \
  --python /Users/phodal/workspaces/pero-issue-59/test-results/pybamm-59/venv/bin/python \
  --unprepared-python /Users/phodal/.local/bin/python3.12 \
  --vm pero-pybamm-59 \
  --guest-library-path /home/phodal.guest/pybamm59/solver-source/.idaklu/lib \
  --output /Users/phodal/workspaces/pero-pybamm-product-59/test-results/pybamm-59-vm/parent-review-1
```

This starts a small temporary PostgreSQL/server and the 2-CPU/4-GiB VM, runs six
normal calculations plus a bounded fault batch, and takes roughly one minute.
No compilation/download or paid model is needed. All test-owned processes stop
and the firewall rule is removed; leave originals for inspection. Stop the VM
with `limactl stop --tty=false pero-pybamm-59` after review. The VM was stopped
at handoff; its disk, binaries, environments and evidence remain available.

GitHub #59 remains open for parent review; this worktree does not push, merge or
close it. Two independent execution environments and network recovery are now
observed, while battery experimental accuracy, production HTTPS deployment,
packaged installation and Electron/Native acceptance remain unverified.

## Independent review found an ACP failure-reporting gap

Parent replay `test-results/pybamm-59-vm/parent-review-1/` timed out after 180 s:
Linux completed its first item, while the macOS ACP had created an empty attempt
directory, had no calculation child, and waited on stdin. Native process samples
(`acp-sample.txt`, `executor-sample.txt`) and the original Worker journal remain.
The original exception type was not recorded and cannot be recovered from that
terminated process. The immediate trigger therefore remains undetermined.

The observed failure path exposed a concrete protocol gap: `execute` ran as a
background task, and a process/filesystem exception could finish that task without
settling `session/prompt`. ACP now records `PERO_PYBAMM_ERROR` with the exception
type/message and returns the existing JSON-RPC error for that request. Execution
and Run state still belong to the existing Worker. No scientific method bytes,
comparison tolerance, Worker binary or scheduler changed.

A real pipe/process test drives missing-executable and blocked-output-directory
failures. Both now produce an error notice and response, then exit cleanly on EOF;
the prior revision hangs for both cases. This demonstrates the reporting defect,
not that either injected error was the original parent's trigger. Evidence:
`acp-failure-tests.log` (5/5 template tests) and `acp-baseline-failure.log`.
The complete new two-machine run `diagnostic-1/receipt.json` passed 6/6 with the
same cancellation/network-loss/recovery checks. Its logs and failed parent attempt
remain separate; the parent should replay into another new output directory.


## Coordinating acceptance — 2026-11-11

The coordinating chat independently reran the macOS/Linux VM six-case suite: 6/6 outputs, zero duplicate calculations, six rejected late results, real cancellation/network loss and original-Run reconciliation. The Compute result browser was inspected. The task VM is stopped; evidence and its disk are retained.

Code is merged through `735f3696`; [integration CI](https://github.com/phodal/pero/actions/runs/43019965818) records the merged source.
