---
kind: issue
status: resolved
date: 2026-11-24
updated: 2026-11-24
---

# Native Chrome connection waits for a manual pairing action after launch

After starting Pero Native with an ordinary conversation selected, Browser Use
can report `chrome.state: "notPaired"` until the user opens the titlebar Chrome
menu and pairs again. The menu also places connection management in the main
conversation toolbar even though Browser Use already has a Settings page.

The Native shell currently requests a Relay pairing ticket only from a manual
button. It does not check the selected conversation's Relay status during
startup. The selected conversation should trigger one automatic status check
and, when disconnected, open the existing Chrome extension pairing flow.
Settings should display the current connection state and own pairing,
disconnection, site rules and diagnostic mode controls. Individual tab and
site approvals remain explicit.

Acceptance: restart Native with the extension installed and an ordinary
conversation selected; observe connection without clicking the old titlebar
menu. Check that the Settings state changes from waiting to connected, that
the titlebar has no Chrome management action, and that tab access still
requires its existing approval. Repeat after disconnecting from either side.

The 2026-11-24 debug Native Preview used `/private/tmp/pero-chrome-settings-review`
and the installed Pero extension in Google Chrome. With no manual pairing
action, Settings displayed **Chrome 已连接到当前会话**. The ordinary conversation
titlebar had no Chrome action. **断开 Chrome** changed the status to
**Chrome 已断开**; restarting the preview with the same data directory
automatically restored **Chrome 已连接到当前会话**. The existing tab and site
approval implementation was not changed; this run did not repeat a real tab
action or inspect the extension's internal page.
The automatic connection opened a Chrome window during launch and could leave
it showing an unavailable pairing ticket. Native now reads the selected
conversation’s connection status during startup and after selection changes.
Pairing begins with an explicit action, such as **Pair in Chrome** in Settings.
The extension handles the ticket in the opened Chrome tab. See the updated
[Native startup verification](../fitness/browser-use.md#native-startup-and-explicit-pairing).
