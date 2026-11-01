---
kind: analysis
status: resolved
date: 2026-11-01
---

# PC-Gym receipt verdict differed between callers

The core verification function returned numeric PASS even when its caller supplied
`receipt_matches=False`. The CLI corrected that to FAIL, while the portable
checker raised a separate error. Direct core users therefore received a different
integrity verdict for the same evidence.

The core now owns the failure verdict and reason. Both CLI and portable checker
consume that report; the latter prints it and exits nonzero on failure. Tests vary
receipt digest, spec identity and attempt identity, and compare direct core,
persisted CLI and a real offline checker process. Rehashing the archive manifest
does not turn a mismatched receipt into PASS. Scientific acceptance remains
INCONCLUSIVE, independently of numerical/integrity status.
