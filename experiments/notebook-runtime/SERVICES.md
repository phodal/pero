# Native runtime probes for #180

These opt-in probes start official upstream services, never a user service or AI
provider. Use fresh output directories. See the [cards](../../docs/fitness/notebook-runtime-cards.md)
and [ADR-0033](../../docs/adr/0033-notebook-interop-and-computation.md) for decisions.

```sh
uv venv --python 3.12 test-results/notebook-interop/comparison-venv
uv pip install --python test-results/notebook-interop/comparison-venv/bin/python -r experiments/notebook-runtime/requirements.lock
test-results/notebook-interop/comparison-venv/bin/python experiments/notebook-runtime/run.py test-results/notebook-interop/comparison-rerun
node experiments/notebook-runtime/marimo_service.mjs test-results/notebook-interop/comparison-venv/bin/python test-results/notebook-interop/marimo-rerun
uv venv --python 3.12 test-results/notebook-interop/jupyter-venv
uv pip install --python test-results/notebook-interop/jupyter-venv/bin/python -r experiments/notebook-runtime/jupyter-requirements.lock
test-results/notebook-interop/jupyter-venv/bin/python experiments/notebook-runtime/jupyter_lab_probe.py test-results/notebook-interop/jupyter-rerun
test-results/notebook-interop/jupyter-venv/bin/python experiments/notebook-runtime/inventory.py test-results/notebook-interop/jupyter-inventory-rerun
test-results/notebook-interop/jupyter-venv/bin/python experiments/notebook-runtime/upstream_inventory.py test-results/notebook-interop/source-inventory-rerun
```

nbconvert is now pinned to 7.17.1 after checking 7.17.0 advisories. Previous
measurements retain their original versions. Locks pin resolved package versions,
not distribution hashes or cross-platform builds. Jupyter has isolated config,
data and runtime directories, ephemeral server/MCP ports, and a temporary token
removed from logs. Do not publish its runtime cookie file. The native MCP server
has separate authority from Jupyter token authentication; only initialization
and tool discovery are exercised, with no ACP Agent or model request.

For macOS arm64, download the official artifacts (other OSes remain opt-in):

```sh
mkdir -p test-results/notebook-interop/upstream
curl -fL https://github.com/nteract/nteract/releases/download/v2.9.0-stable.202610230557/runt-darwin-arm64 -o test-results/notebook-interop/upstream/runt
curl -fL https://github.com/nteract/nteract/releases/download/v2.9.0-stable.202610230557/runtimed-darwin-arm64 -o test-results/notebook-interop/upstream/runtimed
chmod +x test-results/notebook-interop/upstream/runt test-results/notebook-interop/upstream/runtimed
shasum -a 256 test-results/notebook-interop/upstream/runt test-results/notebook-interop/upstream/runtimed
notebook_socket_dir=$(mktemp -d /tmp/pero-notebook.XXXXXX)
test-results/notebook-interop/upstream/runtimed run --socket "$notebook_socket_dir/runt.sock" --cache-dir "$PWD/test-results/notebook-interop/nteract-cache" --blob-store-dir "$PWD/test-results/notebook-interop/nteract-blobs" --uv-pool-size 1 --conda-pool-size 0 --pixi-pool-size 0 > test-results/notebook-interop/nteract.log 2>&1 &
notebook_daemon_pid=$!
test-results/notebook-interop/jupyter-venv/bin/python experiments/notebook-runtime/nteract_probe.py --runt test-results/notebook-interop/upstream/runt --socket "$notebook_socket_dir/runt.sock" --daemon-pid "$notebook_daemon_pid" --output test-results/notebook-interop/nteract-rerun
kill "$notebook_daemon_pid"
```

Observed SHA-256: `runt` = `063938007718cbdeb5883a59f59e73369d502a93be6a5271e70acd94c06320e9`;
`runtimed` = `e2e86875ea67340b2aa4020e7afd2381d382cecfbe12b1daa895a02186634d6b`.
These identify downloaded bytes; they are not signature verification. The daemon
may download pinned uv/Python and resolve its default environment. Its observed
interpreter/packages are recorded in `environment.json`; this automatic default
is not a frozen Pero environment binding. A zero-sized UV pool failed preparation;
one slot and native restart recovered. Stop only the process you started.

The nteract probe uses native tool schemas, structured results, fresh clients
reconnecting by Notebook ID, real saves, exception, interrupt and kernel restart.
It records automatic source formatting separately from AST/result equality.
`process_memory.py` samples root/descendant RSS, not peak memory or physical
allocation. Inventory scripts query PyPI/OSV, retain unavailable observations and
hash discovered license/NOTICE files. Cargo-lock inventory is source-level, not
an attestation of what was compiled into a release binary.
