# Pero Browser Use for Chrome

In Native, use **Settings → Browser Use → Prepare extension folder**. From a source checkout, you can also run `node scripts/build/chrome-extension.mjs "$HOME/.pero/chrome-extension"`. In
Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load
unpacked**, and choose `~/.pero/chrome-extension`. Pin **Pero Browser Use** so
you can open it from the toolbar. Upgrade the Workbench and extension together
for Relay protocol 3.

1. Select an ordinary conversation in Pero. Open **Settings → Browser
   Use → Pair in Chrome**. Chrome opens the extension and pairs automatically.
2. In Electron, use **Workbench → Copy Chrome pairing code**. In the extension,
   expand **Enter a pairing code manually**, paste the code and select **Pair
   with Pero**. Each code expires after two minutes and can be used once.
3. The paired conversation can list regular HTTP(S) tabs in this Chrome
   profile using `browser_use`. Select or activate a tab and approve the site
   in Pero before the conversation reads or acts on its page. Chrome attaches
   its debugger on the first approved page operation that needs it.
4. Select **Stop and take over** in Chrome or **Disconnect Chrome** in Pero
   to end access to all tabs. Chrome's debugger Cancel control also ends
   the connection. Tabs stay open.

The site prompt offers one-turn approval, persistent approval, decline for
the current turn, and persistent block. Saved decisions apply to the exact
origin in the current Workbench profile. Open **Chrome site permissions** in
the Workbench menu or Native Browser Use settings to see or clear saved
decisions. To release one tab, use `handoff` with its `chrome:` ID.

With extension 0.3.7 or newer, enable **Browser Developer Mode** in the
Workbench or Native Chrome menu to use `diagnose` on the active paired tab.
Approve each capture in Pero to share console output, runtime errors,
network timing, computed styles and performance metrics with the conversation.
Extension 0.3.8 also exposes `getAXState` under the usual tab and site
permissions. Pass the previous `snapshotId` as `since` to receive AX changes.
Pass `background: true` with an explicit `chrome:` tab ID to read or act on
an inactive tab without selecting it.
Extension 0.3.9 runs requests to different tabs concurrently. Await each
operation before using the same tab again.

With extension 0.3.10 or newer, **Browser Site Tools** in the Electron
Workbench menu or Native Chrome menu enables `listSiteTools` and
`callSiteTool` on an approved Chrome site.
Use its explicit `chrome:` tab ID. Chrome must expose WebMCP on the page.
Pero asks before discovering tools from partner origins and before each
invocation. Reloading the page requires listing its tools again.

The side panel shares its paired Native conversation’s draft, model selection,
`@` context suggestions and `/` commands. Use the arrow keys to navigate
suggestions and Tab to choose one. Model choices and commands come from the
active agent. **Tab screenshot** attaches a PNG of the active tab to the draft.

Chrome Relay supports observation, locators, waits, same-origin frames,
forms, keyboard, mouse and scroll. Use `tabs`, `open`, `activate` and
`closeTab` to work with multiple tabs. A new web tab is available to the same
paired conversation. Use `click` with `expectPopup: true` to get the ID of a
new web tab opened by the selected page, including tabs opened on another site.
The receipt reports `notObserved` when Chrome reports no new web tab within
five seconds. `navigate`, `back`, `forward` and `reload` stay within
the current page's origin.

`screenshot` returns a viewport PNG, pixel crop or an entire document, and
requires all frames to have the page's origin. `files` and `upload` send frozen conversation
attachments to an observed input. `download` saves an observed same-origin
HTTP(S) or Blob link to conversation Artifacts. Download links are limited
to 10 MiB and must serve the file directly. In a Native Python REPL, use
`cua.emit_image(await cua.browser({"action": "screenshot", "tabId": tab_id}))`
to return the image to the Agent.

The original Relay lifecycle was adapted from Point
`2449d4b98b38a8839ce741fd1039af201e63d6a7`. The Pero extension connects to the
local Workbench over loopback. Pero owns the selected conversation and
the Browser Use receipts.

## Native chat and Collector

Click the pinned Pero icon to open the conversation in the Chrome side panel.
The message history, attachments, stop action and approvals use the paired
Native chat. Open **More → Open in Pero** to review an Agent approval. History
and New chat select a Native conversation in the current workspace.

Use **More → Collector** on an active Chrome web page. Choose page text or
selected text, read and edit the preview, and optionally add a reason and a
question. Choose the conversation to save the reviewed Markdown to Artifacts,
or choose a local or shared Project to make it available in Materials.
If a Project save loses its confirmation, reopen Collector and pair the
original conversation, then choose **Recover save**. It resends the reviewed
excerpt under the same capture ID and Project. **Discard pending save** clears
the draft from the Chrome session while preserving any saved source. Pending
drafts live in Chrome's extension session storage until its browser session
ends. The chat and Collector surfaces
adapt Point’s extension at revision `16e092464404c7a1e6d78a6a9bbed6920c785976`.
In a Native chat, select the `pero-browser-use` skill for the external Chrome
workflow and Python REPL examples.
