# 0031: Shared commands and Host-owned keyboard preferences

Date: 2026-11-07
Status: accepted

## Problem

Workbench bindings, Electron accelerators and tooltip text had separate sources.
Users could not discover, disable or reassign them consistently. Embedded App
frames and Native WebViews do not participate in GPUI's focus dispatch tree.
The [reference analysis](../design-docs/keyboard-shortcuts.md) compares the local
ChatGPT bundle and Zed checkout.

## Decision

`pero-contracts::shortcuts` owns four concepts:

- `CommandId`: 41 stable command identities, labels, defaults and entry policy.
- `ShortcutScope`: Workbench or Settings. These scopes are exclusive while a
  settings dialog owns focus. Input editing, IME, terminal and local widget
  commands retain their current owners; no user context expression language.
- `KeySequence`: canonical modifiers and one or two strokes. The initial stroke
  requires Command, Control or Alt. System editing/quit combinations cannot be
  used, including as a chord prefix.
- `ShortcutOverrides`: separate macOS/other-platform maps. Missing means inherit;
  an empty list explicitly disables; reset removes the override. Each command
  has at most four bindings. A pure `apply(platform, edit)` returns a new value
  or typed conflicts. Exact and prefix collisions in one scope require explicit
  reassignment, which removes only overlapping bindings from the other command.

Deserialization validates external configuration once with the same rules used
by edit previews. `WorkbenchPreferences.shortcuts` defaults for older settings.
Host runtime settings remain the persistence owner; UI closes a pending editor
only on the existing save acknowledgement. No per-key Host messages or separate
keymap file are introduced.

`protocol/shortcuts.tsp` defines stored overrides, command IDs and menu projection.
TypeSpec generates TypeScript/JSON Schema; Rust owns semantic conflict validation.
GPUI projects effective bindings to existing Actions, preserving all foreign Kit
bindings during replacement. Commands still call existing workspace/chat owners.
Menus, command palette, settings and tooltip text derive from effective bindings.

Only catalog-marked application entry commands cross an embedded App boundary.
They accept a single stroke so the same assignment works in GPUI and App pages.
Two-stroke bindings remain available for GPUI workbench/settings commands.
Electron displays accelerators without registering a second keyboard handler:
GPUI owns its top frame; `before-input-event` routes application entries only
from `pero-app://` frames. Native's main App WebView forwards allowed command IDs
through its existing IPC boundary. Copy/paste and App-local commands stay local.

## Scope and migration

- Preserve pane, MRU, history, URL, recent-content and preview Actions.
- Add new chat, settings, shortcut settings, command palette and panel entries.
- New chat uses the existing Workbench `new_chat` behavior. It does not add an
  App-specific conversation lifecycle or submit a prompt.
- macOS uses Command defaults; other platforms use Control. Redundant historical
  Control aliases on macOS are removed; users can add them explicitly.
- Other platforms use Ctrl+PageUp/PageDown for adjacent content, avoiding the
  existing Ctrl+Alt+arrow pane-focus bindings.
- Keep the connection diagnostic menu entry, but remove its conflicting
  Cmd/Ctrl+Shift+E accelerator. Settings navigation keeps that key.
- Keep Escape/Enter for MRU and Settings cancellation as local widget behavior.
- Shortcut controls reuse Kit Input/Button and the shared Pero palette. No new
  control skin, icon family or token is introduced.

Standalone chat-only products, ordinary external web documents, nested Native
App frames, OS-global activation and arbitrary context expressions are outside
this implementation. Cross-platform source compatibility is not evidence of
Windows/Linux runtime acceptance. Non-US keyboard layouts and physical IME need
separate acceptance. Actual checks are recorded in
[shortcut verification](../fitness/keyboard-shortcuts.md).
