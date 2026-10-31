use crate::{
    app::Workbench,
    components::{
        ActionHandler,
        sidebar::{self, DeleteAffordance, SidebarAction},
    },
    workspace::{ConversationTab, WorkbenchPage},
};
use gpui_kit::{component::Sizable, prelude::*};
use std::rc::Rc;
const INITIAL_VISIBLE_SESSIONS: usize = 5;
const SESSION_REVEAL_STEP: usize = 10;
impl Workbench {
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
                    SidebarAction::NewChat => {
                        this.chat.update(cx, |panel, _| panel.deleting_chat = None);
                        this.new_chat(cx);
                        let composer = this.chat.read(cx).composer.clone();
                        composer.update(cx, |input, cx| input.focus(window, cx));
                    }
                    SidebarAction::OpenApp { name, panel } => {
                        this.chat
                            .update(cx, |panel_state, _| panel_state.deleting_chat = None);
                        this.pending_app = Some((name.clone(), panel.clone()));
                        this.refresh_apps(cx);
                        this.open_app(name.clone(), panel.clone(), cx);
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
    pub(crate) fn sessions_panel(&self, width: f32, cx: &mut Context<Self>) -> impl IntoElement {
        let on_action = self.navigation_actions(cx);
        let panel = self.chat.read(cx);
        let query = self.session_search.read(cx).value().trim().to_lowercase();
        let session_row =
            |i: usize, chat: &pero_chat_ui::conversation::Conversation| sidebar::RecentRow {
                bounds: Some(
                    self.view_bounds
                        .sessions
                        .probe(chat.id.clone())
                        .into_any_element(),
                ),
                label: chat.title.display().to_owned(),
                icon: None,
                active: self.navigation.page() == WorkbenchPage::Conversation
                    && panel.active_chat == Some(i),
                busy: chat.busy(),
                attention: chat.permission.is_some() || chat.error.is_some(),
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
                if rows.is_empty() {
                    return None;
                }
                Some(sidebar::ProjectGroup {
                    collapsed: query.is_empty() && self.collapsed_projects.contains(&project.key),
                    revealed: self
                        .revealed_sessions
                        .get(&project.key)
                        .copied()
                        .unwrap_or(INITIAL_VISIBLE_SESSIONS),
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
        let search = gpui_kit::component::input::Input::new(&self.session_search)
            .small()
            .into_any_element();
        sidebar::sessions(
            self.ui(cx),
            width,
            sidebar::SessionsProps {
                empty_text: self.t(if query.is_empty() {
                    "sessions.empty"
                } else {
                    "sessions.no_matches"
                }),
                groups,
                ungrouped,
                new_chat_bounds: &self.view_bounds.new_chat,
            },
            search,
            on_action,
            cx,
        )
    }
}
