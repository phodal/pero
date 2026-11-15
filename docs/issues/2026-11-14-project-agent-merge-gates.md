---
kind: issue
status: resolved
date: 2026-11-14
---

# Project Agent merge gates

PR #231 head d0405f936 failed the core Host protocol contract in Actions run
43558147091: permission resolution is emitted but absent from host.tsp.
Review also identified incorrect waiting/follow-up status, dropped Start input,
workspace allocation before session admission, unbounded serialized evidence,
unbound Project broker credentials, stuck request state on transport failure,
long-goal resource overflow and receipt projection modifying code/fences.

Verify these findings against their owning implementations and repair there
before merging. Preserve the original journal, session, resource and protocol
owners; add focused behavioral cases. Release Virtual Cell preparation failure
in run 43558147069 is tracked separately in the existing Desktop release record.
No failed check or unresolved correctness finding establishes merge readiness.

## Resolution

The protocol source now declares the existing permission resolution receipt and
generated contracts are synchronized. The existing transcript projection tracks
outstanding permissions, question IDs and authentication together, and clears
turn-scoped errors/stop reasons on follow-up. Project broker credentials bind
the authenticated primary directly; a caller cannot substitute another thread.

Start with new instructions on an existing primary now fails explicitly with a
Followup recovery instruction; a retry cannot redispatch frozen initial input.
Shared session admission runs before allocating retained workspaces. Model
evidence is bounded after pretty serialization, including metadata and UTF-8
escaping, and reports omitted sessions. Project request completion has one owner
for response and immediate transport failure. Goal and materials share their
inspector scroll. Receipt projection preserves inline code and mixed code fences.

Local verification: Host protocol conformance; nine real Host/MCP/shell behaviors;
15 Electron Project Agent flows with zero renderer errors; 59 Host unit cases
(one existing Docker case ignored), 50 shared Chat cases, 81 Native-feature UI
cases, five Project contract cases and the runtime projection table pass.
Generated/repository checks and Wasm/Web builds pass. The long-goal screenshot
shows linked materials reachable at minimum window height. Remote CI must still
be checked on the pushed head before merge. The separate release preparation
failure is not reported as successful publication.
