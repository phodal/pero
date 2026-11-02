---
kind: verification_report
date: 2026-11-02
---

# Workbench and research App UI refinement

Scope: the DESIGN-REVIEW.md checklist and AGENTS.md UI rules, applied to shared
window/sidebar separators, project navigation and linked records, Paper chrome,
and Control Lab/Lab controls and result panels. Scientific content, permissions
and acceptance rules retain their existing owners.

## Changes

- Use 0.5px secondary shell/project separators. Project Overview leaves directory
  details on Execution/Settings; the goal and linked work have the first screen.
- Show source and recorded execution metadata together, wrapping on narrow
  windows. Keep independent check verdicts and source-change warnings visible.
  Use lighter project-open actions and a visible cancellation label for linking.
- Tighten Paper result spacing and record-header chrome; reproduction code stays
  at least 12px. Preserve the document's reading typography and original figures.
- Align Control Lab/Lab control heights, page padding and panel typography.
  Replace Control Lab's fixed three-column grid with SDK Split/SplitPane, one
  filling pane and two bounded panes with App-owned persisted sizes. Narrow
  windows stack response, verification and model; no scientific result is hidden.

## Evidence

App TypeScript checks, App builds, Wasm/web builds, npm run check and all 18
pero-ui library tests passed. The real Electron research-projects flow passed
using synthetic records in real Paper/Control Lab/Lab backends, with no model
or scientific computation. It covers project creation, linking, exact record
navigation, error recovery, persistence and missing references.

The same flow verifies Control Lab separator keyboard resizing and double-click
reset, narrow stacking, and absence of page-wide horizontal overflow in all three
Apps. Light/dark and narrow screenshots were opened and inspected under
`test-results/research-projects/`, including `03-open-*`, `03-dark-*` and
`03-narrow-*`. Original simulation and unverified-state warnings remain visible.

The first Electron attempt ended with a closed browser; the subsequent run
completed. The full Control Lab solver suite did not start: the system Python
lacks python-control and ngspice is not installed. No dependency installation,
real solver acceptance, complete Paper workflow acceptance, signed installer or
production change is claimed by these checks.
