/* Generated from protocol/shortcuts.tsp by scripts/codegen/contracts.mjs. Do not edit. */

/**
 * Generated from protocol/shortcuts.tsp. Do not edit.
 */
export type ShortcutProtocol = ShortcutProtocol1;
export type ShortcutProtocol1 = ShortcutOverrides | ShortcutMenu | ExecuteCommand;
export type KeySequence = string;
export type CommandId =
  | "new_chat"
  | "settings"
  | "keyboard_shortcuts"
  | "command_palette"
  | "toggle_sidebar"
  | "toggle_chat"
  | "toggle_terminal"
  | "open_recent"
  | "search_workspace"
  | "open_web"
  | "close_tab"
  | "reopen_tab"
  | "preview_to_side"
  | "next_tab"
  | "previous_tab"
  | "next_content"
  | "previous_content"
  | "back"
  | "forward"
  | "split_left"
  | "split_right"
  | "split_up"
  | "split_down"
  | "focus_left"
  | "focus_right"
  | "focus_up"
  | "focus_down"
  | "close_pane"
  | "automation"
  | "remote_tasks"
  | "settings_search"
  | "settings_navigation"
  | "focus_pane1"
  | "focus_pane2"
  | "focus_pane3"
  | "focus_pane4"
  | "focus_pane5"
  | "focus_pane6"
  | "focus_pane7"
  | "focus_pane8"
  | "focus_pane9";

export interface ShortcutOverrides {
  macos?: PlatformOverrides;
  other?: PlatformOverrides;
}
export interface PlatformOverrides {
  /**
   * @maxItems 4
   */
  new_chat?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  settings?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  keyboard_shortcuts?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  command_palette?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  toggle_sidebar?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  toggle_chat?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  toggle_terminal?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  open_recent?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  search_workspace?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  open_web?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  close_tab?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  reopen_tab?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  preview_to_side?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  next_tab?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  previous_tab?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  next_content?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  previous_content?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  back?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  forward?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  split_left?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  split_right?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  split_up?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  split_down?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_left?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_right?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_up?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_down?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  close_pane?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  automation?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  remote_tasks?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  settings_search?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  settings_navigation?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane1?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane2?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane3?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane4?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane5?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane6?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane7?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane8?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
  /**
   * @maxItems 4
   */
  focus_pane9?:
    | []
    | [KeySequence]
    | [KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence]
    | [KeySequence, KeySequence, KeySequence, KeySequence];
}
export interface ShortcutMenu {
  entries: MenuEntry[];
}
export interface MenuEntry {
  command: CommandId;
  label_key: string;
  accelerators: string[];
  application_entry: boolean;
}
export interface ExecuteCommand {
  command: CommandId;
}
