# ADR 0025: Connectors as a Host-backed App

Status: Accepted, 2026-10-31

## Context

Point's Connectors surface combines a provider directory, configuration/import,
credential references, OAuth, connection probes, explicit tool grants and
managed runtime preparation. Its Connectors and messaging Channels are separate
surfaces. Moving just the React page would leave its native management calls
unimplemented in Pero.

The inspected Point revision is `b45190a3db725953128b4a8a40e95a287aa9bfd7`.
Its directory contains 120 definitions: three configuration templates and 117
visible providers, including seven messaging Channels. Pero's Connectors App
exposes the same 110 non-channel providers. Thirteen are documentation-only
entries with retained launch gates. These counts describe metadata, not live
provider acceptance.

## Decision

Keep presentation in `apps/connectors`, using the existing App iframe, SDK
theme/locale and shared chat composer. Reuse the Point feature UI and its pure
editor transitions. Local Dialog/Menu composition supplies browser focus and
keyboard behavior where the SDK has no matching primitive.

`packages/connectors` owns the ported connector domain and trusted management
composition. Electron Main supplies encrypted credential storage, fixed URL
opening, executable/helper locations and the enabled App's `connectors` grant.
`/host/connectors` is a privileged App route, admitted by Rust `AppStore`; it is
not an Agent tool. Credentials never enter the App projection. The OS protection
seam fails closed when encryption is unavailable, including Linux `basic_text`.

`use/connectors/worker` compiles an independent portable Rust MCP worker from
local source and Cargo.lock. It owns protocol connections and child process
lifetime. stdio definitions pin executables/files; credential fields use secret
references. Ordinary launch settings remain text. The worker supports stdio,
HTTP and the ported GitHub/GitLab/Linear/Gmail/Microsoft 365 drivers. Fixed
Feishu/science helpers are bundled from Pero source. Point XPC, identity and
messaging delivery are not dependencies.

Rust Host adds a reserved `pero-connectors` MCP endpoint to new ACP sessions.
Desktop admits actual `session_created` identities and freezes the connector
configuration for each conversation. Each gets a derived token; the master key
is blanked in the inherited Agent environment. The endpoint exposes only
`connectors_list` and `connectors_call`. Configuration, credentials, install and
permission mutation stay outside MCP. Calls still follow the existing Agent
conversation permission policy; there is no second approval queue.

Configuration or credential changes fence old snapshots. A cancelled or retired
connection is not reopened to replay an uncertain operation. A new conversation
receives a fresh snapshot. Session close/delete and Desktop shutdown retire
owned clients and join cleanup. The ported manager remains the single owner of
connect/probe/OAuth transitions; no Automation scheduler or task store is added.

## Compatibility and limits

- Existing per-Agent MCP settings remain direct, user-managed ACP grants. They
  do not become another store for this catalog. Operator servers are preserved;
  the Host endpoint name is reserved against collisions.
- Internal `point.*` IDs and helper environment names retain configuration
  compatibility. Display copy uses Pero.
- This delivery wires the **Workbench App**. Standalone App Product shells do
  not yet compose the Connectors authority.
- The portable owner is enabled on macOS/Linux. Windows returns an explicit
  unsupported-platform result without blocking Desktop startup. Windows owned
  process cleanup is not implemented by this port.
- Feishu account tools and consent are included. Point's separate document
  publication, meeting watches, messaging Channels and Factory workflows are
  outside the Connectors management surface and are not recreated here.

Verification and live-provider/package gaps are recorded in
[Connectors verification](../fitness/connectors.md).
