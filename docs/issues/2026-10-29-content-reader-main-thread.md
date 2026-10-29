---
kind: incident
status: open
---

# Large source reading can block the Wasm thread

## What

In background Electron on macOS arm64, the new reader received a 1,086,892-byte
JSON array with 8,000 records. The first development build opened its preview
in about 116 ms, then opening Source scheduled a deferred 1,535 ms main-thread
task. Removing that parse exposed another independent problem: Select All
produced a 761 ms task, followed by repeated tasks around 70–90 ms during
otherwise read-only interaction.

Evidence is under `test-results/content-reader/`. The selection reproduction
is saved as `performance-before-selection.json`; it includes action phase
timestamps, source digest, environment and observed long tasks.

## Why

GPUI Kit's Syntect adapter schedules a full regex parse on its background
executor. That executor does not move the work onto another browser thread in
this Wasm build. A delayed parse still blocks the UI.

GPUI Web's IME mirror expands its DOM textarea window around the native
selection. A whole-document selection therefore mirrors the complete large
source. The stall begins at Select All, rather than initial editor focus;
subsequent redraws continue paying the mirror cost.

## Current decision and acceptance

The user prioritized functional equivalence before performance optimization.
The earlier large-source highlighter suppression and logical Select All
workaround are removed. Large sources retain syntax colors and actual native
selection, including partial selection and ordinary clipboard operations.
Those changes preserve functionality; they do not resolve this performance
incident.

Actual Desktop verification now opens complete file-backed results, retries a
missing file, switches JSON/source, rejects edits, checks exact partial/full
clipboard data, finds the final record and retains state after disclosure.
During that work, Kit's search overlay reselected the first typed character
when its query echo changed the viewport anchor. The reader now owns the query
field while using Kit's existing source matcher and navigation.

The functional release probe passes, but still records main-thread long tasks
around large-source parsing and selection. Keep this incident open until a
full-featured implementation passes the interaction budget. A fast opening
sample, disabling highlighter features, or replacing native selection does not
close it. The [acceptance matrix](../fitness/content-reader.md) records the
functional evidence and remaining boundaries.
