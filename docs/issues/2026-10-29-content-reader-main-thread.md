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

## 2026-10-30 regression receipt

The retained-document/file/App work preserves the large reader's functional
operations. A macOS background Electron release-Wasm run over 8,000 records
and 1,086,892 bytes recorded preview 38 ms, source 55 ms and a retained
switch 339.5 ms, including a 312 ms main-thread task. These are individual
probe samples, not a throughput distribution or release-Oz claim. The issue
remains open; no syntax/selection functionality was removed to improve the
numbers. Receipt: `test-results/content-reader/performance.json`.

## 2026-10-30 retained-table measurement

The source-backed Kit table keeps its parsed preview, query, order and widths
when an unchanged source switches modes. A release-Wasm macOS Electron probe
ran thirty retained switches over the same 1,086,892 bytes: median 30.2 ms,
p95 32.8 ms and maximum 369.8 ms. The timed switches included a 341 ms task;
the complete interaction record included 21 long tasks, peaking at 776 ms
around Select All. Opening preview/source had single samples of 44.1/54 ms.

The table operations pass, including exact clipboard values and source
navigation after filtering/sorting. None of the selection, syntax or source
features were removed. This remains an open performance incident: a low warm
p95 does not excuse a delayed highlighter or whole-selection stall. These are
functional release-Wasm receipts, not release-Oz, cold-start distributions or
installed-package results. `allLongTasks` contains the complete record.
