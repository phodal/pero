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
| Original MCP App call | Go MCP dispatch → session-owned receipt → ACP descriptor | Complete original input/result; server generation and call identity; no initial tool replay |
| Conversation view | Tool row → measured frame / Native child WebView | Replaces explicit opening as default; collapse retains view, close revokes binding; no AppCatalog entry |
| View message | AppBridge → bound source → Host prompt owner | Text-only acknowledgement; ordinary queue/cancel/permission semantics; no model reply returned to iframe |

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
- [x] Agent result → automatic inline surface with the original tool-call identity/input/result, without executing the initial tool a second time.
- [x] Standard text `ui/message` routed through existing Host conversation submission.
- [x] Record observed surfaces and remaining scope in [verification](../fitness/mcp-apps.md).

## Shared SDK UI migration — 2026-11-13

The public SDK now owns the Host Surface as well as the protocol runtime.
`web/src/mcp/panel.tsx` consumes that same Surface for explicit tool opening and
the conversation's recorded-result route; catalogs and execution remain in the
adapter. The original result is a value, not an instruction to run a tool again.

| Previous owner | Shared owner | Preserved behavior |
| --- | --- | --- |
| Panel's mount/error/cleanup effect | `@pero/mcp-apps/react` `McpAppSurface` | Bound callbacks, local failure, text fallback and dismissal |
| Panel/Notebook theme assignments | `@pero/mcp-apps/theme` | Live theme/locale, existing generated tokens and standard Host styles |
| Runtime's fixed iframe heights | `McpAppSizePolicy` | Container bounds, standard size notifications, no reconnect on resize |
| Bare Host method callbacks | Receiver-preserving runtime calls | Class adapters revoke their actual binding |

Controls remain in `@pero/app-sdk/ui`; no token source or generated style is
changed. Resource retry requires an owner callback to obtain current authority
and never repeats the initial tool. Runtime core remains independent of React;
the optional React entry depends on the existing shared design library.

Verification is recorded in `docs/fitness/mcp-apps.md` after the affected running
surfaces are checked. This migration does not by itself establish Native or
packaged-product acceptance.

## Remaining product work

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
distinguish its proposal from shipped code. Original-call adoption and the
measured conversation surface now implement that seam in #217. The official
conversation acceptance uses real Workbench/Host/Go ACP with a deterministic
loopback model; its audit proxy records actual tools/call requests without
changing the upstream server or resource. Evidence is recorded in the fitness
report after the actual graphical run.
