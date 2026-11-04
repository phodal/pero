---
kind: incident
status: resolved
---

# Successful shell exit can conceal an empty validation suite

The QuixBugs bitcount repair ran `python3 -m doctest -v bitcount.py`. Its
specification is a trailing string rather than a module/function docstring, so
doctest reported `0 tests in 2 items`, `Test passed.` and exit 0. The Session
report retained this output but did not flag it for review. Other local checks
and the separate official judge did run tests and pass; this is a gap in
validation evidence, not an implementation failure or a false benchmark pass.

Extend the existing offline validation-signal owner with empty-suite output
patterns for unittest, doctest and pytest. Keep them heuristic review
candidates. Do not change tool exit status, classify them as confirmed
failures, infer benchmark acceptance or rewrite raw Sessions.

Verification: the existing validation-evidence table includes empty unittest,
doctest and both pytest output forms, as well as nonempty and zero-failure
controls. Tool status remains succeeded and the confirmed failure count stays
zero. All 18 Session report tests and `git diff --check` pass. The live run's
original automatic summaries are retained; a separate offline reanalysis uses
the extended detector.
