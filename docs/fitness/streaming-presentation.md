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
- Input is disclosed separately. ACP content is retained even when it equals
  the input; a raw-input-only call does not create a result reader.
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

## Permission card follow-up — 2026-11-06

Source: `b9f0c741` plus the permission-card change. The shared `ChatPanel::approval`
serves Native Workbench, Electron Workbench and standalone App Chat. The old flat
`warning_bg` block and equal default buttons become a neutral `surface` card with
`border`, `RADIUS_PANEL`, shared spacing/type tokens, the existing shield asset,
and `pero_theme::action_button` / `feedback_actions`. The operation stays beside
the actions in a wide panel and wraps above them when space is limited. Only the
first ACP `allow_once` option receives primary emphasis; persistent grants and
rejections use the shared ghost treatment. Provider labels and order are retained.

Tool association, the footer fallback for an earlier tool, request IDs and the
Host/ACP decision lifecycle are unchanged. Inline cards retain the nearby tool
title instead of repeating it. No decision is preselected or automatically sent.
The existing measured button bounds remain the pointer targets.

Development acceptance: macOS arm64, local Native GPUI and Electron GPUI Wasm.
Native was opened with a disposable profile and a translated copy of the ACP
fixture. Inspected `test-results/permission-native/light.png` and `dark.png`:
the Chinese operation and both decisions are legible, the quiet card is distinct
from the composer, and clicking Allow once removes the card and displays the
fixture's `Permission handled: allow` reply. The user's other Native instance
was not used. Cropped evidence is saved beside the full screenshots.

Inspected Electron evidence under `test-results/composer/`: `permission.png`,
`permission-long.png`, `permission-dark.png`, `permission-narrow-light.png` and
`permission-narrow-dark.png`. The long operation wraps without covering any of
the three options at Workbench's actual 1000 px minimum width. The composer suite
also verifies that Allow once, Reject and Always allow each reach the fixture
with the original option ID, including an order where Reject comes first.
`test-results/streaming-presentation/fixture/search-and-approval.png` shows the
same component beside the active tool group, and its approval completes normally.
That older suite now uses measured New Chat/composer targets and advertises the
HTTP MCP capability required by the current Host; the fixture invokes no server.
Standalone Product Chat also passes its 9 checks, including approval in a
360 × 300 embedded slot. Inspected `test-results/product-chat/permission-embedded.png`:
both decisions remain visible and Allow once completes through Host. The lower
composer extends below this short slot while approval is pending; this screenshot
does not establish acceptance of the entire embedded chat layout.

Checks: 26 chat-ui and 2 theme Rust tests, `npm run check`, Native and Host builds,
all GPUI Wasm targets, Web and Desktop builds pass. Composer and streaming fixture
suites and standalone Product Chat pass without browser errors. Logs are retained at
`/tmp/pero-permission-{unit,check,native-build,host,wasm,web,desktop,composer,streaming,product}.log`.
Generated evidence stays ignored. This verifies local fixture behavior and the
observed surfaces; real providers, Native narrow windows, screen-reader output,
signed distributions and other operating systems remain unverified.

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
