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
