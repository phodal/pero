# Pero connectors

Host-owned connection management, portable MCP sessions and the provider catalog
used by the Connectors App. The renderer receives derived views and safe errors;
it does not receive native service credentials, OAuth tokens or launch authority.

The domain, request controller, portable protocol and provider drivers originate
from [Point](https://github.com/phodal/point), revision
`b45190a3db725953128b4a8a40e95a287aa9bfd7`, primarily
`packages/mcp/mcp-service/src` and `browser/src/mcp-settings-controller.mjs`.
The standalone Rust worker is in `use/connectors/worker`. This is a source port;
building or running Pero does not read a sibling Point checkout.

Pero supplies the composition root: encrypted Desktop credential storage,
App permission admission, ACP transport binding, build and process cleanup.
Messaging channel delivery and the macOS Point XPC service are separate systems
and are not installed by this package. Provider catalog entries retain their
original launch gates and prerequisites.

The imported catalog is split into catalog validation/lookup and builtin provider
definitions. The worker separates the connection-owned State implementation
from framing and input admission. Both retain the original transition semantics.
