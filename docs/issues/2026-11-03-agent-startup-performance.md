---
kind: analysis
date: 2026-11-03
title: Agent "Preparing" startup path and ACP necessity
---

# Agent startup performance (Preparing Agent)

## What the UI is waiting on

`chat.preparing` is shown while `SessionState::Connecting`. Auto-preparation
(`prepare_chat`) runs as soon as the chat is visible, Host-connected, history
replayed, and workspace non-empty. It issues `new_session` before the first
prompt ([agent-preparation](../fitness/agent-preparation.md)).

Host path for that command:

1. Resolve agent (`pero` → `pero-agent-acp`), load managed MCP, bind connectors,
   freeze App plugin instructions when scoped.
2. Spawn a **new** ACP stdio process per conversation.
3. `initialize` → `session/new` (mount App Use / connectors MCP when configured)
   → optional model select → `session_ready`.

## Measured cost (local, 2026-11-03)

| Stage | Time |
| --- | --- |
| `pero-agent-acp` process spawn | ~1–2 ms |
| ACP `initialize` | ~5–6 ms |
| ACP `session/new` (empty `mcpServers`) | ~12–15 ms |
| End-to-end to ready (empty MCP) | **~20–25 ms** |
| HTTP MCP to refused port | still ~20 ms (`session/new` does not block on live tool listing failure for that case) |

Bare ACP handshake is not the multi-second delay. Setup timeout is 45s
(`SETUP_TIMEOUT` in `crates/pero-runtime/src/acp/session.rs`).

## Real bottlenecks before / around Preparing

1. **Eager preparation product rule**  
   Opening Chat (or switching Agent / empty-draft workspace) always cold-starts
   an Agent process. The empty state still looks “stuck preparing” even though
   no prompt exists. This is intentional Zed-style prep, not a protocol
   requirement.

2. **One ACP process per conversation**  
   Architecture keeps a runtime/process per live conversation; App Use/MCP is
   not multiplexed onto one Agent ([agent-preparation](../fitness/agent-preparation.md)
   Boundaries). Empty draft replacement closes and respawns.

3. **History replay gate**  
   `prepare_chat` waits for `replayed`. `ListAgents` sends the full visible
   journal (cap 5000 events). Local Desktop journal
   `~/Library/Application Support/@pero/desktop/sessions.jsonl` was **~2.8 MB /
   7230 lines**; the retained window was **5000 events ≈ 1.5 MB JSON**, of which
   **~4966 were `session_update` streaming chunks**. Serialize/parse alone is
   tens of ms; crossing Electron → chat Wasm and applying 5k events dominates
   perceived “Agent is slow” far more than ACP.

4. **App-scoped session extras**  
   Desktop always configures `PERO_APP_USE_*` / connectors when available.
   `create_session` uses `start_app` whenever App Use exists, so `session/new`
   carries Host MCP endpoints even for ordinary drafts. Paper Agent itself has
   no `agentPlugin` MCP package; App tools are Host writes via App Use after
   the Agent is up.

## Do we need ACP?

**Yes for the conversational Agent.** The built-in `pero` Agent *is*
`harness/go/cmd/pero-agent-acp`. Chat, cancel, approvals, model options and
tool turns all ride ACP. Removing ACP means a second Agent transport, not a
toggle.

**No for App UI alone.** Paper panel reads/writes do not require an ACP
session. ACP is only needed when a model Agent must call those tools through
Host-mounted MCP / App Use.

**Eager ACP before the first keystroke is optional.** Protocol does not require
pre-spawn; the current UX chose readiness-before-prompt. Lazy start on first
send (or a shared warm process) would remove most empty-state “Preparing”
time without dropping ACP.

## Design issues (ordered)

1. Journal retains raw stream deltas and replays them wholesale on every chat
   connect — wrong shape for startup.
2. Empty-draft auto-spawn conflates “panel open” with “Agent process ready”.
3. Per-thread process + App Use mount makes every new draft a cold path.
4. ACP itself is the right harness boundary; blaming ACP for ~20 ms of work
   misattributes the delay.

## Suggested follow-ups (not implemented here)

- Compact or omit `session_update` from connect replay; restore titles /
  messages / tool finals only.
- Defer `new_session` until first prompt (keep draft editable; queue send as
  today) **or** keep one warm Agent process and create sessions in-process.
- Avoid remounting App Use/connectors on drafts that cannot use them yet.
- Cap / rotate `sessions.jsonl` in development profiles.

## Related commits

- `56fba4e2` — paper HTML review hide for local PDFs (unrelated leftover landed
  with this pass).
