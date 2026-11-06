---
kind: verification_report
date: 2026-10-29
---

# Composer context and completion

Scope: [Zed composer alignment](../design-docs/zed-composer-parity.md).

## Implementation

The composer uses the Kit ordinary multiline Textarea and its atomic reference
tokens instead of the code Editor. The input owns token ranges, edits and undo;
Pero owns frozen content, completion queries and selected context. Source keywords
live on `ContextKind`, and one shared picker presents `+`, `@` and slash results.

Host searches files/directories, actual Tree-sitter definitions for Rust, Go,
Python, JavaScript and TypeScript/TSX, saved threads, project/global skill files,
images, explicit-base Git diff and text/JSON/XML URLs. Directory scans honor ignore
rules and stop at documented entry/file/byte limits. Definitions bind their source
version and range. Every resolved selection gets a distinct snapshot ID, so
selecting an edited file cannot overwrite an earlier reference or undo binding.

Selected content travels separately from user text as ACP embedded resources,
images, or individual text blocks when embedded resources are unsupported. Agent
image capability gates selection and sending. Message history records reference
labels/content, and session snapshots retain the actual prompt capabilities for
renderer reloads. Picker requests are correlated; results from a dismissed query
or another chat are discarded. Draft text and references survive chat switching.

Slash completion groups actual Agent-advertised commands separately from locally
discovered skills. Choosing a command inserts it; choosing a skill freezes its
SKILL.md as context. Neither action submits a turn. Native image/file paste and
Electron browser image paste use the same typed reference path. Native and
Electron file/image/directory dialogs also resolve through Host.

The toolbar places context and permissions on the left, with model, thinking
effort and submission grouped on the right. The ordinary composer places Agent
identity and the bound workspace above the editor. Compact App chat retains its
inline Agent selector. Modes and additional permissions share
the shield menu, which shows the current mode. The connected ACP identity is fixed
to its existing session; draft sessions allow Agent selection.
Source menus and completion rows use the same icon mapping; icon-only controls
have accessible names.

Thinking effort, mode and permission choices come from actual ACP declarations.
The last confirmed selection remains active while a change is pending. Pero does
not invent Write/Ask/Minimal profiles for Agents that do not expose them. Tool-call
approval remains an Agent/Host request, separate from session configuration.
Thinking can be disabled only when the Agent advertises an Off/None choice;
the UI does not invent unsupported model settings. A short bilingual placeholder
invites the task; a reserved footer explains `@` for context and `/` for
skills/commands while the ordinary editor is focused and completion is closed.

## Verification

- Full five-crate Rust regression: 65 tests pass, including Unicode cursor-range
  queries. `npm run check` (TypeScript, theme, locale and generated contracts) passes.
- Full runtime suite passes, including ACP commands/settings/native resource and
  image transmission, actual loopback HTTP and temporary Git snapshot cases.
- Host JSONL schema conformance exercises search, resolve, error and structured
  prompt events; generated TypeScript/schema checked.
- Native UI compiles and GPUI Wasm/Desktop build.
- Real Electron with the ACP fixture verifies acknowledged settings, context-type
  menus, keyboard file selection, atomic deletion/undo, frozen file content after
  edits, slash command/skill selection, native ACP images, ClipboardEvent/FileReader
  image paste, tool approval, Escape, macOS editing shortcuts, dark and narrow UI.
  All 17 checks pass with no browser errors, including an advertised `Off`
  thinking choice followed by restoring `High`. Evidence: `test-results/composer/`
  (ignored by Git), including `toolbar.png`, `thinking-off.png`,
  `context-types.png` and `narrow.png`.

## Limits

This is local development/fixture evidence (L0/L1), not real-provider or signed
release acceptance. Selection is disabled because the workbench has no active
source editor exposing selected ranges. Symbol lookup covers the listed languages,
not a language-server index. Global/project skill discovery does not prove that
an external Agent installed or registered that skill; the selected text is supplied
as context. Switching chats restores draft content and references but resets the
input's undo stack and caret. A physical IME and native clipboard on each target
platform require separate verification.

## Composer hierarchy follow-up — 2026-11-06

Implementation was initially verified on `5012bacbc48228d878ebd3cd73302a14d4857e42`
with the workspace design-system changes. The scoped composer changes are now
integrated on `9cf2df12` (current `origin/master`), which includes the shared design
system and artifact support. Shared consumers are Native Workbench, Electron
Workbench and standalone App chat.

