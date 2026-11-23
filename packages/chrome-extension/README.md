# Pero Browser Use for Chrome

From the repository root, run `node scripts/build/chrome-extension.mjs`. In
Chrome, open `chrome://extensions`, enable **Developer mode**, select **Load
unpacked**, and choose `target/chrome-extension`. Pin **Pero Browser Use** so
you can open it from the toolbar.

1. Select an ordinary conversation in Pero. In Native, open the conversation
   toolbar’s **Chrome** menu. In Electron, open **Workbench**. Select **Copy
   Chrome pairing code**.
2. Open the Chrome extension, paste the code and select **Pair with Pero**.
   The code is valid for two minutes and can be used once.
3. Select **Review a tab**, choose the Chrome tab and verify its title and
   URL. Select **Allow this tab**. Keep the authorized tab active in its
   Chrome window. The Agent can list it with `browser_use` and use its
   `chrome:` tab ID for subsequent calls.
4. Select **Stop and take over** in Chrome or **Disconnect Chrome** in Pero
   to end access. Closing the tab or navigating to another origin also ends
   access. Pair and approve again to use another tab.

Chrome Relay supports observation, locators, waits, same-origin frames,
forms, keyboard, mouse and scroll. Chrome’s own controls handle tab and
history navigation. Screenshots and file transfer through `browser_use` are
available through the corresponding embedded browser implementations.

The reviewed-tab flow and Relay lifecycle are adapted from Point
`2449d4b98b38a8839ce741fd1039af201e63d6a7`. The Pero extension connects to the
local Workbench over loopback. Pero owns the selected conversation, the
authorization and the existing Browser Use receipts.
