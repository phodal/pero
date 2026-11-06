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

## 2026-11-06: grouped process and completed-reply actions

Source: uncommitted changes on `5aca2731`; reference checkout DeepSeek Harness
`fcc0ad4621`. Migration context remains in the existing
[streaming incident](../issues/2026-10-29-acp-streaming-presentation.md).

The old read/search/fetch-only tool grouping and automatically expanded thought
body are replaced by `ProcessGroup` boundaries and independent, initially closed
reasoning disclosures. Adjacent thoughts and tools share one process group across
activity categories. Ordinary replies and user input remain visible boundaries.
Opening an individual item before its group grows keeps that item visible;
explicitly closing the group also closes its child disclosures. No third
whole-Turn fold or new settings are added in this change.

`ToolActivity` derives presentation once when applying ACP updates: an explicit
known ACP kind wins, with exact known tool names supplementing `other` for DSH,
Pero and historical records. Raw wire kind, tool IDs, input and output are kept.
Running headers show current tool detail or a completed reasoning paragraph's
first line; settled headers show ranked activity counts. Full text is retained.
Errors, permission choices, App result links and chart results stay outside the
collapsed details. This presentation does not claim that all counted calls
succeeded.

The repeated Save as document label on every Assistant segment is replaced by
one copy/save icon row on each final reply with an actual `end_turn` receipt.
Intermediate narration, in-flight replies, thoughts and unsuccessful endings do
not receive a final-reply action row. Insights raw replies and tool result actions
use the same output-action component, existing shared icons and tooltips. Host
artifact registration, versioning and the catalog are unchanged; source navigation
opens the containing process and the individual tool.

Validation on macOS arm64 with Electron 45.1.0 and an isolated ACP fixture:

- `npm run check` passed locale, design, theme, protocol, icon and TypeScript gates.
- `node scripts/cargo.mjs +nightly-2026-10-28 test -p pero-chat-ui --features native --lib`
  passed 30 tests, including process boundaries, normal-completion actions,
  semantic activity, ranked counts and streaming reasoning previews.
- Workbench Wasm and standalone Product Chat built, as did the Native binary.
- `node tests/e2e/streaming-presentation.mjs` passed with no page errors. Actual
  pointer actions cover independent reasoning/input/output disclosure, permission
  handling with a closed process, generic read/shell activity, retained failure
  and App links, a single final-reply save action, artifact creation with the
  correct source message, reload/restart, dark mode and a 1000 px window.
- `node tests/e2e/toolcalls.mjs` passed the nine-call matrix, including structured
  diff, terminal, failure, cancellation, group/individual disclosure and dark/
  narrow layout, with no page errors.

Screenshots inspected under `test-results/streaming-presentation/fixture/`:
`thinking-streaming.png`, `collapsed-approval.png`, `completed-actions.png`,
`saved-final-reply.png`, `dark.png` and `narrow.png`. They show compact process
summaries, permission/error visibility, the final action icons and saved catalog
entry. These are synthetic results, not live model or scientific acceptance.

Native uses the same compiled ChatPanel. The existing Native window was inspected,
but the Chat view could not be reached through that window's UI interaction during
this run; physical Native Chat interaction acceptance remains unverified.
Signed packages, other operating systems and live DSH provider timing are also
outside this verification.

## DeepSeek tool presentation audit — 2026-11-06

A second source inspection of local DeepSeek Harness found that the previous
process-disclosure increment did not port its typed tool bodies. `ToolCallTree`
recursively dispatches each wire tool name through a keyed toolview; the generic
fallback derives separate terminal/read/diff/search/web models before rendering
one ToolRow. A specialized card replaces generic input/output sections. Read rows
use an independently clickable recorded path and omit the argument body. Search
and read inline bodies cap at eight lines; diff caps at nine. Terminal rows expose
command, cwd, output and recorded exit/signal/background state, with failing exits
classified as errors even if the outer call settled successfully. Unsupported
metadata retains the generic fallback rather than inventing structured facts.

