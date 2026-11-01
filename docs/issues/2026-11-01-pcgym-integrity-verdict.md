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

The local checker also read observation bytes twice: once to hash and again to
parse. A deterministic file replacement between reads demonstrated a report whose
counts came from different bytes than its matching receipt. The bounded JSON
reader now returns both bytes and parsed value from one read; the checker hashes
that same snapshot. The regression checks the original snapshot consistently,
then confirms a subsequent check rejects the replacement against the old receipt.
