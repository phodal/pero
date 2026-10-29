//! Workbench content selection and the single shared conversation dock.
use crate::{
    app::Workbench,
    layout::{ChatPlacement, WorkspaceLayout},
    workspace::{ConversationTab, WorkbenchPage, WorkspaceItem, WorkspaceRoute},
};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use serde_json::json;
use pero_chat_ui::theme::WorkbenchStyle as W;
gpui_kit::actions!(workspace, [NextContent, PreviousContent]);

impl Workbench {
    pub(crate) fn record_task_selection(&mut self, task: Option<String>) {
        match task {
            Some(id) => {
                self.navigation.open(WorkspaceItem::Task(id));
            }
            None => {
                if let Some(key) = self.selected_project.clone() {
                    self.navigation.open(WorkspaceItem::Project(key));
                } else {
                    self.navigation.show(WorkbenchPage::Tasks);
                }
            }
        }
    }

    pub(crate) fn reconcile_content(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let projects = self.project_catalog(cx);
        let project_identities = self
            .navigation
            .items()
            .iter()
            .filter_map(|item| {
                if let WorkspaceItem::Conversation(id) = item {
                    return self.chat.read(cx).replacement_thread(id)
                        .map(|id| (item.clone(), WorkspaceItem::Conversation(id.to_owned())));
                }
                let WorkspaceItem::Project(key) = item else {
                    return None;
                };
                let project = projects.iter().find(|project| project.matches_key(key))?;
                (project.key != *key)
                    .then(|| (item.clone(), WorkspaceItem::Project(project.key.clone())))
            })
            .collect::<Vec<_>>();
        for (old, new) in project_identities {
            // The source acquired its canonical name; it is still the same view.
            self.navigation.replace_identity(&old, new);
        }
        let available = self
            .navigation
            .items()
            .iter()
            .filter(|item| match item {
                WorkspaceItem::Conversation(id) => {
                    self.chat.read(cx).chats.iter().any(|chat| &chat.id == id)
                }
                WorkspaceItem::Project(key) => {
                    projects.iter().any(|project| project.matches_key(key))
                }
                // The current task page is only a partial observation of source availability.
                WorkspaceItem::Task(_) => true,
                WorkspaceItem::App { name, panel } => self.apps.contains_panel(name, panel),
            })
            .cloned()
            .collect::<Vec<_>>();
        if let Some(route) = self.navigation.reconcile(&available) {
            self.activate_route(route, window, cx);
        }
    }

    pub(crate) fn open_app(&mut self, name: String, panel: String, cx: &mut Context<Self>) {
        if self.apps.contains_panel(&name, &panel) {
            self.navigation.open(WorkspaceItem::App {
                name: name.clone(),
                panel: panel.clone(),
            });
            self.apps.error = None;
            self.sync_follow(cx);
            self.command(json!({"action":"apps_open","name":name,"panel":panel}), cx);
        }
    }

    fn activate_route(
        &mut self,
        route: WorkspaceRoute,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match route {
            WorkspaceRoute::Page(page) => self.navigate(page, cx),
            WorkspaceRoute::Content(WorkspaceItem::Conversation(id)) => {
                let index = self
                    .chat
                    .read(cx)
                    .chats
                    .iter()
                    .position(|chat| chat.id == id);
                self.focus_chat(index, ConversationTab::Chat, cx);
            }
            WorkspaceRoute::Content(WorkspaceItem::Project(key)) => {
                self.open_project(key, window, cx)
            }
            WorkspaceRoute::Content(WorkspaceItem::Task(id)) => self.open_task(id, cx),
            WorkspaceRoute::Content(WorkspaceItem::App { name, panel }) => {
                self.open_app(name, panel, cx)
            }
        }
        self.sync_follow(cx);
        cx.notify();
    }

    fn activate_content(
        &mut self,
        item: WorkspaceItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(route) = self.navigation.select(&item) {
            self.activate_route(route, window, cx);
        }
    }

    fn close_content(&mut self, item: &WorkspaceItem, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(route) = self.navigation.close(item) {
            self.activate_route(route, window, cx);
        }
        cx.notify();
    }

    pub(crate) fn chat_visible(&self) -> bool {
        WorkspaceLayout::chat_placement(self.navigation.route(), self.tab, &self.preferences.layout)
            != ChatPlacement::Hidden
    }

    pub(crate) fn chat_dock_visible(&self) -> bool {
        WorkspaceLayout::chat_placement(self.navigation.route(), self.tab, &self.preferences.layout)
            == ChatPlacement::Dock
    }

    pub(crate) fn set_chat_dock(&mut self, open: bool, cx: &mut Context<Self>) {
        self.preferences.layout.chat_open = open;
        self.save_preferences(self.preferences.clone(), cx);
        self.sync_follow(cx);
    }

    fn content_label(&self, item: &WorkspaceItem, cx: &App) -> (String, &'static str) {
        match item {
            WorkspaceItem::Conversation(id) => (
                self.chat
                    .read(cx)
                    .chats
                    .iter()
                    .find(|chat| &chat.id == id)
                    .map(|chat| chat.title.display().to_owned())
                    .unwrap_or_else(|| self.t("chat.session").into()),
                "message-circle",
            ),
            WorkspaceItem::Project(key) => (
                self.project_catalog(cx)
                    .into_iter()
                    .find(|project| &project.key == key)
                    .map(|project| project.name)
                    .unwrap_or_else(|| self.t("nav.projects").into()),
                "folder",
            ),
            WorkspaceItem::Task(id) => (
                self.remote
                    .tasks()
                    .iter()
                    .find(|task| task["id"].as_str() == Some(id))
                    .and_then(|task| task["title"].as_str())
                    .unwrap_or(id)
                    .into(),
                "layout-list",
            ),
            WorkspaceItem::App { name, .. } => (
                self.apps
                    .entries
                    .iter()
                    .find(|app| &app.name == name)
                    .map(|app| app.display_name.clone())
                    .unwrap_or_else(|| name.clone()),
                "layout-grid",
            ),
        }
    }

