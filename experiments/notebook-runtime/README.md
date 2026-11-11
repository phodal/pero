# Computational Notebook runtime experiment

Opt-in evidence for [#180](https://github.com/phodal/pero/issues/180), not a
product runtime or an editor migration. See the
[evaluation report](../../docs/fitness/notebook-runtime-poc.md) for measurements,
negative results and the proposed owner handoff.

## Reproduce

From the repository root, with `uv`, Go and the repository's Node dependencies
available. Dependency installation needs network; the authored calculations do
not. Python 3.12.11 on macOS arm64 was used for the recorded run.

```sh
uv venv --python 3.12.11 test-results/notebook-runtime/venv
uv pip sync --python test-results/notebook-runtime/venv/bin/python experiments/notebook-runtime/requirements.lock
test-results/notebook-runtime/venv/bin/python experiments/notebook-runtime/run.py test-results/notebook-runtime/replay
node experiments/notebook-runtime/inspect.mjs test-results/notebook-runtime/replay
```

Use a new output directory for each run. The runner refuses to overwrite an old
run. It creates a local kernelspec pointing at the exact Python executable; it
does not register a global kernel or start Jupyter Server. Chromium must already
be installed for the optional `inspect.mjs` step. That step blocks all non-loopback
requests and records table visibility, blocked URLs and screenshots.
It also checks both executed `.ipynb` files through Pero's existing document
parser/exporter and stale-output edit operation, without any UI or execution call.

Compare the **existing** Science Kernel on the same three cell bodies:

```sh
test-results/notebook-runtime/venv/bin/python - <<'PY'
import json, shutil, sys
from pathlib import Path
sys.path.insert(0, 'experiments/notebook-runtime')
from task import CELLS
root = Path('test-results/notebook-runtime/science-replay')
root.mkdir(parents=True, exist_ok=False)
shutil.copyfile('experiments/notebook-runtime/input.csv', root / 'input.csv')
(root / 'cells.json').write_text(json.dumps(CELLS))
PY
go -C harness/go run ../../experiments/notebook-runtime/science_probe.go "$PWD/test-results/notebook-runtime/venv/bin/python" "$PWD/test-results/notebook-runtime/science-replay" "$PWD/test-results/notebook-runtime/science-replay/cells.json" > test-results/notebook-runtime/science-replay/receipt.json
test-results/notebook-runtime/venv/bin/python - <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, 'experiments/notebook-runtime')
from run import EXPECTED
root = Path('test-results/notebook-runtime/science-replay')
receipt = json.loads((root / 'receipt.json').read_text())
assert json.loads(receipt['Output']) == EXPECTED
assert receipt['Reset'] is True
assert (root / 'table.html').is_file()
print('Science Kernel: authored values and fresh-state recovery verified')
PY
```

`science_probe.go` calls the production `scienceenv.Start/Exec/Close` directly.
The probe creates no Host/Agent identity and does not demonstrate Host permission
or Task/Run integration. Its readiness marker is an observed process file effect.

## What is measured

`input.csv` contains six synthetic rows. `task.py` supplies identical CSV loading,
exact-arithmetic means and output saving to all three paths. The independent
authored expectation in `run.py` is control **2 mg/L**, treatment **4 mg/L**, three
samples each. Changing `c1` from 1 to 4 produces a new control mean of 3 mg/L.
This is an engineering fixture, not a scientific dataset or independent review.

The runner exercises fresh execution, save/reopen, relocation with only source
and CSV, changed input, both format conversions, an authored `ValueError`,
recovery, Jupyter interrupt/restart/shutdown and marimo process cancellation.
Successful reruns clear output files first; stale artifacts cannot satisfy the
output check. Error runs retain the last good output digest. Jupyter reopens and
validates saved cells and output bundles without executing during that read.

A completed probe can contain a negative capability result: consult
`lifecycle.json`, especially `graceful_interrupt` and `forced_kill_required`, and
`browser.json`. Do not interpret process completion as scientific acceptance or
as acceptance of every upstream feature.

## Receipts and scope

- `commands.json`: actual argv, cwd, duration and exit code; stdout/stderr in
  separate files. Expected exception commands return nonzero.
- `environment.json`: Python/platform, interpreter digest, installed package
  versions/license metadata, package RECORD digests and dependency-lock digest.
- `*-receipt.json` / `snapshots.json`: input, serialized source, environment and
  result digests; execution, fixture verification and scientific acceptance are
  separate fields. These are local observations, not registered Pero Evidence.
- `.py`, `.ipynb`, JSON and HTML are generated under the run directory. Receipts
  keep the initial source and input; changed-input execution lives in another
  directory. Upstream export conversion is derived, not lossless archival.

`requirements.lock` pins the resolved environment; it is not an artifact-hash
lock, SBOM, license audit or reproducible cross-platform environment. RECORD
digests describe installed package metadata, not a full environment attestation.
Both upstreams run authored code with ordinary local process privileges. This
experiment adds no untrusted-notebook execution path to Pero and no sandbox.

## Files

| File | Responsibility |
| --- | --- |
| `task.py`, `input.csv` | One deterministic task and native marimo source construction |
| `run.py` | Experiment orchestration and frozen comparison receipts |
| `jupyter_probe.py` | nbformat/nbclient execution and actual kernel lifecycle |
| `science_probe.go` | Existing Science Kernel comparison |
| `inspect.mjs` | Offline saved-export observation in Chromium |
| `requirements.in`, `requirements.lock` | Direct candidate versions and resolved dependencies |
