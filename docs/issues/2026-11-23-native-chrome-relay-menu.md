---
kind: issue
status: resolved
date: 2026-11-23
updated: 2026-11-23
---

# Chrome pairing is missing from Native’s conversation view

In the macOS Native Preview, start an ordinary conversation with no content
tabs open. The Chrome menu is absent even after the Agent has started. A user
working entirely in external Chrome needs to pair and disconnect from this
view without opening a separate workspace tab.

The action was attached to a content tab strip that is skipped in the
conversation view. The main window header now owns the action and exposes it
when the Native connector and a selected ordinary conversation are available.
The menu continues to use the existing pairing and disconnect handlers.

Verified on macOS 27.2.1 in the release-mode Native Preview and Google Chrome
for Testing 156.0.8078.4. Starting from the conversation view, the Native menu
copied the code, the extension approved two tabs independently, and access
ended after revocation from either app. The test used the real Rust Host, a
deterministic ACP Agent and an isolated Chrome profile. See the
[Browser Use verification](../fitness/browser-use.md#native-workbench-and-external-chrome).

The Native settings window now exposes **Browser Use** even when no content tab
is open. **Prepare extension folder** opens the unpacked distribution under
`~/.pero/chrome-extension`. **Pair in Chrome** opens the installed extension
with a single-use ticket for the ordinary conversation selected in Pero.
The toolbar uses the same action. The extension removes the ticket from its
address, then asks the user to review and approve each tab. The toolbar icon
opens the Relay in Chrome’s side panel.

A headed Chrome for Testing run exercised the automatic handoff, denial before
approval, a trusted page click, and revocation from both ends. The macOS Native
preview opened the settings page, prepared the folder in Finder, and launched
the installed extension in the Phodal profile of Google Chrome.