    pub(crate) fn content_tabs(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let current = self.navigation.current();
        div()
            .id("workspace-tabs")
            .h(px(W::TAB))
            .flex_shrink_0()
            .flex()
            .items_center()
            .border_b_1()
            .border_color(p.border)
            .bg(p.bg)
            .child(
                div()
                    .id("workspace-tab-scroll")
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .flex()
                    .items_center()
                    .overflow_x_scroll()
                    .track_scroll(&self.tab_scroll)
                    .children(self.navigation.items().iter().map(|item| {
                        let (title, icon) = self.content_label(item, cx);
                        let select = item.clone();
                        let close = item.clone();
                        div()
                            .min_w(px(120.))
                            .max_w(px(220.))
                            .h_full()
                            .bg(p.color(if current == Some(item) {
                                "surface"
                            } else {
                                "bg"
                            }))
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .gap(px(1.))
                            .px(px(W::GAP))
                            .border_b_2()
                            .border_color(p.color(if current == Some(item) {
                                "action"
                            } else {
                                "bg"
                            }))
                            .child(
                                Button::new(SharedString::from(format!("workspace-tab:{item:?}")))
                                    .ghost()
                                    .small()
                                    .flex_1()
                                    .min_w_0()
                                    .h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                                    .justify_start()
                                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
                                    .icon(
                                        Icon::default()
                                            .size(px(W::ICON))
                                            .path(pero_chat_ui::assets::UiIcon::named(icon).path()),
                                    )
                                    .label(title.clone())
                                    .tooltip(title.clone())
                                    .accessibility_label(title.clone())
                                    .toggled(current == Some(item))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.activate_content(select.clone(), window, cx)
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!(
                                    "workspace-tab-close:{item:?}"
                                )))
                                .ghost()
                                .small()
                                .w(px(26.))
                                .h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                                .icon(Icon::default().path("icons/x.svg"))
                                .tooltip(self.t("workspace.close_tab"))
                                .accessibility_label(format!(
                                    "{}: {title}",
                                    self.t("workspace.close_tab")
                                ))
                                .on_click(cx.listener(
                                    move |this, _, window, cx| {
                                        this.close_content(&close, window, cx)
                                    },
                                )),
                            )
                    })),
            )
            .when(
                matches!(self.navigation.current(), Some(WorkspaceItem::App { .. })),
                |el| {
                    el.child(
                        Button::new("workspace-apps")
                            .ghost()
                            .small()
                            .w(px(32.))
                            .h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                            .icon(Icon::default().path("icons/layout-grid.svg"))
                            .tooltip(self.t("apps.back"))
                            .accessibility_label(self.t("apps.back"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.navigate(WorkbenchPage::Apps, cx);
                                cx.notify();
                            })),
                    )
                },
            )
            .when(
                self.navigation.page() == WorkbenchPage::Tasks
                    || matches!(self.navigation.current(), Some(WorkspaceItem::App { .. })),
                |el| {
                    el.child(
                        Button::new("workspace-chat-toggle")
                            .ghost()
                            .small()
                            .h(px(pero_theme::UiAppearance::global(cx).typography.control_height()))
                            .mr(px(8.))
                            .icon(Icon::default().path(if self.chat_dock_visible() {
                                "icons/panel-right-close.svg"
                            } else {
                                "icons/panel-right-open.svg"
                            }))
                            .label(self.t(if self.chat_dock_visible() {
                                "chat.close_panel"
                            } else {
                                "chat.open_panel"
                            }))
                            .toggled(self.chat_dock_visible())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.set_chat_dock(!this.preferences.layout.chat_open, cx)
                            })),
                    )
                },
            )
    }

    pub(crate) fn chat_dock(
        &self,
        width: f32,
        narrow: bool,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .id("workspace-chat-panel")
            .flex()
            .flex_col()
            .w(px(width))
            .h_full()
            .min_h_0()
            .flex_shrink_0()
            .relative()
            .border_l_1()
            .border_color(p.border)
            .child(self.chat.clone())
            .when(!narrow, |el| {
                el.child(
                    div()
                        .id("workspace-chat-resize")
                        .track_focus(&self.chat_resize_focus)
                        .role(Role::Splitter)
                        .aria_label(self.t("workspace.resize_chat"))
                        .aria_numeric_value(self.preferences.layout.chat_width().into())
                        .when(self.chat_resize_focus.is_focused(window), |el| {
                            el.bg(p.focus)
                        })
                        .absolute()
                        .top_0()
                        .left_0()
                        .w(px(6.))
                        .h_full()
                        .cursor(CursorStyle::ResizeLeftRight)
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, _, window, cx| {
                                this.chat_resize_focus.focus(window, cx);
                                this.resizing_chat = true;
                                cx.notify();
                            }),
                        )
                        .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                            let delta = match event.keystroke.key.as_str() {
                                "left" => 20.,
                                "right" => -20.,
                                _ => return,
                            };
                            let width = this.preferences.layout.chat_width() + delta;
                            this.preferences.layout.resize_chat(width);
                            this.save_preferences(this.preferences.clone(), cx);
                            cx.stop_propagation();
                        })),
                )
            })
    }

    pub(crate) fn cycle_content(
        &mut self,
        previous: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let route = if previous {
            self.navigation.select_previous()
        } else {
            self.navigation.select_next()
        };
        if let Some(route) = route {
            self.activate_route(route, window, cx);
        }
    }
}
