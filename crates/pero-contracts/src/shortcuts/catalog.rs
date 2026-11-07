//! Stable command identities and their default bindings. No UI or transport dependencies.
use super::{KeySequence, ShortcutPlatform};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum CommandId {
    NewChat,
    Settings,
    KeyboardShortcuts,
    CommandPalette,
    ToggleSidebar,
    ToggleChat,
    ToggleTerminal,
    OpenRecent,
    SearchWorkspace,
    OpenWeb,
    CloseTab,
    ReopenTab,
    PreviewToSide,
    NextTab,
    PreviousTab,
    NextContent,
    PreviousContent,
    Back,
    Forward,
    SplitLeft,
    SplitRight,
    SplitUp,
    SplitDown,
    FocusLeft,
    FocusRight,
    FocusUp,
    FocusDown,
    ClosePane,
    Automation,
    RemoteTasks,
    SettingsSearch,
    SettingsNavigation,
    FocusPane1,
    FocusPane2,
    FocusPane3,
    FocusPane4,
    FocusPane5,
    FocusPane6,
    FocusPane7,
    FocusPane8,
    FocusPane9,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutScope {
    Workbench,
    Settings,
}

impl CommandId {
    pub const ALL: &'static [Self] = &[
        Self::NewChat,
        Self::Settings,
        Self::KeyboardShortcuts,
        Self::CommandPalette,
        Self::ToggleSidebar,
        Self::ToggleChat,
        Self::ToggleTerminal,
        Self::OpenRecent,
        Self::SearchWorkspace,
        Self::OpenWeb,
        Self::CloseTab,
        Self::ReopenTab,
        Self::PreviewToSide,
        Self::NextTab,
        Self::PreviousTab,
        Self::NextContent,
        Self::PreviousContent,
        Self::Back,
        Self::Forward,
        Self::SplitLeft,
        Self::SplitRight,
        Self::SplitUp,
        Self::SplitDown,
        Self::FocusLeft,
        Self::FocusRight,
        Self::FocusUp,
        Self::FocusDown,
        Self::ClosePane,
        Self::Automation,
        Self::RemoteTasks,
        Self::SettingsSearch,
        Self::SettingsNavigation,
        Self::FocusPane1,
        Self::FocusPane2,
        Self::FocusPane3,
        Self::FocusPane4,
        Self::FocusPane5,
        Self::FocusPane6,
        Self::FocusPane7,
        Self::FocusPane8,
        Self::FocusPane9,
    ];
    pub fn label_key(self) -> &'static str {
        match self {
            Self::NewChat => "chat.new",
            Self::Settings => "settings.title",
            Self::KeyboardShortcuts => "shortcuts.title",
            Self::CommandPalette => "shortcuts.commands",
            Self::ToggleSidebar => "shortcuts.sidebar",
            Self::ToggleChat => "shortcuts.chat",
            Self::ToggleTerminal => "terminal.title",
            Self::OpenRecent => "shortcuts.recent",
            Self::SearchWorkspace => "spotlight.open",
            Self::OpenWeb => "web.open_url",
            Self::CloseTab => "shortcuts.close_tab",
            Self::ReopenTab => "shortcuts.reopen_tab",
            Self::PreviewToSide => "shortcuts.preview_side",
            Self::NextTab => "shortcuts.next_tab",
            Self::PreviousTab => "shortcuts.previous_tab",
            Self::NextContent => "shortcuts.next_content",
            Self::PreviousContent => "shortcuts.previous_content",
            Self::Back => "shortcuts.back",
            Self::Forward => "shortcuts.forward",
            Self::SplitLeft => "shortcuts.split_left",
            Self::SplitRight => "shortcuts.split_right",
            Self::SplitUp => "shortcuts.split_up",
            Self::SplitDown => "shortcuts.split_down",
            Self::FocusLeft => "shortcuts.focus_left",
            Self::FocusRight => "shortcuts.focus_right",
            Self::FocusUp => "shortcuts.focus_up",
            Self::FocusDown => "shortcuts.focus_down",
            Self::ClosePane => "shortcuts.close_pane",
            Self::Automation => "automation.title",
            Self::RemoteTasks => "nav.remote",
            Self::SettingsSearch => "shortcuts.settings_search",
            Self::SettingsNavigation => "shortcuts.settings_navigation",
            Self::FocusPane1 => "shortcuts.pane_1",
            Self::FocusPane2 => "shortcuts.pane_2",
            Self::FocusPane3 => "shortcuts.pane_3",
            Self::FocusPane4 => "shortcuts.pane_4",
            Self::FocusPane5 => "shortcuts.pane_5",
            Self::FocusPane6 => "shortcuts.pane_6",
            Self::FocusPane7 => "shortcuts.pane_7",
            Self::FocusPane8 => "shortcuts.pane_8",
            Self::FocusPane9 => "shortcuts.pane_9",
        }
    }
    pub fn scope(self) -> ShortcutScope {
        match self {
            Self::SettingsSearch | Self::SettingsNavigation => ShortcutScope::Settings,
            _ => ShortcutScope::Workbench,
        }
    }
    /// These entry points remain usable while an embedded App owns keyboard focus.
    pub fn application_entry(self) -> bool {
        matches!(
            self,
            Self::NewChat
                | Self::Settings
                | Self::KeyboardShortcuts
                | Self::CommandPalette
                | Self::SearchWorkspace
                | Self::ToggleTerminal
                | Self::Automation
                | Self::RemoteTasks
        )
    }
    pub fn defaults(self, platform: ShortcutPlatform) -> Vec<KeySequence> {
        let source = match (self, platform) {
            (Self::NextContent, ShortcutPlatform::Other) => "ctrl-pagedown",
            (Self::PreviousContent, ShortcutPlatform::Other) => "ctrl-pageup",
            (Self::NewChat, _) => "primary-n",
            (Self::Settings, _) => "primary-,",
            (Self::KeyboardShortcuts, _) => "primary-/",
            (Self::CommandPalette, _) => "primary-shift-p",
            (Self::ToggleSidebar, _) => "primary-b",
            (Self::ToggleChat, _) => "primary-alt-b",
            (Self::ToggleTerminal, _) => "ctrl-`",
            (Self::OpenRecent, _) => "primary-p",
            (Self::SearchWorkspace, _) => "primary-shift-k",
            (Self::OpenWeb, _) => "primary-l",
            (Self::CloseTab, _) => "primary-w",
            (Self::ReopenTab, _) => "primary-shift-t",
            (Self::PreviewToSide, _) => "primary-k v",
            (Self::NextTab, _) => "ctrl-tab",
            (Self::PreviousTab, _) => "ctrl-shift-tab",
            (Self::NextContent, _) => "primary-alt-right",
            (Self::PreviousContent, _) => "primary-alt-left",
            (Self::Back, _) => "alt-left",
            (Self::Forward, _) => "alt-right",
            (Self::SplitLeft, _) => "primary-alt-shift-left",
            (Self::SplitRight, _) => "primary-\\|primary-alt-shift-right",
            (Self::SplitUp, _) => "primary-alt-shift-up",
            (Self::SplitDown, _) => "primary-alt-shift-down",
            (Self::FocusLeft, _) => "ctrl-alt-left",
            (Self::FocusRight, _) => "ctrl-alt-right",
            (Self::FocusUp, _) => "ctrl-alt-up",
            (Self::FocusDown, _) => "ctrl-alt-down",
            (Self::ClosePane, _) => "primary-shift-w",
            (Self::Automation, _) => "primary-shift-a",
            (Self::RemoteTasks, _) => "primary-shift-r",
            (Self::SettingsSearch, _) => "primary-f",
            (Self::SettingsNavigation, _) => "primary-shift-e",
            (Self::FocusPane1, _) => "primary-1",
            (Self::FocusPane2, _) => "primary-2",
            (Self::FocusPane3, _) => "primary-3",
            (Self::FocusPane4, _) => "primary-4",
            (Self::FocusPane5, _) => "primary-5",
            (Self::FocusPane6, _) => "primary-6",
            (Self::FocusPane7, _) => "primary-7",
            (Self::FocusPane8, _) => "primary-8",
            (Self::FocusPane9, _) => "primary-9",
        };
        source
            .split('|')
            .map(|s| {
                s.replace("primary", platform.primary())
                    .parse()
                    .expect("catalog key sequence")
            })
            .collect()
    }
}
