---
kind: incident
status: resolved
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

## 2026-11-02: explicit environment recovery regression

The full App contract exposed a second preparation failure: every pinned Python
App was rebound to the managed 3.12 environment when its selected environment
failed the combined minor/isolation predicate. That replaced an explicit choice
even when the actual problem was a repairable `pyvenv.cfg`. Repairing the chosen
directory could not recover the running Host because its binding had changed.

Resolved in `a1527117`: ordinary App overrides remain selected, and invalid or
missing explicit environments fail without creating an environment or changing
the binding. Control Lab's documented migration from a valid incompatible minor
remains distinct from an invalid environment. A managed binding is saved only
after preparation succeeds.

The complete App contract passed on system Python 3.14.7, proving failure,
unchanged binding, repair in the same Host, restart, real backend/child-interpreter
use and missing-environment rejection without downloading dependencies.
Host/runtime suites and App Agent/Point Agent/plugin wiring checks also passed.
Packaged and platform acceptance boundaries remain in the verification record.

## 2026-11-02: opening an App acquires its environment

The same `resolve` path prepared dependencies before opening an App or reading
its project resource catalog. A navigation or read action could therefore
download Python and install packages without an explicit preparation action.
Opening must only check and reuse an available environment. Missing dependencies
must show a preparation action; only that action may acquire the environment.

Resolved by separating `prepare` from `enable` and `resolve`. The readiness check
reuses interpreter-selection and pinned-package checks without invoking the
installer or saving bindings. Both Desktop shells expose an explicit preparation
action; an unprepared App is shown as not ready rather than already installing.
The offline contract covers repeated opens, project catalog reads, missing pins
and unchanged settings. Real Desktop verification is recorded in `docs/fitness/app-preparation.md`.
