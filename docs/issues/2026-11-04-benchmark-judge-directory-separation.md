---
kind: incident
status: resolved
---

# Polyglot judges were discoverable beside the agent workspace

The earlier Forth benchmark searched the parent tree and found a previous
attempt's official test path. No recorded call read that source, but the
runner had placed agent workspaces, baseline/reference judges and submissions
under the same task directory. The instruction to avoid hidden tests was not
an effective directory boundary.

Use an unrelated temporary workspace, as the QuixBugs runner already does.
Store its exact location in validation metadata and keep official judges in
the explicit output directory. Preserve task documentation, prompts, tests,
budgets, freezing and feedback. This removes the adjacent path exposure; it
does not establish OS-level filesystem or network isolation.

Verification: prepare-only ran all four pinned Polyglot tasks. Their 91
reference tests passed without skips and all skeletons failed. Each workspace
contained only its original solution skeleton and README; no workspace lived
in the task output or shared a parent with the judges. Exact workspace paths
are retained in validation records. No agent or paid request was involved in
this preparation check.
