---
kind: verification_report
date: 2026-11-01
---

# Managed MCP runtime observations (#50, bounded phase two)

The existing Go MCP supervisor remains the sole connection owner. Its transient
callback reports connection generation, lifecycle status and discovered tool
names only after registry replacement. No second MCP process, probe, scheduler,
permission implementation or resource cache was added.

ACP clients opt in with `clientCapabilities._meta["pero.mcpRuntime"] = 1`.
The Agent responds with the same version in `agentCapabilities._meta`.
`session/new` and `session/load` carry `_meta["pero.mcpRuntime"].revision`;
`_pero/mcp/runtime` notifications carry `sessionId`, `revision`, `server`,
`generation`, `status` and `tools`. Unsupported Agents remain explicitly
unobservable, including when unsolicited notifications arrive.

The Rust session owns the transient projection and freezes its managed server
identities and configuration revision. Initial notifications are bounded until
the actual ACP session ID returns. Wrong session/revision/server and stale
connection generations are ignored. Closure clears catalogs and cannot be
revived. A Host-process-local handle incarnation also prevents delayed cleanup
from an old handle overwriting a replacement that reuses the same thread ID.
Pre-ID startup failure, timeout and cancellation also publish an explicit closed
projection after the existing error/closed lifecycle events. The renderer uses a
tested presentation selector so a closed snapshot with no ACP ID or servers
cannot remain labeled Connecting. Unnegotiated active Agents remain unobservable.
Host settings reads that same session-owned projection; it does not
persist observations to session history or maintain a second connection state.
The UI separates saved configuration from session snapshots and identifies
older revisions. Settings responses cannot overwrite newer live observations
received during the request. Operator/App Use connections are not exposed as
user-managed connector entries.

Catalogs are bounded to 256 names of at most 128 UTF-8 bytes each, without
control characters. Transport URLs, arguments, env, headers, schemas,
descriptions and raw errors are not observation fields. These limits affect
presentation only and do not introduce authorization or alter tool execution.
An oversized/invalid catalog reports a generic observation error rather than
claiming a complete truncated catalog.

## Verification boundaries

L0 local checks use the existing Go 1.27.3 and Rust toolchain caches, loopback
HTTP and disposable stdio fixtures. No model request or private credentials are
needed. Core tests cover stale generations and terminal cleanup; ACP fixtures
cover negotiation, exact configured identity, revision admission, HTTP catalog
refresh/resume and stdio child-exit/no-duplicate startup receipts. Rust tests
cover pre-response notifications, wrong session/revision/generation and
unnegotiated external Agents. Existing Host contracts cover frozen old/new
session configuration and secret exclusion. Native GPUI type checking and
standalone Host JSON schema checks are separate from graphical acceptance.

The existing Desktop MCP settings suite includes session/revision/unobservable
checks and synthetic Host-event status/catalog presentation. Those injected UI
events do not constitute MCP transport evidence. Actual Electron screenshots,
Wasm execution, external-provider interoperability and signed packages must be
reported separately by CI; local source checks do not establish L1/L2/L3.

## Protocol support and remaining scope

- Go MCP SDK remains `github.com/modelcontextprotocol/go-sdk v1.7.0`; existing
  stdio and Streamable HTTP implementations are reused unchanged.
- ACP remains protocol v1 through Rust `agent-client-protocol = 3.5.0`.
- `pero.mcpRuntime` v1 is an explicit Pero observation extension, not a claim
  of MCP 2026-07-28 compatibility or support by external ACP Agents.
- Per-tool allow/ask/deny, Chat approval policy, resources, MCP Apps unification,
  OAuth, remote deployment and hot configuration replacement remain outside
  this change. Issue #50 stays open.
