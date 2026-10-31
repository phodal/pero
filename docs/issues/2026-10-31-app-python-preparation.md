---
kind: incident
status: open
date: 2026-10-31
---

# App backends started before their Python dependencies were available

Desktop startup prepared only Paper Agent dependencies in a shared environment.
Control Lab's pinned numerical packages were not installed, and dependency errors
could appear only after its backend was launched. A fresh-environment check also
found the default system Python was 3.14: SciPy 1.15.3 attempted a source build and
failed without OpenBLAS. Merely invoking pip did not solve interpreter compatibility.

The Host now owns generic manifest-declared dependency preparation, using uv and
managed CPython 3.12 before enable/open. The shells bind a new shared environment,
retaining the earlier directory, and display preparation progress and retry.
Python setup no longer blocks Desktop startup or the Host input loop. Existing
explicit bindings retain their authority. External ngspice installation remains
outside the Python dependency path.

Verification is recorded in `docs/fitness/app-preparation.md`.
