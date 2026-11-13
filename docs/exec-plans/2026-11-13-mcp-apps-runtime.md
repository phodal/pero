---
kind: progress_note
date: 2026-11-13
---

# MCP Apps reusable runtime and product adoption

This is the current implementation record for the requested MCP UI SDK. The
earlier MCP management work established the Host/session transport; this work
reuses it instead of introducing another MCP connection or authorization owner.

## Named concepts and migration

| Concept | Owner / change | Behavior preserved |
| --- | --- | --- |
| MCP App resource | Tool metadata + existing Host resolver | Same server, exact URI, standard MIME, validated CSP |
| MCP App surface | `@pero/mcp-apps` | Official AppBridge, initial input/result, bound operations, revoke-before-teardown |
| View lifecycle | Move `web/src/mcp/lifecycle.ts` into SDK | Hung teardown never delays revocation; existing chain test imports the new owner |
| Notebook Inspector | `apps/notebook/mcp/inspector.tsx` | Saved identity/revision, text fallback, partial index/chunk reads, scientific status |
| Saved read authority | Existing `AppUse` | Selected open conversation may inspect; writes still require a running turn |
| Product assembly | Desktop, Product and Native connector composition roots | Same backend route and policy; self-contained HTML travels with built assets |

The existing panel consumes the extracted runtime. It hides its developer input
form while an App is open, keeps an explicit Close action and restores the form
after dismissal. The Inspector uses public Button, Badge, Feedback, Table and
Disclosure controls and generated token CSS. No page-specific control skin or
generated token edit is introduced. Its theme receives live standard Host context.

## Delivered v0

- [x] Reusable Host renderer/callback seam and lifecycle API.
- [x] Existing session registry/resolver/sandbox/approval chain retained.
- [x] Standard Notebook Tool + Resource + structured result integration.
- [x] Real Notebook revision and block reading in isolated browser frames.
- [x] Compile/build, policy regressions and existing real Host/ACP/MCP chain.
- [x] Record observed surfaces and remaining scope in [verification](../fitness/mcp-apps.md).

## Follow-ups, not v0 acceptance claims

- Agent result → automatic inline surface with original tool-call identity and
  result, without executing the initial tool a second time.
- Stable Task/Run/Artifact binding and cross-restart reopening without remounting
  expired authority or replaying effects.
- Event-driven refresh and declared panel/fullscreen modes.
- A writable, Host-approved business Inspector and Data/CI consumers.
- Portable developer templates and external Host compatibility matrix; public
  package publication remains separate from this private workspace package.

Do not mark the full P1/P2 roadmap accepted from v0's renderer or fixture tests.

## Review correction: official example and conversation surface

The official Vanilla JS package, pinned at 2.0.4 and checked against its npm
integrity, is now the primary interoperability example. Its HTML and server are
not rewritten. A real Rust Host/Go ACP acceptance checks initial result, an
interactive call with `ask` approval, isolation, themes and teardown, without
model requests.

The old plain HTML controls/sidebar are replaced by public AppBar, Select,
Button, Field, Feedback and Disclosure controls. While a view is open only its
scope and Close action surround the upstream HTML. No new AppCatalog entry is
created. Notebook remains an optional business example, not the compatibility
reference. Lifecycle and pagination fixes are included in these actual consumers.

[Zed research and the conversation integration seam](../design-docs/mcp-apps-conversation.md)
distinguish its proposal from shipped code and explicitly preserve the original
tool-call result when future inline mounting is implemented.
