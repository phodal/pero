---
kind: verification_report
date: 2026-10-29
---

# Automatic ACP Agent preparation

Reference: local Zed `37faef8`, especially AgentPanel draft activation,
ConversationView initial_state and AgentConnectionStore. Pero source is a dirty
working tree based on `502b4cc`; concurrent workspace changes are not part of this
acceptance claim.

## Delivered behavior

- A visible new draft prepares automatically after Host readiness and history
  replay. Selecting another installed Agent prepares its session without a
  separate Connect action. Models/configuration appear before the first prompt.
- Connection readiness and submitted conversation identity are independent.
  Empty conversations can change Agent/workspace; submitted conversations stay
  bound. Replaced empty sessions are closed/deleted and late events are ignored.
- Rich draft tokens, frozen attachments, App scope and selected content tab are
  retained through replacement. Restoring a queued draft does not append a second
  copy of its inline references; input typed during preparation is also retained.
- A first prompt submitted during preparation is sent exactly once when ready.
  Authentication/setup failure restores the draft. Login itself sends no prompt.
- Setup failures expose Retry; no installed Agent leaves the editor usable and
  submission disabled. Repeated New chat reuses an existing empty draft; unused
  disconnected sessions are not resurrected as history after Host restart.
- Host runtime settings remember the selected Agent under `chat_agent`, preserving
  other settings. A missing preference target falls back to installed choices.
- Native Grok, Qoder and OpenCode have separate registry entries. Known external
  login methods show `opencode auth login` / `qodercli login` and an acknowledgement
  action, rather than presenting acknowledgement as an interactive login.

## Evidence

L1: `node tests/e2e/agent-preparation.mjs` ran the actual Electron/GPUI renderer
with an isolated profile, settings/history, directories and ACP processes. It
verified first-send queuing, pre-send controls, workspace/Agent replacement,
reference retention, in-flight replacement/process exit, failed startup/retry,
queued draft restoration on AuthRequired, explicit authentication, external-login
instructions, empty-draft reuse, light/dark/narrow layouts, restart preference
and unavailable-Agent behavior. No page errors were observed.

Screenshots and protocol receipts: `test-results/agent-preparation/`, including
`preparing.png`, `switch-keeps-draft.png`, `startup-error.png`, `authentication.png`,
`terminal-login.png`, `dark.png`, `narrow.png`, `remembered-agent.png`, `no-agent.png`
and `result.json`. The fixture controls readiness through an observable file;
all Agent replies in this suite are scripted.

L2 (handshake/session creation only): local Qoder CLI 1.1.56 passed `initialize`
and `session/new`, advertising three config options. The built Pero Host also
started the registered Qoder executable and emitted `session_ready` with those
options (one additional non-model setting exposed through `peroSettings`). Local OpenCode 1.18.30 passed
the same two operations, advertising two config options and terminal-login
instructions. No real model prompt or authentication was performed. The xAI Grok
CLI's installed symlink targets were missing, so its ACP transport was not tested.
Sanitized probe summary: `test-results/agent-preparation/provider-probes.json`.
Official launch/login references: [Qoder ACP](https://docs.qoder.com/cli/acp),
[Grok headless/ACP](https://docs.x.ai/build/cli/headless-scripting).

L0: `npm run check`; `node scripts/cargo.mjs test -p pero-contracts -p pero-chat-ui -p pero-runtime -p pero-host`
(63 tests); Wasm builds for Workbench and standalone Chat; and native Workbench
`cargo +nightly-2026-10-28 check -p pero-ui --features native` passed. Existing
`tests/e2e/workbench.mjs` and `tests/e2e/composer.mjs` passed, including streaming,
cancel/permissions, history replay, frozen contexts, images and completion.
The fixture tests select their remembered Agent before launch so auto-preparation
does not start an unrelated real provider.

## Boundaries

This adopts Zed's automatic preparation interaction, not its entire connection
architecture. Pero still owns a runtime/process per live conversation. Its
session-scoped App Use/MCP binding and callbacks are not multiplexed onto one
Agent process. Reopening an empty disconnected draft prepares a fresh session;
resuming a submitted conversation after Host restart still requires separate
`session/load` integration. No signed package or physical IME acceptance is claimed.
