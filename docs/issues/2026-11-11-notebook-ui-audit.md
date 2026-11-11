---
kind: issue
status: in_progress
date: 2026-11-11
---

# Notebook UI hides everyday actions and overexposes setup details

The current browser audit at `b1b95293` found nine related usability problems:
invisible draft persistence status, clipped narrow title/status, oversized Insert
menus, hidden view navigation, premature input-table validation, technical evidence
entry, procedure setup preceding steps, mixed notebook-library/property ownership,
and tool emphasis disconnected from everyday work.

The changes keep the existing document, draft, revision, evidence and Host owners.
Shared SDK controls remain the interaction owners. Draft storage and explicit
revisions must remain distinct; existing scientific snapshots must remain fixed.

## Repair and migration

- Replace the clipped status and bottom-only save icon with visible persistence
  feedback and a named revision action. Expose core view tabs and current view.
- Preserve author popup sizing while the shared Popover clamps to the viewport;
  group Notebook insertion by task and retain mounted dialog state.
- Reflow titles and status at narrow widths, retaining long editable titles.
- Show neutral incomplete input drafts, reserve errors for invalid supplied values,
  and distinguish input tables from catalog registration.
- Put procedure steps before optional setup; keep meaningful existing data visible.
- Search notebooks in their navigation; separate current-entry properties and
  provenance from the notebook library.
- Select real fixed sources from saved notebooks, retaining file import and manual
  reference entry. Do not introduce cross-App permissions or invented evidence.

## Verification

Pending implementation and current browser/type/unit verification. Original audit
screenshots are outside the repository in the chat's `notebook-audit` artifact.
