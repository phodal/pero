# HPC benchmark library verification

Date: 2026-11-02. Scope: source and local-reference development acceptance.
Design: [ADR 0026](../adr/0026-hpc-benchmark-library.md).
Tracking: [#60](https://github.com/phodal/pero/issues/60).

## Scope

The App runs fixed CPU methods through ReFrame 4.10.4 under the existing
Host-supervised Python lifecycle. Pi midpoint integration and Poisson 1D finite
differences have independent raw-data checks. These runs do not establish
Slurm, MPI, cluster performance, OpenFOAM physical accuracy or packaged release
acceptance. Compute placement, Worker leases and cloud Task/Run are unchanged.

## Verification evidence

Source baseline: `7d416af5551d131d5063511b5d9258b50b073d61` plus the scoped HPC changes. Platform:
macOS arm64, hidden real Electron, actual Host, isolated Python and ReFrame 4.10.4.

- `npm --prefix apps/hpc run typecheck`: passed.
- App build and Desktop build: passed.
- `npm run check`: passed (TypeScript, generated theme/design/contracts, locales,
  icons).
- ReFrame-enabled Python suite: 9 tests passed. Includes actual execution of pi
  twice and Poisson once, numerical fault variants, loopback authentication,
  bounded Agent actions, cancellation at the execution seam, restart without
  replay, comparison, ZIP file hashes and standalone rechecking.
- Real Electron workflow: passed with zero page errors. Covers the builtin App,
  empty state, both methods, re-verification, actual ZIP download, independent
  offline checking, compatible/incompatible comparisons, unavailable OpenFOAM,
  light/dark, Chinese locale, keyboard pane resize, narrow stacked layout,
  corrupted-sample incomplete state, Desktop restart and shared Chat context
  drafts without submitting a model request. Nine workflow checks passed.

The numerical results observed in the real runner were:

| Method | Fine-grid error | Convergence ratio | Equation residual |
| --- | --- | --- | --- |
| Pi midpoint | 1.9868215073159945e-8 | 3.999999977648258 | Not applicable |
| Poisson 1D | 5.020091591312337e-5 | 4.000361468367309 | 7.227995979519619e-12 |

Review also reproduced and fixed stale PASS reports remaining in exports after
an input-hash preflight failure. Re-verification now removes the old report
before checking frozen files. Tests assert that the damaged export has no old
verification report. Exports retain original ReFrame `.out`, `.err` and `.sh`
files as well as raw numerical evidence.

Runtime artifacts are under `test-results/hpc/`: `result.json`, `evidence.zip`,
`library-light.png`, `verified-light.png`, `comparison.png`, `library-dark.png`,
`narrow-zh.png`, and `incomplete-evidence.png`. Generated captures and result
bundles are not source files.

Tested UI JS SHA-256:
`8e1c3a4472d18a56298d65145399c68e4e5e256ad669043e239bf1160c73914a`.
CSS SHA-256:
`0b385be4a0543f1f91798322759ea71611348061aa6c05b5144b858d519a5f64`.

## Review corrections

1. Removed repeated local-runtime warnings, duplicate sidebar run history and
   redundant status blocks. Controls follow 24px rows, 30px tabs and 12px spacing;
   keyboard focus is visible and dark search fields retain readable text.
2. Numerical solution/integrand curves come from retained CSV samples; coarse/fine
   grid errors come from the independent report. Plots use text labels and keep
   the equivalent check table. Comparison shows the key numerical measures.
3. Plot/export reads now match recorded artifact hashes. Changed files require
   re-verification; they cannot be packaged beside a stale PASS. Real integration
   tests exercise both the plot data and damaged-evidence rejection.
4. Rechecking clears the displayed old curve while the report is unavailable,
   including failed rechecks, so graphs cannot outlive their evidence.

Fresh validation: 9 ReFrame-enabled Python tests and 9 real Electron workflows
passed. Both numerical methods render actual curves; light/dark and narrow
states were inspected. Typecheck, App build, repository check and the full App
stdio contract suite passed. The earlier shared Python recovery blocker was
fixed separately; no HPC change claims ownership of that fix.

Captures include `poisson-plot.png`, `results-dark.png` and `narrow-zh.png` under
`test-results/hpc/`. Tests verify geometry/overflow and semantic controls;
complete screen-reader and other-platform acceptance remain outside this run.

## Remaining acceptance

- Authorized Slurm site and pinned OpenFOAM environment.
- Multi-rank computation inside a real allocation; actual node/rank receipts.
- Submission receipt loss, original-job reconciliation and confirmed cancellation.
- OpenFOAM pipe-flow raw output and preregistered physical checks.
- Remote Compute Run/attempt and artifact-reference integration.
- Signed package, upgrade and other platform acceptance.

Unavailable capabilities stay visible and cannot create successful-looking runs.
