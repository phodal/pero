# HPC Benchmarks

Select a versioned numerical method, run its fixed inputs with ReFrame, inspect
independent checks, and compare matching saved specifications. The App uses the
existing Pero Host lifecycle and shared Chat. It does not own Compute placement,
Worker registration, leases or a second generic task scheduler.

## Available methods

| Method | Fixed inputs | Independent checks |
| --- | --- | --- |
| Pi midpoint integration | 1024 and 2048 intervals over [0, 1] | Recomputed samples and integral, analytical error and convergence ratio |
| Poisson 1D finite differences | 64 and 128 intervals with a sine analytical solution | Boundary values, forcing, analytical error, convergence and discrete equation residual |
| OpenFOAM pipe flow on Slurm | Intended Re=100 Hagen–Poiseuille contract | Environment unavailable; no solver, Slurm or MPI execution in this version |

The two available methods perform real single-process CPU calculations through
ReFrame 4.10.4. They are local references. Their timings include runner overhead
and do not measure cluster performance or MPI scaling. A process finishing and
a numerical report passing are shown separately.

## Open the App

The Pero product includes `hpc`. Build and open the workbench, then enable
**HPC Benchmarks** under **Apps → Research**. Once enabled, it appears in the
sidebar with the other research Apps. Opening it uses the existing App enable
and environment preparation flow. The Host prepares the pinned Python dependency from
`app.json` using its existing environment setup flow. First use needs network
access for dependency installation. No model credentials or cluster account are
needed for the local references.

```sh
npm run dev:hpc
```

For an already built workbench, build just this App and start Desktop:

```sh
node scripts/build/apps.mjs --app hpc
npm run start
```

1. Select a method and inspect its fixed inputs and registered thresholds.
2. Choose **Run local reference**. The App retains original evidence after the run.
3. Inspect the recorded numerical curve, grid-error chart and check table in
   **Runs & checks**, then use **Verify saved evidence** to recompute checks.
4. Select two completed runs of the same specification and choose **Compare**.
5. Use **Export evidence ZIP** to retain an independently inspectable result.

Specifications include method/checker source and runner settings. Different
definitions are explicitly incomparable; failed checks and missing evidence are
not converted into successful measurements. A stopped App does not replay an
interrupted calculation on restart.

## Recheck an export

Extract the ZIP into a new directory. From that directory run:

```sh
python3 bundle/verify.py bundle
```

The checker needs only Python's standard library. It reads original samples and
fixed inputs, verifies frozen program hashes and computes a fresh report. It
does not trust a previous `verification.json`. Exit 0 means the registered checks
passed; exit 1 means failed or incomplete evidence. The ZIP also contains the
execution record, ReFrame report/log, raw CSV files and a file-hash manifest.

The exported hashes establish content consistency, not an external signature
or hardware attestation. Keep the original bundle when sharing results.

## Development checks

```sh
npm --prefix apps/hpc ci
npm --prefix apps/hpc run typecheck
npm run test:hpc
node scripts/build/apps.mjs --app hpc
```

The full execution tests require ReFrame 4.10.4 in the selected Python. To prepare
an isolated test environment without changing the workbench's normal settings:

```sh
python3 -m venv /tmp/pero-hpc-reframe
/tmp/pero-hpc-reframe/bin/python -m pip install reframe-hpc==4.10.4
/tmp/pero-hpc-reframe/bin/python -m unittest discover -s apps/hpc/test -p 'test_*.py' -v
PERO_APP_PYTHON=/tmp/pero-hpc-reframe/bin/python npm run test:hpc:e2e
```

Electron acceptance uses a temporary profile and hidden windows. Screenshots and
results are written to `test-results/hpc/`. It sends no real Agent request and
performs no Slurm, MPI or OpenFOAM execution. See [verification](../../docs/fitness/hpc.md)
and [ADR 0026](../../docs/adr/0026-hpc-benchmark-library.md).

## Extending the library

Add a fixed definition and method-specific numerical checks to
`benchmarks/local-reference/`, then register its definition path at the existing
runner composition point. Reuse the bundle, report and comparison contract.
External execution needs a real Compute/Host binding and separate acceptance;
it must not silently fall back to a local reference.