Migration: composer controls move from `WorkbenchStyle::chat_control` to the
shared `composer_control` helper (Caption, normal weight, at least 28px), and the
editor frame uses `composer_field`. These consume existing `RADIUS_BUTTON`,
`RADIUS_PANEL`, spacing, surface, border, focus and disabled tokens. The ordinary
editor starts with three text rows and has one quiet boundary; its duplicate top
separator is removed. Model, effort and submission wrap as a group aligned to the
right in narrow ordinary editors. The shared icon catalog now bundles ArrowUp
for icon-only submission; reconnect uses the existing refresh asset. Selected
context appears as grouped chips inside the
ordinary field and in a separate row for compact chat. Agent and workspace
selection keep their existing session-binding constraints. The Retry control is
an external neutral session-status row that labels closed sessions Reconnect Agent; it
preserves the existing `can_retry()` policy: closed empty sessions can reconnect,
and empty sessions with failed MCP tools can retry without a closed-session
message. Both paths preserve the draft and references. The previous
`retryButtonBounds` diagnostic key remains an alias to the new reconnect bounds.

Preserved behavior: the same Textarea entity owns text, atomic references, undo,
IME and paste. Submit/queue/stop, advertised ACP settings, pending acknowledgements,
completion and retargeting continue through their existing owners. E2E interactions
now read actual composer bounds instead of relying on the previous layout's
coordinates; obsolete sidebar navigation uses the existing sidebar helpers.

Verification environment: macOS arm64. Native and Host artifacts use the isolated
`target/composer-build` directory because another worktree shares `target/debug`.
Mixing that other Host with this renderer produced settings payloads from a
different layout contract; those initial theme attempts are excluded from evidence.

Observed Native window: light and dark at the default 1440px window width, idle
and focused boundaries, empty and populated send states, Chinese multiline text,
and model/thinking menus. Environment labels sit above the field; toolbar labels
and menus remain legible, with no overlap in these observed states. Text was set
through accessibility for visual inspection; this does not establish physical
keyboard or IME acceptance.

Initial build and static checks: isolated Native build, both GPUI Wasm consumers, Web and
Desktop builds pass. The 22 chat-ui and 2 theme Rust unit tests pass. `npm run
check` passes, including bilingual locale and generated contract checks. The
Electron IME suite passes boundary keys, successive Pinyin, editing, shortcuts,
composition commit and cancel.

Real Electron fixture suites `composer`, `agent-preparation` and `product-chat`
pass with no browser errors. Composer covers context chips, atomic delete/undo,
frozen contents, slash/mention completion, acknowledged settings, image/file
paste, permission requests, dark theme and narrow layout. Agent preparation
covers queued submission, startup failure/reconnect, authentication, retained
draft/references, preference persistence and unavailable Agents. Its fixture now
declares HTTP MCP support required by the current Host. Product chat covers the
standalone compact consumer, multiline/wrapped expansion, completion, manual
submission, cancellation, separate drafts and retained App state. Its tool toggle
clicks now use existing measured bounds rather than fixed coordinates.

Inspected Electron screenshots: `test-results/composer/controls.png`,
`narrow.png` and `test-results/agent-preparation/startup-error.png`; the failed
Agent has one explicit recovery row while its original draft/reference remain.
The ordinary narrow composer keeps the entire right control group right-aligned.
Standalone compact/light, dark and narrow screenshots are under
`test-results/product-chat/`; these were also inspected after the final icon
rebuild. The compact send arrow is visible and the editable text and controls fit
in the field. The fixture shell's Show/Close header text overlaps outside the
composer; this follow-up does not establish acceptance of that shell header.
These screenshot paths are ignored build evidence.

Integration verification on `9cf2df12`: Native, all GPUI Wasm targets, Host, Web
and Desktop rebuilds pass. `npm run check` and 25 chat-ui plus 2 theme unit tests
pass. Electron `composer`, `ime`, `agent-preparation`, `product-chat` (8 checks)
and `agent-startup` pass with no browser errors;
the latter exercises actual built-in MCP tools, optional MCP failure, the legacy
retry bounds and successful recovery in light/dark and narrow Chinese layouts.
The new integration worktree uses an ignored `target` link to the same isolated
composer build cache.

The latest upstream standalone shell can issue artifact requests before Host is
ready, leaving an earlier closed draft with a runtime-unavailable error. The
product-chat fixture now waits for Host readiness and tracks the selected
conversation by ID. This verifies the intended active conversation independently
of array position; it does not establish clean startup of that artifact path.
Tool disclosure interactions scroll the actual message viewport before reading
bounds, since opening a tool can move its toggle above the visible viewport.

These are local fixture/development results. Real-provider behavior, signed
packages, other operating systems, physical IME and native clipboard remain
outside this follow-up's acceptance scope.
