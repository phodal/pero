//! GPUI adapter for the shared command catalog. Existing action handlers own behavior.
use crate::app::Workbench;
use gpui_kit::{prelude::*, *};
use pero_contracts::shortcuts::{CommandId, ShortcutOverrides, ShortcutPlatform, ShortcutScope};

gpui_kit::actions!(
    shortcuts,
    [
        NewChat,
        OpenSettings,
        OpenShortcuts,
        OpenCommands,
        ToggleSidebar,
        ToggleChat,
        ToggleTerminal,
        OpenAutomation,
        OpenRemoteTasks
    ]
);
const KEYMAP_SOURCE: KeyBindingMetaIndex = KeyBindingMetaIndex(0x5045524f);

pub(crate) fn platform(cx: &App) -> ShortcutPlatform {
    if cx.platform_info().is_mac() {
        ShortcutPlatform::Macos
    } else {
        ShortcutPlatform::Other
    }
}

pub(crate) fn action(command: CommandId) -> Box<dyn Action> {
    use CommandId::*;
    match command {
        NewChat => Box::new(self::NewChat),
        Settings => Box::new(OpenSettings),
        KeyboardShortcuts => Box::new(OpenShortcuts),
        CommandPalette => Box::new(OpenCommands),
        ToggleSidebar => Box::new(self::ToggleSidebar),
        ToggleChat => Box::new(self::ToggleChat),
        ToggleTerminal => Box::new(self::ToggleTerminal),
        Automation => Box::new(OpenAutomation),
        RemoteTasks => Box::new(OpenRemoteTasks),
        OpenRecent => Box::new(crate::workspace_recent::OpenRecentContent),
        SearchWorkspace => Box::new(crate::spotlight::OpenSpotlight),
        OpenWeb => Box::new(crate::web_documents::OpenWeb),
        CloseTab => Box::new(crate::workspace_tab_actions::ClosePaneTab),
        ReopenTab => Box::new(crate::workspace_tab_actions::ReopenClosedPaneTab),
        PreviewToSide => Box::new(crate::workspace_tab_actions::OpenPreviewToSide),
        NextTab => Box::new(crate::workspace_pane_tabs::NextPaneTabMru),
        PreviousTab => Box::new(crate::workspace_pane_tabs::PreviousPaneTabMru),
        NextContent => Box::new(crate::workspace_view::NextContent),
        PreviousContent => Box::new(crate::workspace_view::PreviousContent),
        Back => Box::new(crate::workspace_view::WorkspaceBack),
        Forward => Box::new(crate::workspace_view::WorkspaceForward),
        SplitLeft => Box::new(crate::workspace_pane_views::SplitPaneLeft),
        SplitRight => Box::new(crate::workspace_pane_views::SplitPaneRight),
        SplitUp => Box::new(crate::workspace_pane_views::SplitPaneUp),
        SplitDown => Box::new(crate::workspace_pane_views::SplitPaneDown),
        FocusLeft => Box::new(crate::workspace_pane_views::FocusPaneLeft),
        FocusRight => Box::new(crate::workspace_pane_views::FocusPaneRight),
        FocusUp => Box::new(crate::workspace_pane_views::FocusPaneUp),
        FocusDown => Box::new(crate::workspace_pane_views::FocusPaneDown),
        ClosePane => Box::new(crate::workspace_pane_views::ClosePane),
        SettingsSearch => Box::new(crate::settings_view::FocusSettingsSearch),
        SettingsNavigation => Box::new(crate::settings_view::FocusSettingsNavigation),
        FocusPane1 => Box::new(crate::workspace_tab_actions::FocusPane1),
        FocusPane2 => Box::new(crate::workspace_tab_actions::FocusPane2),
        FocusPane3 => Box::new(crate::workspace_tab_actions::FocusPane3),
        FocusPane4 => Box::new(crate::workspace_tab_actions::FocusPane4),
        FocusPane5 => Box::new(crate::workspace_tab_actions::FocusPane5),
        FocusPane6 => Box::new(crate::workspace_tab_actions::FocusPane6),
        FocusPane7 => Box::new(crate::workspace_tab_actions::FocusPane7),
        FocusPane8 => Box::new(crate::workspace_tab_actions::FocusPane8),
        FocusPane9 => Box::new(crate::workspace_tab_actions::FocusPane9),
    }
}

