// Stable UI command and persisted keymap contracts. Defaults live in pero-contracts.
import "@typespec/json-schema";
using JsonSchema;
@jsonSchema
namespace Pero.Shortcuts;
model ShortcutClosed { ...Record<never>; }
@oneOf union CommandId {
  "new_chat",
  "settings",
  "keyboard_shortcuts",
  "command_palette",
  "toggle_sidebar",
  "toggle_chat",
  "toggle_terminal",
  "open_recent",
  "search_workspace",
  "open_web",
  "close_tab",
  "reopen_tab",
  "preview_to_side",
  "next_tab",
  "previous_tab",
  "next_content",
  "previous_content",
  "back",
  "forward",
  "split_left",
  "split_right",
  "split_up",
  "split_down",
  "focus_left",
  "focus_right",
  "focus_up",
  "focus_down",
  "close_pane",
  "automation",
  "remote_tasks",
  "settings_search",
  "settings_navigation",
  "focus_pane1",
  "focus_pane2",
  "focus_pane3",
  "focus_pane4",
  "focus_pane5",
  "focus_pane6",
  "focus_pane7",
  "focus_pane8",
  "focus_pane9",
}
@minLength(1) @maxLength(128) scalar KeySequence extends string;
model PlatformOverrides {
  @maxItems(4) new_chat?: KeySequence[];
  @maxItems(4) settings?: KeySequence[];
  @maxItems(4) keyboard_shortcuts?: KeySequence[];
  @maxItems(4) command_palette?: KeySequence[];
  @maxItems(4) toggle_sidebar?: KeySequence[];
  @maxItems(4) toggle_chat?: KeySequence[];
  @maxItems(4) toggle_terminal?: KeySequence[];
  @maxItems(4) open_recent?: KeySequence[];
  @maxItems(4) search_workspace?: KeySequence[];
  @maxItems(4) open_web?: KeySequence[];
  @maxItems(4) close_tab?: KeySequence[];
  @maxItems(4) reopen_tab?: KeySequence[];
  @maxItems(4) preview_to_side?: KeySequence[];
  @maxItems(4) next_tab?: KeySequence[];
  @maxItems(4) previous_tab?: KeySequence[];
  @maxItems(4) next_content?: KeySequence[];
  @maxItems(4) previous_content?: KeySequence[];
  @maxItems(4) back?: KeySequence[];
  @maxItems(4) forward?: KeySequence[];
  @maxItems(4) split_left?: KeySequence[];
  @maxItems(4) split_right?: KeySequence[];
  @maxItems(4) split_up?: KeySequence[];
  @maxItems(4) split_down?: KeySequence[];
  @maxItems(4) focus_left?: KeySequence[];
  @maxItems(4) focus_right?: KeySequence[];
  @maxItems(4) focus_up?: KeySequence[];
  @maxItems(4) focus_down?: KeySequence[];
  @maxItems(4) close_pane?: KeySequence[];
  @maxItems(4) automation?: KeySequence[];
  @maxItems(4) remote_tasks?: KeySequence[];
  @maxItems(4) settings_search?: KeySequence[];
  @maxItems(4) settings_navigation?: KeySequence[];
  @maxItems(4) focus_pane1?: KeySequence[];
  @maxItems(4) focus_pane2?: KeySequence[];
  @maxItems(4) focus_pane3?: KeySequence[];
  @maxItems(4) focus_pane4?: KeySequence[];
  @maxItems(4) focus_pane5?: KeySequence[];
  @maxItems(4) focus_pane6?: KeySequence[];
  @maxItems(4) focus_pane7?: KeySequence[];
  @maxItems(4) focus_pane8?: KeySequence[];
  @maxItems(4) focus_pane9?: KeySequence[];

  ...ShortcutClosed
}
model ShortcutOverrides { macos?: PlatformOverrides; other?: PlatformOverrides; ...ShortcutClosed }
model MenuEntry {
  command: CommandId;
  label_key: string;
  accelerators: string[];
  application_entry: boolean;
  ...ShortcutClosed
}
model ShortcutMenu { entries: MenuEntry[]; ...ShortcutClosed }
model ExecuteCommand { command: CommandId; ...ShortcutClosed }
@oneOf union ShortcutProtocol {ShortcutOverrides, ShortcutMenu, ExecuteCommand}
