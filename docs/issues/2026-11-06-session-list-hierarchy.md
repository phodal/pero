---
kind: issue
status: resolved
date: 2026-11-06
---

# Session list hierarchy and interaction

The Native session column repeats textual running/attention labels, reserves an
empty leading icon slot and uses the global navigation selection treatment.
Permanent menus and a full search field compete with short conversation titles;
project groups do not offer creation in their own workspace.

Migrate recent-work rows from interaction_row to a shared compact SessionRow in
pero_theme. Use neutral selection, regular titles, semantic state icons and
stable project accents from the resolved palette. Keep title navigation and the
menu as sibling keyboard controls. Retain deletion confirmation, grouping,
pagination, split resizing, drafts, permission handling and workspace ownership.
Search expands on demand and stays available while filtering. Project creation
must use the existing workspace event before creating the draft.

Reading a session clears only its local unread indication. Pending permissions,
questions, authentication and errors remain real states until their owners
resolve them. Historical replay must not mark every conversation unread.

Acceptance covers actual Native light/dark, large UI type, hover and keyboard
menus, filtering, project-scoped creation and preserved pending-state icons.

## Resolution and evidence

Native now consumes shared session_row with generated 28px row / 14px status
metrics, regular 13px titles, neutral selection and stable project-folder colors.
Status sits to the right in a fixed slot, close to the independent menu; title
left edges stay aligned for quiet, unread, running, pending and failed rows.
Menu disclosure follows hover, selection, open state and actual descendant focus.
Search is disclosed on demand and retained while filtering; project plus uses
the existing confirmed workspace event before creating the new draft.

Actual macOS Native light/dark review used an isolated profile and explicitly
synthetic session events. Reading cleared unread while preserving pending
authorization controls. Keyboard Tab/Enter opened a nonselected row menu without
navigation; Escape closed it. Search filtering/clear, pagination and cross-project
creation were observed. Original preview profile startup no longer showed the
App-preparation error banner. Waiting/resume and retained unsent input were
observed with controlled events, not model execution. Large-font settings were
changed in the isolated profile, but the resulting session view was not accepted
before the user closed it; no large-font visual claim is made.

Unread is window-local. Screen-reader output and other operating systems remain
unverified. Build/test counts and screenshot locations are recorded in
packages/pero-design/VERIFICATION.md. No screenshots or fixture sessions enter Git.
