---
kind: incident
status: resolved
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
[CI 41142498082](https://github.com/phodal/pero/actions/runs/41142498082)
passed on exact head `076bbdba196beb9ab14ff0c298148ecfc4b8dffd`: all 18 checks
were green, including Desktop acceptance and platform builds. This records CI
execution, not an additional local test run.
