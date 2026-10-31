---
kind: issue
status: resolved
---

# Native App entry points and embedded surfaces

## What and why

Native already hosted generic HTTP(S) Web sources, but App management and panel
rendering still assumed Electron. The Apps library disabled its actions; the
sidebar's Insights shortcut independently refused native mode. Enabling just the
library left that shortcut showing `apps.native_unavailable`, as in the user's
2026-10-31 screenshot.

The same review found two other native assumptions: workspace recovery bypassed
the initial App catalog, so a restored App could be reconciled against an empty
catalog; and updating SDK CSS tokens alone did not update browser media queries
used by Apps such as Insights. Ordinary Wry children also cover floating GPUI
chat, so native App conversations need the existing dock layout.

## Repair

The native shell translates existing App commands and consumes private Host
replies. Wry serves each App's assets and backend through its own App origin.
Host remains the sole owner of installation, grants and backend lifetime.
Library and sidebar entry points now open the same retained native panel.
Recovery waits for catalog success or failure, just as Electron does. Both SDK
context and engine theme update, including `prefers-color-scheme`. Inactive or
covered panels hide; closed, disabled or removed panels release their handles.

Verification and remaining boundaries: [Native Apps](../fitness/native-apps.md).

## Verification — 2026-10-31

The final visible build opens Insights from the sidebar without the unavailable
banner (`test-results/native-apps/insights-sidebar-fixed.png`). The native App
suite also saves a real App checkpoint through Host, restarts the same profile,
and loads the App through startup recovery without an explicit open command.
Both runs pass the real Python evaluation and teardown checks. Native shipping
compilation, 43 UI tests, Wasm compilation and `npm run check` pass. App/model and
platform limits remain separately listed in the verification record.
