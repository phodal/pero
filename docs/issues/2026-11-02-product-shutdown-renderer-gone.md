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

## 2026-11-03 CI diagnosis and fix

CI run 41572111927, app-use job 125709957409, reproduced this same shutdown
failure. Artifact 13201983426 records all 11 functional checks with no renderer
errors before cleanup. The window closed at 03:36:17.429 UTC; a late Host readline
callback threw `Object has been destroyed` at 03:36:17.438. Normal Electron close
then hit its unchanged 30-second deadline. The independent CI wrapper did not
time out.

Product now guards all renderer dispatch at the common send boundary, including
Host context/session events and App Use/Computer callbacks. Normal quit closes
Host stdin and awaits the owned ChildProcess `close` event, which follows both
process exit and stdio closure. Repeated quit requests cannot bypass this drain.
No force-exit success path, wider deadline or swallowed dispatch error is added.

The non-GUI Product main-entry regression fails against the previous code and
passes with this fix: live events still arrive, late events after either window
or renderer destruction do not access Electron objects, and repeated quit stays
blocked until Host stdio closes. This is a shell-port regression, not native
Electron certification. The existing app-use CI acceptance must still confirm
normal process exit without SIGKILL; keep this issue open until that evidence.
