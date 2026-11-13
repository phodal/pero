# Pero MCP Apps Runtime

`@pero/mcp-apps` is the reusable, framework-independent Host surface. It wraps
the official `@modelcontextprotocol/ext-apps/app-bridge`; it does not define a
second RPC protocol, own an MCP connection, or execute tools itself.

```ts
import {mountMcpApp} from '@pero/mcp-apps';

const runtime = await mountMcpApp(container, {
  title: 'Dataset', html, csp, input, result, sandbox: sandboxProxyUrl,
}, {
  callTool: (name, args) => host.callBoundTool(binding, name, args),
  readResource: uri => host.readBoundResource(binding, uri),
  openLink: url => host.openBoundLink(binding, url),
  sendMessage: text => host.submitBoundMessage(binding, text), // optional, text only
  revoke: () => host.closeBinding(binding),
  onState: state => showState(state),
  onError: error => showError(error),
}, {theme:'light', locale:'en'});

runtime.setHostContext({theme:'dark'});
await runtime.close();
```

The adapter must resolve a `ui://` resource from the same MCP server as the
declaring tool, validate its metadata before dispatch, and provide a separate
origin sandbox proxy. **Never pass credentials or management APIs into the
resource.** Tool visibility, exact binding, server generation and approval
remain Host responsibilities. The runtime does not treat tool annotations as
authorization. `close()` revokes before requesting teardown and removes the
frame even when teardown fails; initialization errors do not retry tools.

Pero's adapter is `McpSessionSources` → `McpHost` → `web/src/mcp/panel.tsx`.
It reuses the current Agent's MCP connection and tool-policy path. The existing
standalone source provider remains an explicit, separate authority.

For a plugin, keep the ordinary tool usable without UI. Declare the view on the
**tool definition**, not only the call result:

```ts
import {registerAppResource, registerAppTool, RESOURCE_MIME_TYPE}
  from '@modelcontextprotocol/ext-apps/server';

registerAppResource(server, 'inspector', 'ui://example/inspector-v1', {}, async () => ({
  contents: [{uri:'ui://example/inspector-v1', mimeType:RESOURCE_MIME_TYPE,
    text:html, _meta:{ui:{csp:{}}}}],
}));
registerAppTool(server, 'inspect', {
  inputSchema: {}, _meta:{ui:{resourceUri:'ui://example/inspector-v1'}},
}, async () => ({content:[{type:'text',text:'Saved result'}], structuredContent:result}));
```

Use the official `App` or `ext-apps/react` inside the resource; register handlers
before `connect()`. Inline all assets for the default no-network policy, or
declare required domains in resource CSP. Existing `plugin.json` MCP server and
Skill declarations remain unchanged; the package manifest is Pero-specific,
while the Tool/Resource/AppBridge wire format is standard MCP Apps.

The primary compatibility example is the **unchanged official**
`@modelcontextprotocol/server-basic-vanillajs@2.0.4`. Run the real managed-session
acceptance after building Host and Harness:

```sh
npm run test:mcp-official -- --install
```

`--install` explicitly downloads the pinned upstream package to a generated
working directory; it does not upgrade the Host SDK or install an AppCatalog
application. Later offline runs use that directory, or `PERO_OFFICIAL_MCP_ROOT`
may select an already prepared install. Its standard View, initial result and
interactive get-time call run through the same Host/ACP tool approvals.

The business example is [Notebook Inspector](../../apps/notebook/mcp/inspector.tsx).
Its saved revision and domain validation stay in Notebook. Read-only display
does not alter scientific review status. Complex scientific blocks expose their
original fields; this is a saved-content inspector, not the Notebook editor.

```sh
npm run test:mcp-apps
PERO_MCP_BROWSER=1 npm run test:mcp-apps
PERO_MCP_BROWSER=1 PERO_MCP_RENDERER=electron npm run test:mcp-apps
```

Current scope and evidence: [MCP Apps verification](../../docs/fitness/mcp-apps.md).

The [conversation design](../../docs/design-docs/mcp-apps-conversation.md) records
the Zed MCP Apps proposal and implemented tool-result ownership. Agent calls
automatically mount their recorded input/result in the conversation. Expanding
or reopening the view never executes the initial tool. Managed `ui/message`
submits text through the existing Host prompt owner and returns only an
acknowledgement. `ui/update-model-context` remains unsupported.

After building Desktop, Web/WASM, Host and Harness, verify the actual conversation:

```sh
node scripts/test/mcp-official-conversation.mjs
```

This uses the unmodified official package, real Workbench/Host/ACP and a local
deterministic model fixture. A transparent stdio audit counts actual tools/call
dispatches independently of the UI.
