---
kind: incident
status: in_progress
---

# Parallel tool results have no combined output budget

The existing spill policy caps individual results, so a batch can still retain
many large results in every following request. The native CLI registers no spill
backend or readback capability. Request traces also lack actual serialized wire
sizes, making schema/history byte estimates easy to confuse with provider tokens.

Keep the existing ordered batch commit and scoped spill authority. Share a live
64 KiB text budget across results, save complete text before projecting, and keep
the original evidence if saving fails. Preserve errors, metadata and contiguous
results. Add Session-owned bounded readback with a stable private CLI store, and
record actual pre-HTTP serialized byte sizes separately from usage and attempts.

Verify bounded combined text, complete recovery, fail-open storage, ownership,
UTF-8 pagination, cold readback and real provider-wire attribution.
