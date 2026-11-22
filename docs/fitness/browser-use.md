---
kind: verification_report
date: 2026-11-22
level: local-runtime
---

# Electron Browser Use

Open an ordinary Workbench chat and an HTTP(S) Web tab. Select **Workbench →
Allow Browser Use for This Tab…**. The confirmation shows the site origin and
the live tab title. The toolbar displays **Browser Use allowed** until the
grant ends. **Workbench → Stop Browser Use** revokes it.

The grant belongs to the selected conversation, the live tab instance and its
exact origin, including the scheme and port. It applies while the tab is in a
visible workspace pane and the conversation is selected and running. Closing
the tab or conversation, cancelling from Chat, leaving the origin, or
resetting the Desktop connection revokes the grant. A different tab on the
same origin needs its own approval. The grant is in memory.

## Runtime

Point revision `2449d4b98b38a8839ce741fd1039af201e63d6a7` supplied
`browser/src/browser-dom-semantics.mjs` and the isolated-world approach from
`browser/src/browser-expanded-dom.mjs`. The adapted TypeScript is part of
Pero's Electron Desktop build. `WebPages` owns the existing
`WebContentsView`; Rust Host owns the ACP session and its approval policy.
The existing authenticated Desktop MCP connection carries `browser_use`.

The tool supports status, main-document observation, a semantic click, filling
a plain-text field and same-origin navigation. Observation issues opaque refs
to the current document. A click or fill consumes the observation. The action
rechecks the node's current identity, visibility and semantic label. Page
content is data. The tool has no browser-wide inventory, caller-provided
selectors or script execution. Observation omits nested frames and password,
file and hidden fields. Direct navigation rejects foreign origins and cancels
cross-origin HTTP redirects before the foreign site receives a request.
A navigation initiated independently by the page or the user ends the grant
if it leaves the origin.

The Desktop profile stores observation JSON and paired intent/result records
under `browser-use-evidence/`. An action receipt links the observation and
reference used, or records the navigation destination. The fill intent omits
the input text. Later page observations can include text the page itself
renders. A dispatch receipt records that the operation was delivered, and a
separate observation can check the page effect. Session deletion removes the
associated evidence.

## Observed on macOS

The Desktop main bundle was built from the Browser Use working-tree changes on
`0e892f6d5` in an isolated directory, using the existing Workbench renderer
and Rust Host builds. `npm run test:browser-use` ran against actual Electron
WebContentsView instances and the real Rust Host with a deterministic ACP
fixture. The confirmation response was supplied by the test. It verified
default denial, cancellation and acceptance of the confirmation, the toolbar
indicator, tab and conversation scope, stale references, a fill followed by a
click, an independent Chromium DOM read of the resulting output, same-origin
navigation and persisted observations and receipts. The other loopback
origin received zero requests from the rejected link and redirect. Explicit
revocation, user navigation to another origin and tab closure ended access.

The inspected Workbench screenshot shows the toolbar authorization state.
Electron's renderer capture does not composite the separate browser child.
`test-results/browser-use/result.json` records the functional results.
`npm run check` and `npm run test:app-use:unit` passed.
The older `web-documents.mjs` suite timed out at its coordinate-based click
back to the conversation. The same failure reproduced with an isolated
Desktop bundle built from unmodified `0e892f6d5`, using the same renderer and Host.

This verification covers the Electron Workbench development build with a
fixture Agent. Native Wry, remote Worker, external Chrome/Relay, a real model
provider and packaged builds remain outside this implementation or verification.
