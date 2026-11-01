---
kind: verification_report
status: resolved
date: 2026-11-01
github_issue: 75
github_state: open
github_url: https://github.com/phodal/pero/issues/75
---

# PDF original-cache integrity

## Failure and correction

PR #80's post-merge review found that a completed PDF receipt only checked whether
its cache file existed. A truncated or same-length replaced file was consequently
reported available, skipped explicit restoration, and allowed source comparison
against old extracted page text. `save_pdf` also retained an existing damaged file.

Availability now checks the receipt's size and SHA-256. Explicit restoration still
requires the original digest, preserves the original receipt/document/study, and
publishes verified bytes by same-directory temporary write plus atomic replacement.
A file symlink is unavailable and is replaced as a directory entry, not written
through; a symlink cache directory is rejected. This is not an OS filesystem sandbox
or a guarantee against a concurrent adversarial mutation of the app-owned directory.

Regression coverage includes missing, truncated, same-length modified and symlink
cache entries; changed remote bytes remain rejected before publication. Tests also
check failed atomic publication leaves old bytes intact and removes temporary files,
invalid save input is rejected, and symlink destinations remain untouched.

## Acceptance boundary

This repair addresses the cached-original reliability finding only. Issue #75
remains open for its itemized source-first acceptance reconciliation. Existing
Aptamer source / Google VERID PDF live product evidence, synthetic Desktop journeys,
and earlier real-provider observations must remain separately described. This change
does not claim three-material live source acquisition, a validated source/image
report model, fully correct model interpretation, or scientific reproduction.
No new live-network, paid-provider, or user-Mac test is part of this repair.

## Local verification

- `PYTHONPATH=apps/paper-agent/backend python -m unittest discover -s apps/paper-agent/test -p 'test_*.py' -v`: 126 tests, OK (one Windows-only lifecycle test skipped on Linux).
- `tests/e2e/paper-source-http.py`: passed, synthetic transport.
- `tests/e2e/paper-pdf-http.py`: passed, synthetic transport.
- `tests/e2e/paper-source-cli.py`: passed, synthetic transport and actual subprocess restart.
- Python compileall and `git diff --check`: passed. All changed Python files remain below 1000 lines.

The first full run exposed 14 tests whose fabricated file digests did not match
fixture bytes. Their persisted fixtures now use actual digests; distinct versions
retain distinct bytes. The rerun above includes the merged pc-gym regressions.
No CI, Electron, real-source acquisition, or provider run is claimed for this patch.
