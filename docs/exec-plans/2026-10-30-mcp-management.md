# MCP management and Harness integration

Tracking: [#50](https://github.com/phodal/pero/issues/50). First slice starts at
`c5e5ac3ad20939f896fe29701fd1c432a0ab6213`. This document tracks implementation;
unchecked acceptance is not a capability claim.

## Ownership

GPUI presents configuration. Rust Host owns persisted settings and resolves the
selected local Agent's configuration. ACP transfers that configuration to the
Agent, which alone owns its MCP connections. The existing Go Harness already
implements MCP transports, tool generations and resource queries. Settings must
not start another MCP client to manufacture a connection-status indicator.

Zed's ContextServerStore/tool adapter split and Point's revisioned connector
settings informed this design. No Zed Agent/UI source is copied. Point's managed
connector security properties must not be attributed to its separate direct Go
MCP path or to Pero without corresponding implementation and tests.

## First slice

- Per-local-Agent user-managed server configuration, separate from operator
  configuration and the internal App Use endpoint.
- Typed revisioned get/set contracts. Atomic replacement supports add, edit,
  enable, disable and removal without inventing another scheduler.
- Explicit absolute stdio executable/arguments or HTTP URL. New entries are
  disabled. Enable is an explicit server-level grant under current Harness
  semantics; this slice does not offer unenforced per-tool controls.
- Non-sensitive configuration only. No environment/header credential fields or
  raw secret import. No plaintext fallback in the absence of an integrated
  secure credential resolver. HTTP userinfo/query/fragment are outside this
  first slice; arbitrary arguments are not automatically certified secret-free.
- Changes apply to newly created sessions, not already-running connections.
  Resume behavior must be explicit and preserve the existing ACP requirements.
- The UI reports configuration, not observed connection health. External Agents
  without an inspection capability cannot be represented as connected.
- Local scope only: no implicit copying of paths, commands or credentials to a
  Worker or Kubernetes runtime.

## Subsequent slices

1. Negotiated Pero Harness status/catalog observations, enforcing allow/ask/deny
   at tool execution as well as catalog projection. Server annotations do not
   confer trust. Reconnect does not replay side-effectful calls.
2. Resource selection and bounded Chat attachment, followed by isolated MCP Apps
   rendering through an explicit AppBridge. App iframes never receive connector
   management or credential access.

Issue #15 was closed as `not_planned` on 2026-10-30; that closure is not evidence
of complete transport/tool-refresh/resource-query acceptance. Resource queries
currently fetch on demand; a notification-driven cache is not a prerequisite for
correctness. Issue #9 remains separate memory work.

## First-slice acceptance

- [x] Domain validation, revisions, disabled defaults, duplicate names and
      operator/internal-name collisions.
- [x] Host persistence and new-session ACP injection; existing sessions unchanged.
- [x] Import rejects unsupported fields rather than silently dropping authority.
- [x] No operator credentials in settings snapshots, errors or history.
- [ ] Actual Electron add/edit/enable/disable/remove and recovery flow, keyboard,
      light/dark and narrow window, with screenshots and fixture evidence.
- [ ] Final contract/type/locale checks and Rust tests, plus exact-head CI.

All acceptance uses synthetic fixtures. No paid model requests, real credentials,
production server setup, OAuth grant, automatic package install or deployment is
required. Protocol versions supported by the existing SDK and App Use endpoint
are distinct; this work does not certify MCP 2026-07-28 conformance.

## Verification checkpoint

The actual sandboxed headless Electron suite passed all twelve recorded groups
with no renderer errors. It exercises both Settings search and direct-menu entry.
Headed CI remains pending; screenshots/results must be associated with the exact
final source. See the resolved [renderer incident](../issues/2026-10-30-mcp-settings-renderer.md)
for the reproduced debug-Wasm stack failure and its correction. This is only the
first local configuration slice, not completion of all issue #50 stages.

## Master integration

Master `d03ddef` adds its own source-view MCP Apps provider, reader panes and icon
theme settings. Preserve those implementations: root Host `mcp.rs` owns the Apps
provider and `mcp-servers.json`; `mcp_settings.rs` extends the existing Agent
manager with per-Agent `local_mcp` preferences. Neither store grants authority to
the other. The settings slice does not migrate credentials or automatically
connect Apps when an Agent server is enabled. Reuse the existing Apps host for
later integration rather than introducing another one.

The merged protocol retains both request/event families; Settings retains icons,
focus recovery and MCP. Combined acceptance includes both UI flows and real
Host/provider route/store separation. See the [integration record](../issues/2026-10-30-mcp-master-integration.md).
