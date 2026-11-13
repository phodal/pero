---
kind: analysis
date: 2026-11-13
---

# MCP Apps as conversation tool results

MCP Apps are interactive representations of tool results. They are not entries
in Pero's installed App catalog and do not own an Agent session. The official
unmodified Vanilla JS example is the primary compatibility check; Notebook is
a secondary example using the same protocol and Host surface.

## What Zed actually provides

[Zed #58470](https://github.com/zed-industries/zed/discussions/58470) proposes
MCP Apps in ACP sessions: a Host-owned upstream client and sidecar preserve UI
bindings, render a sandbox in the Agent panel, and route `ui/message` back to
ACP. This is a feature proposal, not a shipped implementation.

At pinned commit `48741fd17d0dec28be6ad664b0a06dc7202086be`, Zed's
[Tool type](https://github.com/zed-industries/zed/blob/48741fd17d0dec28be6ad664b0a06dc7202086be/crates/context_server/src/types.rs#L525)
does not preserve Tool `_meta`; its native
[MCP result projection](https://github.com/zed-industries/zed/blob/48741fd17d0dec28be6ad664b0a06dc7202086be/crates/agent/src/tools/context_server_registry.rs#L393)
does not establish a standard UI binding. Its implemented
[ToolCallSync](https://github.com/zed-industries/zed/blob/48741fd17d0dec28be6ad664b0a06dc7202086be/crates/agent_ui/src/entry_view_state.rs#L43)
does offer useful lifecycle separation: live updates, history restoration, and
materialization after expansion. Expanding content need not run execution again.

## Pero ownership and implemented conversation seam

Pero already has a session-owned MCP connection and permission chain. Reuse it;
the Zed proposal does not require adding another proxy/client to this runtime.

1. Capture the declaring Tool's UI metadata at the real MCP registry boundary.
   Bind server identity/generation, conversation incarnation/revision and the
   original tool-call ID to its observed arguments and result.
2. The conversation tool row owns disclosure and the measured surface slot.
   `mountMcpApp` receives the original result and bound Host callback ports. It
   does not call the initial tool. Inline and expanded Inspector presentations
   consume that same identity rather than creating AppCatalog entries.
3. Live, restored and first-expanded rows are different lifecycle cases. Restore
   the recorded ordinary result immediately. Mount an interactive view only
   when its actual live authority remains available; opening or restoring must
   never replay the initial business tool.
4. Follow-up tool calls retain the same MCP policy/approval owner. `ui/message`
   must enter the Host conversation submission/draft owner, with explicit busy,
   user-review and cancellation semantics. An iframe cannot start its own Agent.
5. Collapsed rows retain their existing view without reinitializing it. Closing
   the view revokes its binding; closing the session removes its surface and
   authority. Historical result data and live execution authority remain distinct.
   Scientific outcomes are unchanged by whether an interactive view is available.

The Go MCP dispatch captures the complete original result before model-content
projection, with its actual tool-call ID and arguments. Only the owning store
can project `_meta["pero.mcpApp"]` into ACP. `adopt` reads that receipt and the
declaring resource on the same live server generation; it never invokes the
initial tool. Model-only tool visibility can still produce a result view, while
follow-up App calls retain their own visibility and approval checks.

The conversation tool row automatically opens a measured inline slot. Electron
and chat-only Web shells place the admitted frame at those bounds; Native uses
a child WebView in the same tool row. No installed App or Web document is created.
The tools/resources picker remains available for explicit exploration.

Managed views advertise text `ui/message`. A bound view sends text through
`mcp.message`; Host admits its live conversation incarnation/revision and calls
the existing prompt owner. The acknowledgement means submission, including the
existing visible busy queue, rather than completion. Model replies and other
conversation content are never returned to the iframe. Unsupported non-text
messages are rejected. `ui/update-model-context` is not advertised.

After renderer restoration, a still-live original receipt can be adopted again.
After process/session replacement, an expired receipt cannot grant interaction:
ordinary historical tool content remains available and no tool is replayed.

## Presentation implemented now

The Host surface has one compact scope/action bar and the tool view. It has no
MCP Apps brand header, persistent server sidebar or installation UI. Connections
remain in Connectors. Parameter input and tool descriptions are preparation
controls; they disappear while the result is displayed. Official example HTML
is loaded unchanged, with its own UI and assets, through the shared sandbox.
In a recorded conversation view, **Open view** restores the captured original
result after **Close view**. It does not repeat the tool or the model turn.

See [ADR 0036](../adr/0036-mcp-apps-host-runtime.md) and
[verification](../fitness/mcp-apps.md) for shipped scope and measured evidence.
