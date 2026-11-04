---
kind: progress_note
status: in_progress
---

# Tool-call efficiency follow-up

Implement the source-audit findings without creating another tool scheduler,
activation authority, process owner or Session history representation.

- [x] Exact tool names select only that tool; compact deferred discovery receipts
  retain complete durable metadata and existing version/permission checks.
- [x] Short checks remain available with deferred tools, with explicit bounded
  execution and recoverable owned-job receipts.
- [x] Result-aware runtime no-progress reminders preserve changing reads and
  polling, never veto or replay tool effects, and have durable attribution.
- [x] Bounded batch tool output uses existing spill storage, preserves recovery
  pointers and committed model history, and records boundary measurements.
- [x] Ignore-aware native search can continue past directory/traversal bounds.
- [x] Offline reports expose declaration/history contribution and distinguish
  repeated arguments with changed results from unchanged-result repetition.
- [ ] Focused behavior tests, full Harness race/vet, standalone build checks,
  and bounded live coding follow-up are recorded with source revision.

The evidence baseline is four existing Sessions: 65 responses, 62 calls,
717,812 recorded tokens. No causal savings claim follows from a single sample.
Source audit and reproducible evidence are in the local analysis artifact
`/Users/phodal/workforce/openstar-agents/reports/tool-call-comparison-2026-11-04/`.
Canonical discovery and guidance incidents are reused in `docs/issues/`.
