---
kind: verification_report
date: 2026-10-29
---

# MCP 工具与资源 acceptance

ROADMAP item 「MCP 工具与资源」 stays unchecked. Acceptance is stdio and
Streamable HTTP discover and call, a resource list that updates after a change,
and tool list updates. This note records L0 evidence against `master`
`11cc28c`. It does not mark the item complete.

## Tool list updates

`notifications/tools/list_changed` has a harness contract in
[phodal/pero#16](https://github.com/phodal/pero/pull/16):
`TestMCPToolListChangedUpdatesRegisteredTools`. The test mounts an in-memory
server and requires add, remove, and description replacement to refresh the
agent-visible tool generation. That contract was merged in #16, and it
leaves this ROADMAP checkbox open.

## Streamable HTTP on master

`master` already exercises Streamable HTTP:

- `TestCodingModelCLICombinedActivationWire` attaches a loopback Streamable
  HTTP server at `session/new` and requires `remote_probe` in the provider
  tool list.
- `TestNativeApprovalMetadataWireAuthority` (`mcp_spoof`) performs one
  Streamable HTTP tool call after allow-once, and rejects native-approval
  metadata supplied by that server.
- `TestMCPHTTPRedirectDoesNotForwardConfiguredCredentials`,
  `TestMCPHTTPAuthenticationIsTerminalAndDiagnosticsAreRedacted`, and
  `TestMCPHTTPTransientFailureStillReconnectsWithoutLeakingBody` cover
  credential redirects, terminal authentication, and reconnect.

`TestMCPCanonicalOutput` exercises `tools/list` and `tools/call` through an
in-memory transport.

## Open follow-ups

- A stdio fixture that discovers and calls a tool.
- Resource list refresh after a change (`notifications/resources/list_changed`).
  Resource read and list helpers exist. No list-changed refresh contract is
  on `master`, including the contract merged in #16.
