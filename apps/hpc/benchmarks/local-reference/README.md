# Fixed CPU numerical references

This bundle approximates the integral of `4 / (1 + x*x)` over `[0, 1]` with
midpoint quadrature at 1024 and 2048 intervals. Its analytical reference is pi.
The second definition in `../poisson1d/benchmark.json` solves
`-u'' = pi^2*sin(pi*x)`, with zero endpoint values and solution `sin(pi*x)`,
using a centered finite-difference stencil at 64 and 128 intervals.
Both benchmarks use this shared runner and verifier. They are single-process CPU work.
They do not exercise Slurm, MPI,
OpenFOAM, cluster scalability or production performance.

`benchmark.json` preregisters the input and limits. The fine estimate must have
absolute error at most `1e-7`. Halving the grid spacing must reduce error by a
factor between `3.9` and `4.1`. The independent checker recomputes every sample
and integral from the retained CSV files, checks finite values, verifies the
reported estimates, and verifies the frozen input/program hashes.
For the Poisson method the maximum pointwise error must be at most `1e-4`,
the convergence ratio must be between `3.9` and `4.1`, and the independently
recomputed discrete equation residual must be at most `1e-9`.

Prepare an empty directory with:

```sh
python3 prepare.py --output /absolute/path/to/run
# Or use the other preregistered numerical method:
python3 prepare.py --definition ../poisson1d/benchmark.json --output /absolute/path/to/poisson-run
```

The App runs the fixed `reframe_check.py` using ReFrame 4.10.4 and a generated
local-only site configuration. `PERO_HPC_RUN_DIR` binds this run directory.
ReFrame output and logs are retained alongside `runner.json`, `input.json`,
`manifest.json`, `raw/`, `result.json`, `checker.log` and `verification.json`.
Elapsed durations are diagnostic observations and have no performance gate.

Copy the complete directory elsewhere and recheck without installing ReFrame:

```sh
python3 /absolute/path/to/run/verify.py /absolute/path/to/run
```

This command prints a fresh report without trusting the previous
`verification.json`. `--write` replaces that report file. Exit 0 means all
checks pass; exit 1 means a failed or incomplete check. Missing or malformed
inputs/results remain incomplete. A completed computation can still fail the
independent checks.
