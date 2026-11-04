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

## Follow-up: independent Polyglot judge

Review of the adjacent benchmark runner found that its unittest judge accepted
any successful exit with a `Ran N tests` footer, including zero tests or an
entirely skipped suite. No retained official sample had an empty or skipped
judge, but the acceptance rule could falsely pass one. Require a nonempty suite
without failures, errors or skips. This is separate from the reporter's
heuristic evidence; the external judge owns benchmark acceptance.

Verification: one acceptance table launches real unittest processes for a
passing, failing, erroneous, empty and skipped suite. Only the passing nonempty
suite is accepted; test counts and actual process status remain recorded.
