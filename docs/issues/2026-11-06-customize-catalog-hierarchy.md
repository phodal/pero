---
kind: issue
status: active
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

Pending acceptance: the final Native preview was rebuilt and restarted, but the
Mac locked before the SDK pointer-focus/Card delta could be observed. Keep this
tracker active until that visible-window check is completed. Earlier actual
Native observations and final browser evidence are recorded separately in
`packages/pero-design/VERIFICATION.md`.
