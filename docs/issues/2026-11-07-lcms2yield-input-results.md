---
kind: issue
status: resolved
---
# LCMS2Yield input and result mismatch

PR #154 routes reaction filters to unrelated showcase molecules. CSV quoting is
ignored and uploads truncate after 32 SMILES. Selecting a new upload displays
persisted predictions from the old input. These can misattribute scientific
results. Prediction must retain its selected rows; CSV input must be parsed and
bounded explicitly; displayed custom results must match the current input.

Resolved: selected reaction populations now receive indexed predictions and
scoped comparison status. CSV parsing retains quoted fields and rejects inputs
over 32 molecules. Custom predictions display only for matching ordered SMILES.
Verification: 10 Python tests, 4 input/plot tests, TypeScript and 2 sandboxed
production UI browser tests pass on macOS. Light and dark/narrow screenshots
were inspected. Inference is synthetic at its process seam; no real weights or
Native acceptance is claimed. Browser evidence is saved by CI as an artifact.
