---
kind: issue
status: active
github_issue: 180
github_state: open
github_url: https://github.com/phodal/pero/issues/180
---

# Computational Notebook PoC B

## What and why

Issue #180 proposes multiple notebook types but has no same-input runtime
experiment. Existing Notebook already owns editing, revisions and frozen owner
references; its code block explicitly has no execution authority. Science Kernel
already owns session-bound persistent Python/R, cancellation and fresh-process
recovery. Rebuilding either owner would hide the actual integration tradeoff.

Based on `561e2850157f3a0b406289dba9488206188451ab`, evaluate marimo 0.25.2 and
Jupyter nbclient 0.11.0 on one authored CSV-to-table task, with pinned environment,
saved output, reopening, relocation, cancellation and recovery. Fix nteract and
JupyterLab source versions and licenses, without installing a second daemon,
ACP service or product editor. Work stays in `experiments/notebook-runtime`.

## Acceptance boundary

The fixture is synthetic and deterministic. Runtime execution and equality do
not establish scientific acceptance, Pero UI integration, general notebook import
safety, collaboration, cross-platform compatibility or signed-product delivery.
The existing PoC A editor/Control Lab work is not part of this change.

## 2026-11-11 PoC B result

The bounded local runtime experiment is complete; the broader issue remains
active. [Evaluation and evidence](../fitness/notebook-runtime-poc.md) records
fixed versions/licenses, same-input execution, persistence, format conversion,
changed-input provenance, actual cancellation/recovery and offline exports.
[Rerun instructions](../../experiments/notebook-runtime/README.md) use an isolated
environment and existing Science Kernel directly.

Jupyter and marimo both reproduce the authored values. Jupyter interrupts retain
partial state; Science Kernel cancellation restarts fresh. marimo CLI requires a
forced kill after its 10-second SIGINT deadline in this fixture, and its default
HTML export does not render offline without CDN assets. Preserve these limits.

Recommendation: reuse existing Notebook revision/ipynb ownership and Science
Kernel; evaluate Jupyter modules for concrete interoperability needs. marimo
remains a separately managed reactive runtime candidate; nteract was not run.
No new daemon, ACP flow, Host owner, runtime protocol or product UI was added.
Next: review the proposed Computation Snapshot handoff and choose one explicit
Host-authorized integration scenario; broader #180 acceptance is still open.
