---
kind: issue
status: resolved
---

# Image-only restart acceptance expected the wrong reader mode

CI run 41838456352 failed in `reopenImageOnly`: its screenshot shows the saved
metadata abstract with Read selected, not a failed PDF renderer. The preceding
`exerciseImageOnly` explicitly selects Read to verify that the metadata abstract
does not become extracted PDF text. The reader persists that mode and correctly
restores it after restart, but the test immediately expected a visible PDF.

The restart journey now verifies the restored Read mode, original paper identity,
abstract text and label, then explicitly selects PDF before retaining the existing
raster-render, document/receipt identity and single-acquisition assertions. No
product persistence behavior or timeout was changed.

Verification: JavaScript syntax, the six Library/reader-restoration focused tests,
all 13 PDF-acquisition Python tests and `git diff --check` passed. The current CI
failure screenshot was inspected from artifact 13328331785. A local Chromium
replay could not start because the cloud sandbox denies browser socket creation
(`EPERM`); full Desktop restart acceptance still needs CI verification.
