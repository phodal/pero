---
kind: incident
status: open
date: 2026-10-30
---

# Core Desktop acceptance clicked outside the Stop button

The Linux core workbench suite in
[CI 41097883577](https://github.com/phodal/pero/actions/runs/41097883577)
kept the session running after clicking the old fixed coordinate (1430, 1030).
The shared Composer is now centered with a maximum width, so that position
is outside its Stop control. Increasing the idle timeout cannot fix the input.

Reuse the existing presentation-only `ViewBounds` probe on the actual GPUI
Stop button. After observing Running and a rendered layout, acceptance clicks
the measured center and retains its Idle assertion. No internal cancel method
is substituted for pointer input; no cancellation behavior or timeout changes.

A Stop-button screenshot is retained alongside the existing workbench evidence.
Actual headed CI and three-platform builds must verify this change. The current
cloud command executor is unavailable, so no new local test pass is claimed.
