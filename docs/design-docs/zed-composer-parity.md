# Zed composer parity

Reference: local `/Users/phodal/test/zed`, revision `37faef8` (2026-10-28).
This is behavior alignment, not an import of Zed's independent GPUI/editor graph.

The user selected both Copilot integration paths, delivered in batches. A working
Copilot ACP Agent is not acceptance of a Copilot Chat model provider or inline
edit prediction. The feature list below remains the acceptance checklist.

## Reference ownership

- `crates/agent_ui/src/message_editor.rs`: retained editor, pasted selections,
  mentions, draft contents, completion delegate and supported context sources.
- `completion_provider.rs`: files/directories, project symbols, stored threads,
  skills and branch diff; references bind ranges rather than flattening the draft.
  Sources are gated by embedded-context capability and availability.
- `agent_model_selector.rs`, `model_selector.rs`: model selection is separate
  from Agent selection; session modes and reasoning options are capabilities.
- `crates/copilot_chat`: subscription identity, model discovery and streaming.
- `crates/language_models/src/provider/copilot_chat.rs`: the Copilot Chat model
  provider used by Zed's internal Agent and other model-backed features.
- `crates/copilot`: edit prediction, separate from chat and ACP.

## Batch 1: ACP session controls

- [x] Replace the absolute-positioned Agent list with a Kit dropdown: checkmark,
  keyboard navigation, disabled unavailable Agents and outside-click dismissal.
- [x] Register installed `copilot --acp --stdio`; do not bundle its native CLI.
- [x] Keep model selection distinct; read model names from Agent declarations.
- [x] Add mode and thinking-effort controls from advertised ACP configuration.
- [x] Support modern config options and legacy `session/set_mode`.
- [x] Preserve confirmed values while requests are pending; reject unknown values
  in one shared settings concept, then apply Agent acknowledgement/notifications.
- [x] Re-read options after a model change. Hide unsupported controls.
- [x] Wrap the toolbar in narrow windows. Include mode descriptions, since modes
  such as Copilot Autopilot can change approval behavior. Do not select such modes
  automatically. The separate allow-all selector is outside this batch.
- [x] Native real Copilot reply, acknowledged mode/effort changes and menu
  keyboard behavior: [batch 1 evidence](../fitness/zed-composer-batch-1.md).
- [x] Electron fixture inspection of dark/narrow controls and composer flows:
  [batch 2 evidence](../fitness/zed-composer-batch-2.md). Native/real-provider
  acceptance remains separate.

## Batch 2: context and editing

- [x] Shared typed context references and frozen content, with distinct snapshot
  identity; preserve drafts, remove references and never send on selection.
- [x] Files/directories: workspace search, OS picker and explicit recursive bounds.
- [x] Symbols: actual Tree-sitter definitions/ranges for Rust, Go, Python,
  JavaScript and TypeScript/TSX, bound to source identity/version.
- [x] Threads: selected persisted conversation content.
- [x] Skills: locally discovered project/global packages are explicitly separate
  from actual Agent-advertised slash commands; no installation claim is inferred.
- [x] Images: picker and paste, native ACP content, type/size bounds, and visible
  unsupported-capability recovery without clearing the draft.
- [x] Selection availability: disabled while there is no source editor exposing
  actual selected ranges. Host supports explicitly supplied source ranges.
- [x] Branch diff: explicit base, frozen snapshot and visible Git errors.
- [x] Shared `@`/`/` completion, keyboard navigation, multiline input, native token
  editing/undo, attachment labels, cancellation/stale query handling and UI states.
- [x] Icons identify context sources; left controls hold context and permissions,
  right controls hold ACP identity, model and thought level. Submitted Agent
  identity is fixed; modes and permissions share one compact menu. Advertised
  Off/None thought levels are selectable. Placeholder exposes `@` and `/`.
- [x] Development Electron fixture acceptance: [batch 2 evidence](../fitness/zed-composer-batch-2.md).
- [ ] Physical IME, native clipboard on all target platforms and real-provider
  context acceptance. Chat switching currently resets caret and undo history.

## Batch 3: Copilot Chat model provider

- [ ] Host-owned Copilot subscription authentication with Pero's identity and
  encrypted storage; do not reuse Zed's client registration or credentials.
- [ ] Provider model discovery, capabilities/usage metadata and streaming requests.
- [ ] Adapt the provider into the same execution seam; do not put a second Agent
  loop in the UI or conflate a model provider with an ACP executable.
- [ ] Explicitly verify cancellation, tools, reasoning, modes, reconnect, usage
  and authentication recovery. Real subscription acceptance is separate from
  fixtures and schema tests.
- [ ] Assess editor inline completion separately; it is not implied by a Chat
  provider and must not be labelled implemented by the first two batches.

## Acceptance

Check boxes mean implementation only unless accompanied by execution evidence.
Each batch records its own UI and backend receipts in `docs/fitness/`. The
complete Zed parity claim remains open until all relevant rows are accepted.

## Automatic Agent preparation (2026-10-29)

Visible drafts prepare on opening and Agent selection, following Zed's draft
activation flow. An empty connected session remains retargetable; submitting
locks its identity. Rich draft restoration, explicit external authentication,
startup retry, selected-Agent persistence and current acceptance boundaries are
recorded in [Agent preparation](../fitness/agent-preparation.md). Process sharing
and submitted-session restoration are not included in this UI alignment.

## Streaming transcript presentation (2026-10-29)

Shared Chat follows Zed's thinking-disclosure lifecycle, compact tool text,
separate arguments/results and session title notifications. Expanded reasoning
is additionally muted. Actual UI and real Qoder acceptance, including the
provider's missing title-notification boundary, are recorded in
[streaming presentation](../fitness/streaming-presentation.md).
