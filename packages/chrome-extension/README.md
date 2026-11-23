# Pero Browser Use for Chrome

In Native, use **Settings → Browser Use → Prepare extension folder**. From a source checkout, you can also run `node scripts/build/chrome-extension.mjs "$HOME/.pero/chrome-extension"`. In
Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load
unpacked**, and choose `~/.pero/chrome-extension`. Pin **Pero Browser Use** so
you can open it from the toolbar. Upgrade the Workbench and extension together
for Relay protocol 2.

1. Select an ordinary conversation in Pero Native. Open **Settings → Browser
   Use → Pair in Chrome**. Chrome opens the extension and pairs automatically.
2. In Electron, use **Workbench → Copy Chrome pairing code**. In the extension,
   expand **Enter a pairing code manually**, paste the code and select **Pair
   with Pero**. Each code expires after two minutes and can be used once.
3. Choose the Chrome tab, select **Review tab** and verify its title and
   URL. Select **Allow this tab**. Repeat for each tab you want to share with
   the same conversation. The Agent can list those tabs with `browser_use`
   and use their `chrome:` IDs. Page input and capture require the tab to
   be active in its Chrome window.
4. Select **Stop and take over** in Chrome or **Disconnect Chrome** in Pero
   to end access to all tabs. Closing a tab or leaving its approved origin
   ends that tab’s grant.

Chrome Relay supports observation, locators, waits, same-origin frames,
forms, keyboard, mouse and scroll. Use `tabs`, `open`, `activate` and
`closeTab` to work with multiple tabs. A tab opened by the Agent requires
its own approval. `navigate`, `back`, `forward` and `reload` stay within
the approved origin.

`screenshot` returns a viewport PNG or pixel crop and requires every frame
to have the approved origin. `files` and `upload` send frozen conversation
attachments to an observed input. `download` saves an observed same-origin
HTTP(S) or Blob link to conversation Artifacts. Download links are limited
to 10 MiB and must serve the file directly. In a Native Python REPL, use
`cua.emit_image(await cua.browser({"action": "screenshot", "tabId": tab_id}))`
to return the image to the Agent.

The reviewed-tab flow and Relay lifecycle are adapted from Point
`2449d4b98b38a8839ce741fd1039af201e63d6a7`. The Pero extension connects to the
local Workbench over loopback. Pero owns the selected conversation, the
authorization and the existing Browser Use receipts.

## Native chat and Collector

Click the pinned Pero icon to open the conversation in the Chrome side panel.
The message history, attachments, stop action and approvals use the paired
Native chat. Open **More → Open in Pero** to review an Agent approval. History
and New chat select a Native conversation in the current workspace. A new
pairing starts with an empty set of tab grants.

Use **More → Collector** on an active, approved page. Choose page text or
selected text, read and edit the preview, and optionally add a reason and a
question. **Save to conversation** writes the reviewed Markdown, including its
source URL, to that conversation’s Artifacts. The chat and Collector surfaces
adapt Point’s extension at revision `16e092464404c7a1e6d78a6a9bbed6920c785976`.
In a Native chat, select the `pero-browser-use` skill for the external Chrome
workflow and Python REPL examples.
