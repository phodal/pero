---
kind: issue
status: resolved
date: 2026-11-06
---

# Customize catalog obscures service discovery with competing controls

The actual Native catalog shows a full-width search beside competing actions,
repeated host-capability badges and decorative placeholder-like art, a long row
of category choices, and full setup instructions on every service card. Titles
truncate before a person can identify the service. Legacy font rules also drift
from the shared component typography. The displayed update time is the local
snapshot read time, not a provider's update time.

Keep the service/installed views, installation and permission owners, retained
refresh results and recovery actions. Use shared navigation and controls, a
compact category selector, identifiable built-in capability entries and readable
service cards. Show essential availability and access conditions while browsing;
keep full setup prerequisites visible before configuration or installation.
Remove the persistent snapshot timestamp; a failed refresh still identifies
retained results. Verify real Native appearance separately from browser fixtures.


Implementation: `42aab97b`, `40dca903`, `63f53a49`. The independent review also
identified installation permission disclosure and shared-secret deletion impact;
both now have regression coverage. All 45 Connectors tests and 14 actual App frame
scenarios passed, alongside shared Tabs tests and root checks. The shared catalog
contains the navigation variant; the App consumes SDK Card and control styles.

Acceptance completed after unlock on source `17a67bcc`: actual Native catalog
and installed views use the shared Card surface and spaced Tabs with the shared
selected underline. Pointer switching has no lingering focus rectangle; Left
returns to the catalog with visible keyboard focus. Screenshots are linked in
`packages/pero-design/VERIFICATION.md`. The saved Compute cluster selection was
also observed after restart; scheduler execution remains outside this change.
