# Six frozen PyBaMM CPU experiments

This method supports [#59](https://github.com/phodal/pero/issues/59) using the
existing Task/Run/Worker owners. It makes no battery accuracy or two-machine
acceptance claim. There is no model provider, Battery App, Campaign scheduler,
automatic retry, environment provisioning or arbitrary command input.

## Method and provenance

The implementation follows the fixed **PyBaMM 25.10.2** official
[model tutorial](https://docs.pybamm.org/en/v25.10.2/source/examples/notebooks/getting_started/tutorial-1-how-to-run-a-model.html)
and [parameter tutorial](https://docs.pybamm.org/en/v25.10.2/source/examples/notebooks/getting_started/tutorial-4-setting-parameter-values.html).
Upstream is [BSD-3-Clause](https://github.com/pybamm-team/PyBaMM/blob/v25.10.2/LICENSE.txt).
The bundled Chen2020 parameterization is a model input, not measured validation
data for these runs. Dependencies are installed, not vendored.

`manifest.json` freezes DFN, Chen2020 (5 Ah nominal capacity), isothermal operation,
initial SOC 1, IDAKLU with absolute/relative solver tolerances of 1e-8 and 20 mesh
points in each electrode/separator/particle dimension. The six combinations are
0.5/1/2 C × 298.15/308.15 K; current is 2.5/5/10 A. Each run spans 0–600 s and
exports 61 samples at 10 s spacing: time [s], terminal voltage [V], current [A]
and discharge capacity [Ah]. It is a bounded discharge window, not a full cycle.

The preregistered comparison uses `abs(a-b) <= max(1e-5 V, 1e-6*max(abs(a),abs(b)))`
for voltage. Current must match within 1e-9 A and capacity must match `I*t/3600`
within 1e-7 Ah. Time coverage, finite values, method/input/environment identity
and termination at final time are mandatory. A 2.5–4.3 V sanity interval is not
an accuracy claim. `check.py` uses only the standard library and never runs the
solver. A matching voltage curve proves reproducibility under these tolerances,
not agreement with a physical battery.

The method digest covers `manifest.json`, `requirements.lock`, `contract.py`,
`bundle.py` and `run.py`. Editing any requires new references and new task
bindings. `reference.jsonl` contains the six actual sequential macOS CPU results,
including hostname, architecture, Python/package versions and solve elapsed
seconds. Runtime is measured; no GPU cost or model usage is estimated.

## Locked environment and local calculation

Run from the repository root. Use a new isolated environment with Python 3.12.11:

```sh
uv venv --python 3.12.11 /absolute/path/pybamm-venv
uv pip sync --python /absolute/path/pybamm-venv/bin/python scripts/science/pybamm-sweep/requirements.lock
/absolute/path/pybamm-venv/bin/python scripts/science/pybamm-sweep/run.py reference /absolute/path/new-reference.jsonl
python3.12 scripts/science/pybamm-sweep/check.py scripts/science/pybamm-sweep/reference.jsonl /absolute/path/new-reference.jsonl
PYTHONPATH=scripts/science/pybamm-sweep python3.12 -m unittest discover -s scripts/science/pybamm-sweep -p 'test_*.py' -v
```

`run.py c05-t298 /absolute/path/result.jsonl` runs a single frozen item. Outputs
are created exclusively, so an existing reference is never overwritten. A failed
reference generation may leave an explicitly incomplete JSONL file; the checker
still reports all six items. Use a new destination for a new attempt.

All installed lock versions and the Python patch version are checked before a
solve. PyBaMM telemetry is disabled; numeric libraries and IDAKLU use one CPU
thread. No dataset download is needed at run time. Dependency installation is
the only ordinary network prerequisite.

## Use two explicitly authorized machines

Prerequisites: two independent Unix physical machines/VMs that the operator has
authorized; the same method files and lock installed on both; the pinned Python
environment above; an installed `pero-worker`; operator-owned allowlist/config;
one private writable workspace per machine; and access to the existing Go
control plane/PostgreSQL over HTTPS. Both Workers must be admitted to the same
project. A provisioned Worker ID or hostname alone is not proof of a second
machine or permission to use it. This delivery has **not** executed that step.

Build the existing Worker with `node scripts/cargo.mjs build --locked -p pero-worker`
on each supported host. Follow [Worker setup](../../../crates/pero-worker/README.md)
and [control-plane enrollment](../../../server/README.md). Configure each local
allowlisted Agent (replace all `/srv/...` paths with the actual approved paths):

```json
[
  {
    "id": "pybamm-sweep-v1",
    "name": "Frozen PyBaMM CPU method",
    "command": "/srv/pybamm-venv/bin/python",
    "args": ["/srv/pero/scripts/science/pybamm-sweep/acp.py", "--workspace", "/srv/battery-workspace"],
    "env": {}
  }
]
```

Worker configuration references that file and the exact allowed workspace:

```json
{"workspaces":{"battery":"/srv/battery-workspace"},"agents_file":"/srv/config/pybamm-agents.json"}
```

The trusted deterministic ACP executable is selected by local configuration;
Task text cannot choose a Python path, command, output location or new parameters.
No native approval bypass or model credential is configured. Leave each Worker's
existing single slot and default permission policy unchanged. Use its own
project-scoped token and durable journal when starting it:

```sh
export PERO_CLOUD_URL=https://your-authorized-control-plane
export PERO_WORKER_CONFIG=/srv/config/worker.json
export PERO_WORKER_STATE=/srv/state/pybamm-worker.json
# Set PERO_WORKER_TOKEN through your existing private credential setup.
/srv/pero/target/debug/pero-worker
```

On the operator machine, prepare a reviewable fixed mapping before submission.
`worker-A` and `worker-B` below must be the two actual authorized Worker IDs:

```sh
python3.12 scripts/science/pybamm-sweep/tasks.py prepare /absolute/path/batch.json \
  --name battery-six-v1 --origin https://your-authorized-control-plane \
  --project authorized-project --workspace battery --workers worker-A worker-B
# Set SWEEP_OPERATOR_TOKEN privately to the existing operator credential.
python3.12 scripts/science/pybamm-sweep/tasks.py submit /absolute/path/batch.json
python3.12 scripts/science/pybamm-sweep/tasks.py collect /absolute/path/batch.json /absolute/path/report.json
python3.12 scripts/science/pybamm-sweep/tasks.py cancel /absolute/path/batch.json c05-t298
```

The plan assigns three fixed inputs to each Worker; it does not rebalance or
retry them. The control plane owns execution and capacity. Repeating `submit`
with the same plan/scope retrieves the original six Tasks and Runs even after
completion. A deliberately different name/scope is a new six-experiment batch.
If submission is interrupted, rerun with the original plan: idempotency receipts
recover both Task and Run identities without expanding the list.

`collect` is read-only and retains six rows including pending, failed, cancelled,
reconciliation and unavailable items. `state` comes from the Run;
`verification` is independent (`consistent`, `needs_review`, `missing` or
`not_checked`). It never turns cancellation or missing output into success.
A superseding Run cannot silently replace the frozen Run binding. Repeated
identical result events deduplicate; conflicts and truncated evidence need review.

The existing Task details contain the bounded result document and process logs
as ordinary persisted session events. No new artifact store is introduced.
`report.json` retains those raw events plus Task/Run/generation/Worker identities,
result SHA-256, local file reference and hostname. On the executing machine,
`pybamm-results/<session-id>/` contains `result.jsonl`, `stdout.log` and `stderr.log`.
Digest checks apply to exact result bytes. Logs in events are bounded tails;
complete local logs remain in the referenced attempt directory. Results are
small enough for the existing 64,000-byte event-field cap.

For two-machine acceptance, retain the machines' actual inventory/authorization
and installed version evidence; both must finish at least one real experiment.
Capture a separate fault batch: incompatible environment (no solve starts),
occupied slot, actual cancellation with observed process exit, and a real
disconnect/restart with the original journal/Run preserved. Record every row,
including work requiring operator reconciliation; never clear that journal to
force a retry. Then run `collect` and inspect both result bytes and process logs.
The report intentionally leaves `machine_acceptance` and `scientific_acceptance`
as `not_assessed`; those are not inferred from Worker counts or numerical matches.

## Reproduce the local integration evidence

This command uses a disposable PostgreSQL cluster over a private Unix socket,
a loopback Go server and two actual Rust Worker processes on **one** host.
It submits real PyBaMM calculations (no LLM or mocked numerical output).
Requires `initdb`/`pg_ctl` on PATH and two Python executables: the pinned venv and
a separate unprepared Python 3.12 for the incompatible-environment case.

```sh
go -C server build -o /absolute/path/pero-server ./cmd/server
node scripts/cargo.mjs build --locked -p pero-worker -j 2
python3.12 scripts/science/pybamm-sweep/loopback.py \
  --server-bin /absolute/path/pero-server \
  --worker-bin /absolute/path/pero/target/debug/pero-worker \
  --python /absolute/path/pybamm-venv/bin/python \
  --unprepared-python /absolute/path/unprepared-python3.12 \
  --output /absolute/path/new-evidence-directory
```

The integration checks six consistent results, stable repeated submit receipts,
replayed event/completion receipts, conflicting late-event refusal, slot capacity,
real failed calculation, stopped/cancelled child, and supervisor SIGKILL followed
by same-journal reconciliation without replay. Fault injection waits for the
persisted child-start event, then SIGSTOPs that actual child to make cancellation
and parent-death cleanup observable; it does not claim cancellation at a
particular solver timestep. Polls observe external states with bounded deadlines.
The cluster and owned processes stop on exit; evidence files remain.
