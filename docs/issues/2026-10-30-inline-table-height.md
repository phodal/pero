---
kind: incident
status: resolved
---

# Single-row inline JSON preview hides its data row

## What

The actual macOS Electron wide-content suite admits all 2,001 JSON fields, but
its one-row inline preview displays only the filter and column headers. The
virtualized body reports an empty visible column range. The screenshot and
diagnostic are `test-results/wide-content/failure.png` and `failure.json` from
release-Wasm snapshot `pero-content-release-tYZGeN`.

## Why and repair

The compact Reader height included its toolbar, table header and data rows but
omitted the table's 32-pixel filter strip and outer border. A one-row result
therefore left no height for the data body. The inline preview now budgets those
existing controls and border along with its rows, retaining the 400-pixel cap.
Workspace readers keep their flex-based full-height layout.

## Verification

The fresh release-Wasm `pero-content-release-UWtLMd` build passes the unchanged
actual wide-content workflow. The single data row is visible; only columns 0–8
are rendered initially, and keyboard End renders columns 1,995–2,001. Copy and
source ranges preserve the original large numeric spelling. The suite also
passes the separate 4,000-row nested Worker/cache gate. Receipts are
`test-results/wide-content/result.json` and `last-column.png`; no threshold or
input sequence is relaxed.
