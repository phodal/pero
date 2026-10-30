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

## 2026-10-30 actual Worker and native mirror measurement

The hidden 1px IME textarea previously soft-wrapped the full native selection.
Disabling hidden wrapping and containing its layout retains the actual textarea
text/selection/clipboard path. An isolated CSS-only experiment reduced 21 long
tasks to two: a 338 ms delayed highlighter and a 68 ms Select All task.

The dedicated content Worker now performs JSON syntax and large root preview
parsing. Shared immutable sources retain their preview and syntax indexes across
views. Actual Desktop asserts both Worker completions and no Worker errors,
structural gutter fold/unfold, precise clipboard and the existing table/search
operations. Three release-Wasm functional runs of the same 1,086,892-byte/8,000-row
source recorded thirty-switch p95 30.6–31.3 ms, maximum 31.5–33 ms and no long task
inside timed open/switch samples. The full trace still has a 57–61 ms
Select All task. Screenshots/receipts remain in `test-results/content-reader/`.

The incident stays open: this improves the main-thread path without disabling
features, but whole native selection has not met the frame budget. Large nested
projection, sorting/filtering, cold distributions, 100k-row actual UI, physical IME
and installed packages are not certified by the 8k functional benchmark.

## 100k-row actual UI and selection profile

The same real Desktop functional script now also passes 100,000 rows / 13,688,892
bytes, with syntax, preview and six retained Worker transformations completing
without errors. Thirty warm switches have p95 32.1 ms / maximum 32.4 ms, but
Source opening is 110 ms (59 ms task). All-operation traces contain eight long
tasks, peaking at 845 ms at native Select All; typing/copy/find include 51–103 ms
tasks. Receipt: `performance-completed-100k.json`. No budget pass is claimed.

A CDP trace on the 8k fixture attributes about 57.8 ms to browser Layout with
24,008 dirty objects when the textarea mirrors the full native selection.
Changing hidden font kerning/ligature rendering did not improve it and was not
shipped. The original text/selection and normal 16px IME font remain intact.
Root parsing and table transformations now run in an actual Worker; browser
selection layout, large editor creation and large nested projections remain open.
