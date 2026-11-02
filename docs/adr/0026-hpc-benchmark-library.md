# ADR 0026: ReFrame benchmark library and Compute ownership

Status: accepted for the local reference slice, 2026-11-02.

## Context

Issue [#60](https://github.com/phodal/pero/issues/60) originally specified one
Slurm/OpenFOAM acceptance scenario. The product goal is a reusable benchmark
library: understand a versioned method, run it, inspect independent checks and
compare compatible evidence. A site-management console does not supply that
workflow. No real Slurm site is configured for this delivery.

The current `compute_view.rs` is a reserved view. Existing Task/Run/Worker and
Host execution capabilities remain the authority for generic compute. Their
presence does not imply a public App-to-Compute API or Slurm integration.

## Decision

Create the standard Python/React App `apps/hpc`, using the current App SDK,
Host-supervised Python lifecycle, App-owned durable data and shared Chat. Pin
ReFrame to 4.10.4. ReFrame executes only the bundled benchmark definitions;
requests cannot supply commands, Python code or arbitrary test paths.

The App owns benchmark definitions, frozen specifications, associated execution
evidence, verification and comparison. Its records are domain evidence, not a
second generic Task/Run or resource scheduler. Compute continues to own Worker
identity, placement, resource grants, leases and generic cancellation/recovery.
Future remote integrations bind the existing Run/attempt and artifact references.

For this slice, a local reference method runs as a bounded child of the
Host-supervised App backend. The backend persists evidence and supervises its
owned process; it does not register Workers or dispatch cloud tasks. Execution
completion, ReFrame sanity and independent numerical verification remain distinct.
Interrupted operations are not silently replayed after restart.

At least two original standard-library CPU numerical methods exercise the same
runner and result contract. Their inputs and checks are fixed before execution.
Local timings are observations of this process and machine, not HPC throughput,
scaling, MPI, Slurm or scientific-model validation claims.

An OpenFOAM Poiseuille definition records the intended physical contract and
environment requirements. Until its solver and site execution are connected and
verified, the App displays it as unavailable. It never substitutes a local toy
method for an OpenFOAM result.

Independent checkers read original output. Exported bundles carry frozen inputs,
raw data, logs, source/checker versions and hashes. Rechecking does not invoke
an Agent or silently widen a tolerance. Comparison requires matching method,
version and frozen specification; timings and numerical accuracy are separate.

## Consequences

Researchers can use and inspect the library without a cluster account. Slurm
submission, accounting, cancellation, lost-receipt reconciliation and multi-rank
OpenFOAM remain explicit acceptance work in #60. Adding a benchmark should
primarily add its definition, fixed method and checker, not fork execution or UI.

The App remains trusted local code under ADR 0007. No new credentials store,
approval queue, connector manager or execution fallback is introduced.

Actual checks and remaining acceptance gaps are recorded in
[HPC verification](../fitness/hpc.md).
