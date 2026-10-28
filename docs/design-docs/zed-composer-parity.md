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
- [ ] Dark/narrow inspection and Electron fixture regression. These remain
  separate from the native real-provider evidence.

## Batch 2: context and editing

- [ ] Shared typed context references and frozen per-turn content; preserve draft
  text, permit removing references, and never send merely by selecting context.
- [ ] Files/directories: workspace picker/search and explicit recursive bounds.
- [ ] Symbols: actual indexed definitions/ranges; grep hits do not establish
  symbol resolution. Bind references to source identity and version.
- [ ] Threads: references to selected persisted conversation content.
- [ ] Skills: Agent-advertised skills and slash commands, separate from local
  package discovery. Use actual Agent capabilities.
- [ ] Images: picker and paste, native ACP image content with size/type limits,
  and visible unsupported-capability state.
- [ ] Selection: selected ranges from an actual editor, disabled when absent.
- [ ] Branch diff: explicit base, pinned diff snapshot and Git failure recovery.
- [ ] `@`/`/` completion, keyboard/focus behavior, multiline input, IME, attachment
  presentation and native/Web parity, including errors and cancellation.

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
