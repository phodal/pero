---
kind: issue
status: open
date: 2026-11-24
updated: 2026-11-24
---

# Native Browser Use can select a popup whose WebKit view stays hidden

The Native Browser Use fixture opens a same-origin popup from a visible Web
tab. The new tab becomes the active Workbench document and reports
`WebLoad::Ready`, but its attached WebKit view can remain hidden. The next ACP
turn waits for the page to become operable and times out.

Reproduced in a clean worktree at `15b49f64f` with the development Native
build and the loopback `tests/e2e/native-browser-use.mjs` fixture. The
Workbench reported its embedded surface visible and no modal open. The
active page reported its view hidden and its containing native window visible.