pub(crate) fn install(overrides: &ShortcutOverrides, cx: &mut App) {
    let platform = platform(cx);
    // Kit currently exposes replacement only for the whole map. Preserve every foreign
    // binding and its order; remove only bindings tagged as this catalog's projection.
    let retained = cx
        .key_bindings()
        .borrow()
        .bindings()
        .filter(|binding| binding.meta() != Some(KEYMAP_SOURCE))
        .cloned()
        .collect::<Vec<_>>();
    let mut bindings = Vec::new();
    for command in CommandId::ALL {
        let context = match command.scope() {
            ShortcutScope::Workbench => "PeroWorkbench",
            ShortcutScope::Settings => "SettingsPanel",
        };
        for key in overrides.bindings(*command, platform) {
            let binding = KeyBinding::load(
                &key.to_string(),
                action(*command),
                Some(
                    KeyBindingContextPredicate::parse(context)
                        .expect("named scope")
                        .into(),
                ),
                false,
                None,
                cx,
            )
            .expect("validated shortcut sequence")
            .with_meta(KEYMAP_SOURCE);
            bindings.push(binding);
        }
    }
    cx.clear_key_bindings();
    cx.bind_keys(retained);
    cx.bind_keys(bindings);
    #[cfg(target_family = "wasm")]
    publish_menu(overrides, platform);
}

#[cfg(target_family = "wasm")]
fn publish_menu(overrides: &ShortcutOverrides, platform: ShortcutPlatform) {
    use wasm_bindgen::prelude::*;
    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_namespace=window, js_name=peroShortcutMenu)]
        fn publish(json: &str);
    }
    publish(&serde_json::to_string(&overrides.menu(platform)).expect("shortcut menu"));
}

impl Workbench {
    pub(crate) fn install_shortcuts(&self, cx: &mut Context<Self>) {
        install(&self.preferences.shortcuts, cx);
        #[cfg(not(target_family = "wasm"))]
        for page in self.native_app_pages.values() {
            let menu = self.preferences.shortcuts.menu(platform(cx));
            page.view
                .update(cx, |page, cx| page.set_shortcuts(menu, cx));
        }
    }

    pub(crate) fn execute_shortcut(
        &mut self,
        command: CommandId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.workspace_focus.focus(window, cx);
        window.dispatch_action(action(command), cx);
    }
    pub(crate) fn shortcut_label(&self, command: CommandId, cx: &App) -> String {
        self.preferences
            .shortcuts
            .bindings(command, platform(cx))
            .iter()
            .map(|key| key.label(platform(cx)))
            .collect::<Vec<_>>()
            .join(" / ")
    }
    pub(crate) fn shortcut_handlers(
        &self,
        element: Stateful<Div>,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        element
            .on_action(cx.listener(|this, _: &NewChat, window, cx| {
                this.new_chat(cx);
                this.chat
                    .read(cx)
                    .composer
                    .clone()
                    .update(cx, |input, cx| input.focus(window, cx));
            }))
            .on_action(
                cx.listener(|this, _: &OpenSettings, window, cx| this.open_settings(window, cx)),
            )
            .on_action(cx.listener(|this, _: &OpenShortcuts, window, cx| {
                this.show_settings(
                    crate::settings_section::SettingsSection::Shortcuts,
                    window,
                    cx,
                )
            }))
            .on_action(cx.listener(|this, _: &OpenCommands, window, cx| {
                this.open_command_palette(window, cx)
            }))
            .on_action(cx.listener(|this, _: &ToggleSidebar, _, cx| this.toggle_sidebar(cx)))
            .on_action(cx.listener(|this, _: &ToggleChat, _, cx| {
                this.set_chat_dock(!this.preferences.layout.chat_open, cx)
            }))
            .on_action(
                cx.listener(|this, _: &ToggleTerminal, window, cx| {
                    this.toggle_terminal(window, cx)
                }),
            )
            .on_action(
                cx.listener(|this, _: &OpenAutomation, window, cx| {
                    this.open_automations(window, cx)
                }),
            )
            .on_action(cx.listener(|this, _: &OpenRemoteTasks, _, cx| {
                this.receive_remote(
                    &pero_contracts::HostEvent::new("remote_open", None, String::new()),
                    cx,
                );
            }))
    }
}
