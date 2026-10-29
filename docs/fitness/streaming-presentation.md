---
kind: verification_report
date: 2026-10-29
---

# ACP streaming presentation

This change follows the local Zed checkout at revision `37faef8`: its thinking
entry state, left-aligned disclosure, compact tool Markdown, separate raw input
and output, and session metadata title transition. Pero additionally mutes the
expanded thinking body as requested. Zed itself does not globally gray that body.

The shared `pero-chat-ui` implementation serves Workbench and Product Chat in
both native GPUI and Wasm. Three pure concepts own the rules: ThinkingState,
ToolTranscript and ConversationTitle. Rendering retains the existing streamed
document entities and theme typography preferences. Tool text is one caption
step below chat text, with a 12 px minimum; answers keep their normal styling.

## Development acceptance

Target: macOS 27.0.1 arm64, local development binaries and Electron 45.1.0.
Source: working-tree change based on `d2de7c4`, alongside independently developed
global appearance and content-reader changes. No installed-package or other-OS
acceptance is implied.

The ACP fixture and real Qoder both pass through the actual Host and shared GPUI
UI in a real background Electron window. Each run has a disposable workspace,
settings, history and Electron profile. Pointer actions use measured disclosure
and permission bounds; no test-only message injection replaces the Host path.

`node tests/e2e/streaming-presentation.mjs` covers:

- Streaming reasoning opens; manual collapse survives later chunks; a manual
  expansion survives the transition to tools; later untouched reasoning closes
  when the turn completes.
- Input-equivalent JSON is absent from results, independently disclosed input
  does not create a result reader, and real structured output is retained.
- Search text is smaller and muted. Permission options work by the tool group.
  A request for an older tool remains at the conversation footer so it cannot
  disappear into history. Small JSON and short source results use compact
  readers rather than 400 px of space.
- An agent title reaches the sidebar and tab. Timestamp-only updates preserve
  it, renderer reload retains it, and a complete Host/app restart replays it.
- Light, dark and 1000 px wide windows render without page errors.

Screenshots and receipts are under
`test-results/streaming-presentation/fixture/`, including
`thinking-streaming.png`, `parameters-only.png`, `fetch-parameters.png`, `search-and-approval.png`,
`compact-json-result.png`, `final.png`, `dark.png`, `narrow.png` and `result.json`.
These generated files are not committed.

## Real Agent

`PERO_STREAM_REAL_AGENT=1 node tests/e2e/streaming-presentation.mjs` opts into the
installed Qoder CLI 1.1.56 with its existing login. The Agent is restricted to its
Read tool. The disposable workspace contains a random marker unknown to the
prompt. Acceptance requires both the actual tool output and the assistant reply
to contain that marker. Advertised read approval is clicked through the UI when
requested. The completed conversation has explicit tool input and actual output.

The run passed with no page errors. Evidence is under
`test-results/streaming-presentation/qoder/`: `real-reply.png`,
`real-tool-result.png` and `result.json`.

Qoder emitted **zero session_info_update title notifications** in this real run.
Its conversation therefore correctly retains the prompt-derived title. The
full notification-to-history title path is verified by the ACP fixture; this
change does not add a second model request to generate titles for providers
that omit them.

## Checks

- `npm run check` passes TypeScript, generated contracts/theme/icons and locales.
- Wasm Workbench and Product Chat build, and the native GPUI binary builds.
- `npm test` passes all 90 Rust tests across the workspace, including the
  value-based title, transcript and thinking-state transitions. The narrower
  Chat UI/runtime/Host run also passes all 57 tests.
- Existing `toolcalls.mjs`, `workbench.mjs`, `composer.mjs` and
  `agent-preparation.mjs` UI suites pass. Their result JSON/screenshots are
  under the corresponding `test-results/` directories. The workbench test
  also verifies 1000 streamed chunks, complete UTF-8 preservation, scrolling
  back without forced following, cancellation and history replay.

Build, check, unit and UI logs are retained under
`test-results/streaming-presentation/verification/`.

Real UI acceptance here is Electron hosting shared GPUI Wasm. Native GPUI is
build-verified; a physical native window, signed package and other platforms
remain separate acceptance targets. The live Qoder check proves a real Read
tool round trip, while Search/Fetch presentation and provider-title updates use
the deterministic ACP fixture.
