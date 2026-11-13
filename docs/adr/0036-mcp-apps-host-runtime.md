# MCP Apps Host Runtime and saved Notebook Inspector

Status: draft PR for v0, 2026-11-13.

## Decision

Keep MCP Apps as the protocol and extract the existing official AppBridge
renderer/lifecycle into `@pero/mcp-apps`. Host adapters own connection discovery,
resource resolution, bindings, approval and execution. Views use the standard
`App` API. Existing Agent Plugin packages continue to declare MCP servers and
Skills; a second plugin manager or manifest protocol is unnecessary.

The repository already pins `ext-apps` 1.7.5 and MCP SDK 1.32.2. Use those tested
versions. Upstream also offers `@mcp-ui/client`'s React `AppRenderer`; our existing
GPUI/Web Host already uses the official AppBridge, so adding another
renderer is unnecessary for this implementation. The adapter seam permits
replacing that rendering implementation later without moving permissions.

The standard resource link is `_meta.ui.resourceUri` on the Tool definition.
Tool results preserve ordinary `content` and provide `structuredContent` for
the view. A Host without MCP Apps continues using the same tool. Sources:
[official SDK](https://github.com/modelcontextprotocol/ext-apps),
[MCP UI host components](https://github.com/MCP-UI-Org/mcp-ui).

## Official compatibility example and conversation direction

The primary acceptance example is the published, unchanged
`@modelcontextprotocol/server-basic-vanillajs@2.0.4`, including its real UI
resource. It runs through Rust Host, Go ACP and the managed session panel;
initial and interactive calls both pass the saved `ask` policy. A conversation
tool row automatically adopts the original input/result and resource without
executing the initial tool again. Text `ui/message` enters the existing Host
prompt owner and receives an acknowledgement without conversation contents. Notebook remains
a secondary saved-content example. No new installed MCP Apps application is
registered.

[Zed #58470](https://github.com/zed-industries/zed/discussions/58470) proposes
this conversation-first ownership, but its current production code is not an
MCP Apps renderer. The exact code comparison and next timeline seam are in
[the conversation design](../design-docs/mcp-apps-conversation.md).

## Notebook example and authority

`app__notebook__read-entry` links to `ui://pero/notebook/inspector-v1`. Its resource
is a self-contained React view built with the public App SDK controls/tokens.
The existing App Use adapter advertises/serves it only while the declared
Notebook route is available. The resource is versioned independently of the
saved content. Entry identity, saved revision, chunking and validation remain
owned by Notebook's existing `/api/agent-read` route.

The `saved-read` access mode permits this exact existing read route while the
selected Host conversation is open, including between Agent turns. It neither
starts a model nor grants an idle write. Closing/deleting the session, switching
selection, disabling the App or changing a mounted declaration removes access.
Replayed inactive history cannot create a live read authority. Other App data
tools retain the existing running-turn rule. Host tool-policy checks continue
to precede calls made by an MCP App in a managed session.

Sandbox CSP, independent origins, visibility checks, server generation checks
and binding revocation remain in the existing provider. The extracted runtime
receives bound callback ports, not raw connector clients or credentials.

## Explicit limits

The tools/resources menu supports explicit exploration alongside automatic
conversation rendering. Views retain original tool-call identity when collapsed
or reopened. The runtime does not persist MCP bindings across process restarts,
replay tool calls, or implement `ui/update-model-context`, non-text `ui/message`,
Run/Artifact identity, event subscriptions, approval editors, cross-plugin
orchestration, panel/fullscreen negotiation, or Data/CI inspectors. Those require
their actual owners and separate product acceptance. Runtime support is not a
claim of compatibility with every third-party Host or server.

The migration, verification and follow-ups are tracked in the
[implementation record](../exec-plans/2026-11-13-mcp-apps-runtime.md).
