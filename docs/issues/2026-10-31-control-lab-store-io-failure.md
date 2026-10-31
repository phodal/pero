---
kind: incident
status: open
date: 2026-10-31
---

# Store save failures could leave inconsistent experiment state

The Store changed its in-memory experiment before saving the record. An I/O
failure could therefore leave memory and disk describing different states,
including a running operation, changed report, or trial that had not been
persisted. A worker start or result-save failure could also leave a running
trial without a usable completion record. This could obscure existing evidence
or make retry and budget accounting unreliable.

The repair under review builds transitions on a copy and publishes them to
memory after saving. If replacement reports an error, the Store compares the
record on disk with the old and intended snapshots; an unrecognizable or
unreadable state fences that experiment until the App is reopened. A failed
thread start is recorded without discarding the previous report. Worker failure
handling and startup recovery mark interrupted trials failed, retain available
raw failure artifacts, and leave those attempts in the shared budget ledger.

Seven deterministic fault-injection tests cover failure before writing, an
error reported after replacement, an ambiguous disk state, thread-start
failure, worker-save failure, legacy interrupted-trial recovery, and failure
to save a solver result. They check the relevant prior evidence and attempt
accounting as well as retry or fail-closed behavior. The strict scientific
suite passed all 42 tests with real python-control and ngspice, including the
fault-injection tests. Exact-head CI verification remains pending.

This protection is scoped to a single Store instance and ordinary process
interruption. It does not establish power-loss durability with `fsync` or
coordinate concurrent Store instances across processes.