Disclosure is not one global rule: `useDisclosure` starts each call/reasoning
collapsed, process groups and completed-turn folding have separate owners. Desktop
initializes Standard mode (`ui-chat/src/client/apply.ts:171`); non-Desktop Web
initializes Detailed. The shared default collapse timing is completion; next-input
is separately configurable. Interrupted/error turns and interleaved user input
are kept accessible. Closing the outer turn advances/reset disclosure state.
Tool title/summary use secondary typography (default 13px), a 24px row and 14px
glyphs inside a 16px leading box. This is a different role from answer typography.

In Pero's screenshot, the extra `shell` title comes from tool detail chrome and
again from `ContentReader` using `reader_frame(document.title, ...)` even for
inline Markdown. That reader creates answer-appearance StreamText, so tool output
loses its secondary typography. Tool calls are not yet terminal/read/search/diff
cards; structured diff currently renders Before/After blocks. These are remaining
implementation gaps, not accepted parity. Provider-specific DSH metadata cannot
be assumed to exist in arbitrary ACP output; typed adapters need actual recorded
ACP fields and a lossless generic fallback.

## Typed tool bodies — 2026-11-06 implementation

The follow-up ports the generic ToolRow's typed-body precedence into the shared
GPUI Chat. `ToolBody` is derived at ACP update admission and consumed by
`tool_body_view`; raw ACP transcript data remains retained separately. Terminal
cards show authored command/cwd, stdout/stderr and recorded exit status. Nonzero
exits mark the row and its retained failure notice even if ACP says completed.
Read cards show the path and numbered content; search cards support recorded
path lists and grouped/flat matches, including Pero's actual `fstools.SearchResult`
and native Glob shapes. Read/search previews expose eight rows; unified diffs
use a nine-row preview with three context lines and actual addition/deletion
counts from `similar::TextDiff`. Explicit expansion retains all available rows.
Terminal bodies retain all output in a bounded scroll area. Specialized bodies
replace generic parameter/result/reader chrome. Unknown schemas keep the
existing lossless generic reader and raw-input disclosure.

The duplicated wire-name label is removed. Inline Markdown no longer wraps its
content in the document workspace's titled reader frame, and uses Tool stream
appearance. Workspace document reading retains its title and typography. Body
default is 13px at the user's request; tool/think body and tool-summary typography
are one pixel below the chat preference with the shared 12px floor. Existing
explicit font preferences remain owned by Host. The isolated Native profile's
Chat size was changed from 14 to 13 through the actual Settings UI, and the
returned conversation visibly updated. Terminal copy/save actions share its
command header; the original result remains the saved/copied source.

Verification: contracts 105 tests and Native-feature Chat 31 tests pass. The
model test pins stdout/stderr formats, nonzero exits, unknown-shape fallback,
read offsets, search truncation and contextual diffs. Native and all Wasm/Web
builds and `npm run check` pass. Electron `toolcalls` asserts typed read, terminal
and diff results; `streaming-presentation` and `workspace-changes` pass without
page errors. Product Chat passes its nine existing checks. Light/dark and narrow
captures come from these production-renderer fixture runs, with real Host I/O.
Native CUA opened the retained shell call, observed command/output without the
old headings, and exercised persisted chat-font adjustment. Binaries are listed
in `test-results/workspace-changes/native-launch.json`.

Compatibility boundaries: the path action currently opens the recorded tool
snapshot through the existing document owner. Live-file navigation to an original
line, DSH-only keyed plugin cards and recursive subcalls unsupported by the ACP
source are not claimed as implemented parity. Search metadata not present in ACP
is not reconstructed from prose. Four selectable DSH detail modes and whole-turn
collapse timing remain outside this body-rendering increment; the existing
Standard-like process/call disclosures remain. These distinctions must not be
reported as complete DSH equivalence.
