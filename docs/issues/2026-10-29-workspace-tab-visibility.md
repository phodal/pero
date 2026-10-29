---
kind: incident
status: resolved
---

# Active workspace tabs can remain outside the visible strip

## What

In actual background Electron on macOS arm64, open eight conversations using
New chat in a 1488-pixel-wide window. The diagnostic snapshot selects the eighth
Conversation, but the tab strip remains at its initial horizontal position.
Only the earlier tabs are visible, with no visible active-tab indicator. The
conversation body is current; its corresponding navigation control is offscreen.

Observed on 2026-10-29 against the architecture source committed through
`24fc93a`, in the assembled development build with parallel App changes. The
probe used a disposable profile, sent no Agent prompt and reported no page errors.

Evidence: `test-results/workspace-comparison/eight-tabs-new-active.png` and
`result.json` (`count = 8`, active item index `7`, viewport width `1488`).

## Why

`workspace_view.rs` gives every tab a fixed width of 200 pixels and enables
horizontal scrolling, but it has no tab-strip ScrollHandle or reveal step when
the route changes. The model owns the right active identity; the view does not
bring that identity into view. Buttons also use list indices for their element
IDs, so a follow-up should keep their identity stable as earlier tabs close.

Zed's `Pane::update_active_tab` explicitly reveals the activated tab using its
scroll handle. That behavior is useful independently of a full Pane/Dock system.

## Resolution and verification

The tab strip now retains a ScrollHandle. The reveal identity includes the
current WorkspaceItem, its index and viewport width. Changes schedule reveal
on the next frame, after new layout bounds exist; GPUI's tracked Div consumes
the previous bounds before its prepaint update. Controls use WorkspaceItem
identity rather than list indices. Typed Ctrl-Tab actions work while a child
input owns focus, and New chat focuses its composer.

The original eight-tab reproduction used 200px tabs. The current compact
controls are at least 120px, so acceptance opens fourteen populated fixture
conversations. Actual background Electron verifies cycling in both directions,
closing an earlier tab without changing the selected source, and resizing
from 1488px to the Desktop minimum width. Diagnostic bounds confirm that the
active tab is completely inside the visible strip after resize.

Evidence: `node scripts/verify-content-reader.mjs --functional` and ignored
`test-results/content-reader/{fourteen-tabs,close-earlier-tab,narrow-tabs}.png`.
The test uses actual ACP fixtures and pointer/keyboard input; it does not mutate
the navigation model to force the result. Content-tab visibility does not prove
full Zed Pane/Dock equivalence.
