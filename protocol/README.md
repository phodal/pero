# Protocol boundaries

`host.tsp` describes the Electron ↔ Rust Host JSONL contract. Regenerate its JSON
Schema and TypeScript types with `npm run gen:contracts`; `npm run check` detects
generated-file drift. Rust types live in `pero-contracts`.

Each event includes `version`, `kind`, `request_id` and literal `text`, with
optional `thread_id`, `data` and localized system `message_key`. ACP payloads in
`data` retain the official SDK schema. User/Agent content is never translated.

Implemented commands cover Agent discovery, workspace and text-file selection,
session creation, prompt, cancel, explicit authentication, permission response,
model selection and close. The Host forwards `run_code` and `cancel_code` to
`pero-codemode`, which runs one program on an interpreter named in the Host
settings allowlist and records the interpreter, prefix, and output on
`code_run`. The Desktop renderer does not forward `run_code` or `cancel_code`.
Electron's session IPC allowlist excludes direct file/workspace paths; those
commands originate from native file dialogs.

`session_update` carries ACP message/thought chunks, tool calls/updates and
configuration updates. `permission` carries the ACP request plus a Host-issued
`permission_id`; only advertised choices are accepted. Model selection is shown
as current only after the Agent acknowledges it. `session_auth_required` can
occur during setup or prompting; a successful `session_authenticated` permits a
new prompt but does not replay the previous one.

The Host owns a conversation event journal. `replay` supplies prior events and
live session IDs. Renderer reload reattaches the display; app restart restores
history only, without resuming external work. ACP itself remains the separate
Agent protocol implemented by the official native Rust SDK.

`local-probe.schema.json` retains the bootstrap echo diagnostic. An echo verifies
transport, not Agent work. `runtime-settings.schema.json` describes persisted
language selection (`en` / `zh-CN`), emitted before the initial `ready` event.

The desktop child uses inherited stdio, without a network listener. The separate
Go control plane owns remote Task/Run coordination; a persistent local Desktop
daemon remains a later slice.

`remote.tsp` describes implemented operator and Worker HTTP payloads. Contract
generation produces JSON Schema and TypeScript for Host and remote APIs. The
Desktop main-process adapter validates responses before forwarding credential-free
`remote_state` snapshots. Go owns authorization and Run transitions; ACP remains
the Worker-to-Agent protocol. Progress polls persisted state and an explicitly
marked event tail; resumable SSE remains a later slice. See [ADR 0002](../docs/adr/0002-remote-task-dispatch.md).
