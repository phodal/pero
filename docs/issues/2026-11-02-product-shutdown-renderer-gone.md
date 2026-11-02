---
kind: issue
status: open
date: 2026-11-02
---

# Product forwards Host events after its window is destroyed

The visible macOS Electron App-shell plugin approval check completed both real
`deepseek-flash` turns: clicking Allow once saved one observation, and clicking
Reject returned a failed tool result without another write. Closing this test
Product then displayed an uncaught `TypeError: Object has been destroyed`.

The stack points at the bundled Product's Host readline handler. In
`desktop/src/main/product.ts`, ordinary forwarded `product:event` and context
messages access `window.webContents` without the destroyed-window check already
used by the runtime-stopped callback. Late session/MCP events during shutdown
can arrive after the renderer window has gone.

Evidence: `test-results/app-plugin-desktop/shutdown-error.png`; the approval
screenshots, Host snapshots and saved-record receipts are in the same directory.
The error was observed after the successful approval results. This check does
not certify clean Product shutdown. Production behavior was not changed by the
approval verification task.

Acceptance for a separate fix: close the real Product with live/idle Host
sessions, drain its owned processes and observe no renderer access after window
destruction or uncaught-error dialog. Preserve normal event forwarding while
the window is live.
