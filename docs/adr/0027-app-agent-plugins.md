# App Agent Plugins and local dependencies

Status: implemented, 2026-11-02. Reference: Point's App declarations and
`requiresAgentPlugins` semantics; no Point code or runtime dependency is added.

## Concepts and owners

- `AppAgentPlugin` is an App's instructions, selected existing write routes and
  call budget. `contributes.agentPlugin` uses `pero.app-agent-plugin.v1`.
- `AgentPluginDefinition` is an independently installed local package with
  instructions, Skills and ACP MCP server declarations. `requiresAgentPlugins`
  names the packages an App needs.
- `AppPluginAssembly` is the frozen App declaration for one ACP connection.
  The Host owns the connection, approvals, cancellation and journal. The existing
  shared App Use adapter enforces the assembly's write allowlist and call count.

These are values and package ownership boundaries, not a second plugin runtime.
The implementation does not load Go/JS plugin modules, run setup scripts, create
another Agent loop, or depend on a Point checkout.

## Installation and dependency resolution

The profile's `agent-plugins/<name>` directory owns each installed package and
its enabled flag. Explicit Host `apps` actions `plugininstall`, `pluginlist` and
`pluginenable` manage these packages. Local executable packages have the same
trust requirement as App backends; installation does not provide a sandbox.

An App may bundle missing dependencies under `agent-plugins/<name>/plugin.json`.
Enable/preparation installs missing identities there, or uses an existing
profile package. Existing versions and disabled choices are preserved. Missing
or disabled dependencies fail with a recovery message; the App is not newly
enabled. Dependencies are checked again when creating an App conversation.
Automatic bundled App discovery retains its existing lazy preparation behavior.

No network marketplace, version solver, package update mechanism, transitive
dependency graph or arbitrary install command is introduced.

## Session assembly

Both shared App Chat and App-initiated Host sessions resolve their installed App
and declared panel before starting ACP. Only that connection receives the
dependency MCP servers, frozen Skill contents and App instructions. Duplicate
MCP names, including reserved Host names, are rejected instead of replacing
operator configuration. A declaration with App tools requires the existing
Desktop App Use endpoint and an Agent advertising MCP HTTP support.

`session_created` records the App declaration digest and dependency package
digests, without MCP credentials. Instructions are added to ACP prompt content;
they do not grant permissions. The App's selected tools use the existing backend
proxy, parameter validation and calling Agent's approval policy. Existing
`contributes.writes` remain discoverable in ordinary conversations.

The assembly limits App data tools to its declared routes. Aliases, generic
`app_write` and `app_describe` share the same admission and budget. Each dispatched
write consumes a call, including failed backend calls; observing/describing does
not. The budget lasts for the mounted ACP connection, across turns and cancel.
It is not a durable Run budget. An explicit new/resumed ACP connection mounts a
new assembly. UI automation and separately configured MCP servers retain their
existing authority; `maxCalls` counts only the declared App data tools.

Disabling/removing the App or disabling a dependency closes dependent live
connections. Closing a connection releases the existing ACP-owned MCP clients.
Replay is history and cannot remount capabilities. A changed App declaration,
even at the same version, invalidates mounted write routes. Plugin package
updates and live reload are outside this implementation.

See [authoring](../../apps/README.md#agent-plugins) and
[verification](../fitness/app-agent-plugins.md).
