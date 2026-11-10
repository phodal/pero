# HPC benchmark library verification

Date: 2026-11-10. Scope: re-acceptance of the local-reference App on current master.
Design: [ADR 0026](../adr/0026-hpc-benchmark-library.md).
Tracking: [#60](https://github.com/phodal/pero/issues/60).

The 2026-11-02 macOS record described an unreleased workspace. The implementation
has since landed (`c15ceb42`) and the workbench chrome changed in #113 and #137.
This file records a fresh Linux run of the same local-reference loop. It does
not accept the real Slurm/OpenFOAM items that remain on #60.

## Scope

The App runs fixed CPU methods through ReFrame 4.10.4 under the existing
Host-supervised Python lifecycle. Pi midpoint integration and Poisson 1D finite
differences have independent raw-data checks. These runs do not establish
Slurm, MPI, cluster performance, OpenFOAM physical accuracy or packaged release
acceptance. Compute placement, Worker leases and cloud Task/Run are unchanged.

## Verification evidence

Source: `23f45432` on `ce9e2a3a`. Platform: Linux x86_64, hidden real Electron,
actual Host, isolated Python 3.12 and ReFrame 4.10.4. This machine has no usable
WebGPU or WebGL adapter, so Electron used the repository's software WebGL switch
(`PERO_TEST_SOFTWARE_GL=1`). That is still the real Host and App, not a browser
mock. `npm run check` and the Rust test suite were not re-run for this record.

- `npm --prefix apps/hpc run typecheck`: passed.
- App UI presentation test: passed, including the Run control while the host
  column-header flag is on.
- ReFrame-enabled Python suite: 9 tests passed in 3.181s. Includes actual
  execution of pi twice and Poisson once, numerical fault variants, loopback
  authentication, bounded Agent actions, cancellation at the execution seam,
  restart without replay, comparison, ZIP file hashes and standalone rechecking.
- Real Electron workflow: 9 checks passed, page errors empty. Covers the builtin
  App, empty state, both methods, re-verification, actual ZIP download,
  independent offline checking, compatible and incompatible comparisons,
  unavailable OpenFOAM, light/dark, Chinese locale, keyboard pane resize, narrow
  stacked layout, corrupted-sample incomplete state, Desktop restart and the
  shared Chat draft without a model request.

The exported Poisson bundle from that Electron run was checked again with the
system Python standard library, outside the ReFrame environment:

| Field | Observed |
| --- | --- |
| Benchmark | `poisson-1d-v1`, local reference, ReFrame 4.10.4 |
| Status | execution `completed`, independent verification `pass` |
| Elapsed | 0.629915 s, reported separately from the error |
| Fine-grid absolute error | 5.020091591312337e-05 |
| Convergence ratio | 4.000361468367309 |
| Equation residual | 7.227995979519619e-12 |
| Offline `python3 bundle/verify.py bundle` | exit 0, status `pass` |

Pi midpoint integration also completed and passed twice in the same Electron
session. Its exact error was not copied out of a separate export. Both methods
are local CPU references. They do not measure Slurm, MPI or cluster performance.

The Python suite still rejects a damaged export that would keep an old PASS,
and the ZIP retains ReFrame `.out`, `.err` and `.sh` files. The Electron capture
`incomplete-evidence.png` shows the damaged Poisson run as Incomplete, with
"Unexpected raw sample columns", while the two earlier Pi runs stay Passed.

Runtime artifacts from this run are under `test-results/hpc/`: `result.json`,
`evidence.zip`, `library-light.png`, `verified-light.png`, `poisson-plot.png`,
`comparison.png`, `library-dark.png`, `results-dark.png`, `narrow-zh.png`, and
`incomplete-evidence.png`. Generated captures are not source files.

Built App bundle SHA-256 at `23f45432`:
JS `9890e885d48849e05496467d29e3d68cd0fd471abd44ace522513a8c2f0e43b0`,
CSS `28d7c969e379a70622f22a8cfe4f97609c09716c7e42d44e42b00cb0a98d4ed1`.

## Defects found on this re-run

1. `contributes.columnHeader` named Refresh, Discuss, and Run, and the App hid
   its own buttons because the host claimed that header. The header row did not
   present those actions, so a person could not start a local reference. The
   actions are back in the App. The presentation test keeps the host
   column-header flag on and still finds Run local reference.
2. A slower read of a run could replace a finished incomplete check with the
   earlier Verifying snapshot. The App now keeps the run with the later
   `updatedAt`. The Electron check waits until the visible details say
   Incomplete and no longer say Verifying or Passed.

Screen-reader coverage, signed packages, and other operating systems were not
part of this run.

## Remaining acceptance

- Authorized Slurm site and pinned OpenFOAM environment.
- Multi-rank computation inside a real allocation; actual node/rank receipts.
- Submission receipt loss, original-job reconciliation and confirmed cancellation.
- OpenFOAM pipe-flow raw output and preregistered physical checks.
- Remote Compute Run/attempt and artifact-reference integration.
- Signed package, upgrade and other platform acceptance.

Unavailable capabilities stay visible and cannot create successful-looking runs.
