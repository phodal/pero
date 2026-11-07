use crate::{
    app::Workbench,
    components::{
        ActionHandler,
        sidebar::{self, DeleteAffordance, SidebarAction},
    },
    workspace::{ConversationTab, WorkbenchPage},
};
use gpui_kit::{component::Sizable, prelude::*, div, px, Window, CursorStyle, Role, MouseButton, MouseDownEvent, KeyDownEvent};
use std::rc::Rc;
const INITIAL_VISIBLE_SESSIONS: usize = 5;
const SESSION_REVEAL_STEP: usize = 10;
impl Workbench {
    pub(crate) fn receive_session_workspace(&mut self, event: &pero_contracts::HostEvent, window: &mut Window, cx: &mut Context<Self>) {
        if event.kind == "error" || event.kind == "disconnected" { self.pending_session_workspace = None; }
        if event.kind != "workspace" { return; }
        let Some(expected) = self.pending_session_workspace.take() else { return; };
        if expected != event.text { return; }
        self.new_chat(cx);
        let composer = self.chat.read(cx).composer.clone();
        composer.update(cx, |input, cx| input.focus(window, cx));
    }

    pub(crate) fn navigation_actions(
        &self,
        cx: &mut Context<Self>,
    ) -> ActionHandler<SidebarAction> {
        Rc::new(
            cx.listener(|this: &mut Self, action: &SidebarAction, window, cx| {
                match action {
                    SidebarAction::Terminal => this.toggle_terminal(window,cx),
                    SidebarAction::RequestDelete(index) => {
                        this.chat.update(cx, |panel, _| {
                            panel.deleting_chat =
                                panel.chats.get(*index).map(|chat| chat.id.clone());
                        });
                    }
                    SidebarAction::ConfirmDelete(index) => {
                        this.chat.update(cx, |panel, cx| {
                            if panel.deleting_chat.as_deref()
                                == panel.chats.get(*index).map(|chat| chat.id.as_str())
                            {
                                panel.delete_chat(*index, cx);
                            }
                        });
                    }
                    SidebarAction::CancelDelete => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                    }
                    SidebarAction::SessionMenu(key) => this.session_menu_open = key.clone(),
                    SidebarAction::ToggleSessionSearch => {
                        let filtering = !this.session_search.read(cx).value().trim().is_empty();
                        this.session_search_open = filtering || !this.session_search_open;
                        if this.session_search_open {
                            this.session_search.update(cx, |input, cx| input.focus(window, cx));
                        } else { this.workspace_focus.focus(window, cx); }
                    }
                    SidebarAction::NewProjectChat(workspace) => {
                        if this.workspace == *workspace {
                            this.new_chat(cx);
                            let composer = this.chat.read(cx).composer.clone();
                            composer.update(cx, |input, cx| input.focus(window, cx));
                        } else {
                            this.pending_session_workspace = Some(workspace.clone());
                            this.command(serde_json::json!({"action":"workspace","path":workspace}), cx);
                        }
                    }
                    SidebarAction::NewChat => {
                        this.pending_session_workspace = None;
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.new_chat(cx);
                        let composer = this.chat.read(cx).composer.clone();
                        composer.update(cx, |input, cx| input.focus(window, cx));
                    }
                    SidebarAction::OpenApp { name, panel } => {
                        this.chat
                            .update(cx, |panel_state, _| panel_state.deleting_chat = None);
                        this.pending_app = Some((name.clone(), panel.clone()));
                        if this.apps.entries.iter().any(|app| &app.name == name && !app.enabled) {
                            this.apps.loading = true;
                            this.command(serde_json::json!({"action":"apps_enable","name":name}), cx);
                        } else {
                            this.refresh_apps(cx);
                            this.open_app(name.clone(), panel.clone(), cx);
                        }
                    }
                    SidebarAction::Navigate(index) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        if *index == WorkbenchPage::Conversation {
                            let active = this.chat.read(cx).active_chat;
                            this.focus_chat(active, ConversationTab::Chat, cx);
                        } else {
                            this.navigate(*index, cx);
                        }
                        this.sync_follow(cx);
                        if *index == WorkbenchPage::Apps {
                            this.refresh_apps(cx);
                        }
                    }
                    SidebarAction::ToggleProject(key) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        if !this.collapsed_projects.remove(key) {
                            this.collapsed_projects.insert(key.clone());
                        }
                    }
                    SidebarAction::RevealSessions(key) => {
                        let shown = this
                            .revealed_sessions
                            .get(key)
                            .copied()
                            .unwrap_or(INITIAL_VISIBLE_SESSIONS);
                        this.revealed_sessions
                            .insert(key.clone(), shown.saturating_add(SESSION_REVEAL_STEP));
                    }
                    SidebarAction::SelectSession(index) => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.focus_chat(Some(*index), ConversationTab::Chat, cx);
                    }
                }
                cx.notify();
            }),
        )
    }
    pub(crate) fn sessions_panel(&self, width: f32, window: &Window, cx: &mut Context<Self>) -> impl IntoElement {
        let on_action = self.navigation_actions(cx);
        let panel = self.chat.read(cx);
        let query = self.session_search.read(cx).value().trim().to_lowercase();
        let session_row =
            |i: usize, chat: &pero_chat_ui::conversation::Conversation| sidebar::RecentRow {
                key: chat.id.clone(),
                bounds: Some(
                    self.view_bounds
                        .sessions
                        .probe(chat.id.clone())
                        .into_any_element(),
                ),
                label: chat.title.display().to_owned(),
                active: self.navigation.page() == WorkbenchPage::Conversation
                    && panel.active_chat == Some(i),
                status: chat.list_status(),
                unread: chat.notice.unread,
                menu_open: self.session_menu_open.as_deref() == Some(chat.id.as_str()),
                action: SidebarAction::SelectSession(i),
                delete: Some(DeleteAffordance {
                    request: SidebarAction::RequestDelete(i),
                    confirm: SidebarAction::ConfirmDelete(i),
                    cancel: SidebarAction::CancelDelete,
                }),
            };
        let groups: Vec<sidebar::ProjectGroup> = self
            .project_catalog(cx)
            .into_iter()
            .filter_map(|project| {
                let rows = panel
                    .chats
                    .iter()
                    .enumerate()
                    .rev()
                    .filter(|(_, chat)| {
                        project.contains_workspace(&chat.workspace)
                            && (query.is_empty()
                                || chat.title.display().to_lowercase().contains(&query))
                    })
                    .map(|(i, chat)| session_row(i, chat))
                    .collect::<Vec<_>>();
                if rows.is_empty() && (!query.is_empty() || project.workspace.is_none()) {
                    return None;
                }
                Some(sidebar::ProjectGroup {
                    collapsed: query.is_empty() && self.collapsed_projects.contains(&project.key),
                    revealed: self
                        .revealed_sessions
                        .get(&project.key)
                        .copied()
                        .unwrap_or(INITIAL_VISIBLE_SESSIONS),
                    workspace: project.workspace,
                    key: project.key,
                    name: project.name,
                    rows,
                })
            })
            .collect();
        let ungrouped: Vec<sidebar::RecentRow> = panel
            .chats
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, chat)| {
                chat.workspace.is_empty()
                    && (query.is_empty() || chat.title.display().to_lowercase().contains(&query))
            })
            .map(|(i, chat)| session_row(i, chat))
            .collect();
        let search = pero_theme::search_field(gpui_kit::component::input::Input::new(&self.session_search)
            .small().cleanable(true), self.ui(cx).chrome()).into_any_element();
        div().relative().h_full().flex_shrink_0().child(sidebar::sessions(
            self.ui(cx),
            width,
            sidebar::SessionsProps {
                searching: self.session_search_open || !query.is_empty(),
                empty_text: self.t(if query.is_empty() {
                    "sessions.empty"
                } else {
                    "sessions.no_matches"
                }),
                groups,
                ungrouped,
            },
            search,
            on_action,
            cx,
        )).child(
            div().id("sessions-resize")
                .absolute().right_0().top_0().w(px(4.)).h_full()
                .cursor(CursorStyle::ResizeLeftRight)
                .track_focus(&self.sessions_resize_focus)
                .role(Role::Splitter)
                .aria_label(self.t("workspace.resize_sessions"))
                .aria_numeric_value(width.into())
                .child(div().absolute().right_0().top_0().w(px(1.)).h_full()
                    .when(self.sessions_resize_focus.is_focused(window), |el| {
                        el.bg(pero_theme::UiAppearance::global(cx).palette.focus)
                    }))
                .on_mouse_down(MouseButton::Left, cx.listener(|this, event: &MouseDownEvent, window, cx| {
                    this.sessions_resize_focus.focus(window, cx);
                    if event.click_count == 2 {
                        this.preferences.layout.resize_sessions(
                            pero_contracts::workbench::LayoutPreferences::DEFAULT_SESSIONS_WIDTH.into());
                        this.save_preferences(this.preferences.clone(), cx);
                    } else {
                        this.resizing_sessions = true;
                    }
                    cx.stop_propagation();
                    cx.notify();
                }))
                .on_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                    use pero_contracts::workbench::LayoutPreferences as L;
                    let available = f32::from(window.viewport_size().width) - this.layout.sidebar_width;
                    match event.keystroke.key.as_str() {
                        "left" => this.preferences.layout.resize_sessions_by(available, -20.),
                        "right" => this.preferences.layout.resize_sessions_by(available, 20.),
                        "home" => this.preferences.layout.resize_sessions(L::MIN_SESSIONS_WIDTH.into()),
                        "end" => this.preferences.layout.resize_sessions(L::MAX_SESSIONS_WIDTH.into()),
                        _ => return,
                    }
                    this.save_preferences(this.preferences.clone(), cx);
                    cx.stop_propagation();
                    cx.notify();
                }))
        )
    }
}
