//! Workbench content selection and the single shared conversation dock.
use crate::{
    app::Workbench,
    layout::ChatPlacement,
    workspace::{ConversationTab, WorkbenchPage, WorkspaceItem, WorkspaceRoute},
};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use serde_json::json;

#[cfg(target_family = "wasm")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen::prelude::wasm_bindgen(js_namespace = window, js_name = peroAppChatOverlay, catch)]
    fn app_chat_overlay(json: &str) -> Result<(), wasm_bindgen::JsValue>;
}
gpui_kit::actions!(
    workspace,
    [
        NextContent,
        PreviousContent,
        WorkspaceBack,
        WorkspaceForward,
        SplitDocument
    ]
);

impl Workbench {
    pub(crate) fn active_app_chat_slot(&self) -> Option<&crate::apps::AppChatSlot> {
        self.app_chat_slot.as_ref().filter(|slot| {
            self.navigation.current()
                == Some(&WorkspaceItem::App {
                    name: slot.scope.app.clone(),
                    panel: slot.scope.panel.clone(),
                })
                && self
                    .navigation
                    .pane_layout()
                    .is_none_or(|layout| layout.leaves().len() <= 1)
        })
    }

    pub(crate) fn embedded_app_chat(
        &self,
        slot: &crate::apps::AppChatSlot,
        cx: &App,
    ) -> impl IntoElement {
        let rect = &slot.rect;
        let palette = &pero_theme::UiAppearance::global(cx).palette;
        div()
            .id("embedded-app-chat")
            .absolute()
            .left(px(rect.x))
            .top(px(rect.y))
            .w(px(rect.width))
            .h(px(rect.height))
            .on_prepaint(|bounds, _, _| Self::publish_app_chat_overlay(Some(bounds)))
            .flex()
            .flex_col()
            .bg(palette.surface)
            .border_1()
            .border_color(palette.border)
            .child(self.chat.clone())
    }
    pub(crate) fn publish_app_chat_overlay(bounds: Option<Bounds<Pixels>>) {
        #[cfg(target_family = "wasm")]
        {
            let value = bounds.map(|bounds| json!({"x":f32::from(bounds.origin.x),"y":f32::from(bounds.origin.y),"width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height)}));
            let _ = app_chat_overlay(&json!(value).to_string());
        }
        #[cfg(not(target_family = "wasm"))]
        let _ = bounds;
    }

    pub(crate) fn floating_app_chat(
        &self,
        viewport_width: f32,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let width = (viewport_width - self.layout.sidebar_width - 24.).clamp(100., 480.);
        let expanded = self.floating_chat_expanded;
        let panel = self.chat.read(cx);
        let rows = panel.composer.read(cx).value().lines().count().clamp(1, 3);
        let attachment_rows = panel.attachments.len().div_ceil(3).min(3);
        let compact_height = 100. + (rows - 1) as f32 * 22. + attachment_rows as f32 * 32.;
        let height = (f32::from(window.viewport_size().height) - 100.)
            .max(100.)
            .min(if expanded { 560. } else { compact_height });
        div()
            .id("floating-app-chat")
            .absolute()
            .right(px(12.))
            .bottom(px(12.))
            .w(px(width))
            .h(px(height))
            .on_prepaint(|bounds, _, _| Self::publish_app_chat_overlay(Some(bounds)))
            .flex()
            .flex_col()
            .bg(p.surface)
            .border_1()
            .border_color(p.border)
            .rounded(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .px(px(6.))
                    .when(expanded, |el| el.border_b_1().border_color(p.border))
                    .child(
                        div()
                            .flex_1()
                            .text_size(
                                pero_theme::UiAppearance::global(cx)
                                    .text(pero_theme::TextRole::Body),
                            )
                            .font_weight(FontWeight::SEMIBOLD)
                            .when(expanded, |el| el.child(self.t("chat.panel_title"))),
                    )
                    .child(
                        Button::new("float-chat-expand")
                            .ghost()
                            .small()
                            .icon(Icon::default().path(if expanded {
                                "icons/chevron-down.svg"
                            } else {
                                "icons/maximize.svg"
                            }))
                            .accessibility_label(self.t(if expanded {
                                "chat.hide_messages"
                            } else {
                                "chat.show_messages"
                            }))
                            .tooltip(self.t(if expanded {
                                "chat.hide_messages"
                            } else {
                                "chat.show_messages"
                            }))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.floating_chat_expanded = !this.floating_chat_expanded;
                                this.sync_follow(cx);
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("float-chat-dock")
                            .ghost()
                            .small()
                            .icon(Icon::default().path("icons/panel-right-open.svg"))
                            .accessibility_label(self.t("chat.dock"))
                            .tooltip(self.t("chat.dock"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.floating_chat = false;
                                this.sync_follow(cx);
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("float-chat-close")
                            .relative().child(self.view_bounds.chat_close.probe("float-chat-close".into()))
                            .ghost()
                            .small()
                            .icon(Icon::default().path("icons/minus.svg"))
                            .accessibility_label(self.t("chat.close_panel"))
                            .tooltip(self.t("chat.close_panel"))
                            .on_click(cx.listener(|this, _, _, cx| this.set_chat_dock(false, cx))),
                    ),
            )
            .when(expanded, |el| {
                el.child(
                    div()
                        .px(px(8.))
                        .text_size(
                            pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body),
                        )
                        .text_color(p.text_muted)
                        .child(self.t("chat.float_covered")),
                )
            })
            .child(self.chat.clone())
    }
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
        self.reconcile_documents(cx);
        let projects = self.project_catalog(cx);
        let project_identities = self
            .navigation
            .items()
            .iter()
            .filter_map(|item| {
                if let WorkspaceItem::Conversation(id) = item {
                    return self
                        .chat
                        .read(cx)
                        .replacement_thread(id)
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
        let references=self.navigation.items().iter().filter_map(|item|match item {WorkspaceItem::PullRequest(reference)=>Some(reference.clone()),_=>None}).collect::<Vec<_>>();
        for reference in references {self.ensure_pull_request(reference,window,cx);}
        let available = self
            .navigation
            .items()
            .iter()
            .filter(|item| match item {
                WorkspaceItem::Conversation(id) => {
                    self.chat.read(cx).chats.iter().any(|chat| &chat.id == id)
                }
                WorkspaceItem::PullRequest(_) => true,
                WorkspaceItem::Web(id) => self.web_documents.iter().any(|page| &page.id == id),
                WorkspaceItem::Document { .. } => self.has_workspace_document(item),
                WorkspaceItem::Project(key) => {
                    projects.iter().any(|project| project.matches_key(key))
                }
                // The current task page is only a partial observation of source availability.
                WorkspaceItem::Task(_) | WorkspaceItem::Compute => true,
                WorkspaceItem::App { name, panel } => self.apps.retains_panel(name, panel),
            })
            .cloned()
            .collect::<Vec<_>>();
        if let Some(route) = self.navigation.reconcile(&available) {
            self.activate_route(route, window, cx);
        }
    }

    pub(crate) fn open_app(&mut self, name: String, panel: String, cx: &mut Context<Self>) {
        if self.apps.contains_panel(&name, &panel) {
            self.remember_current_location(cx);
            self.navigation.open(WorkspaceItem::App {
                name: name.clone(),
                panel: panel.clone(),
            });
            self.apps.open_errors.remove(&(name.clone(), panel.clone()));
            self.sync_follow(cx);
            self.command(json!({"action":"apps_open","name":name,"panel":panel}), cx);
        }
    }

    pub(crate) fn activate_route(
        &mut self,
        route: WorkspaceRoute,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match route {
            WorkspaceRoute::Page(page) => {
                self.navigate(page, cx);
                self.workspace_focus.focus(window, cx);
            }
            WorkspaceRoute::Content(WorkspaceItem::Conversation(id)) => {
                let index = self
                    .chat
                    .read(cx)
                    .chats
                    .iter()
                    .position(|chat| chat.id == id);
                self.focus_chat(index, ConversationTab::Chat, cx);
            }
            WorkspaceRoute::Content(WorkspaceItem::PullRequest(reference)) => {
                self.ensure_pull_request(reference,window,cx);
                self.arm_pull_request_poll(cx);
                self.set_chat_dock(true,cx);
                self.workspace_focus.focus(window,cx);
            }
            WorkspaceRoute::Content(WorkspaceItem::Web(_)) => {
                self.sync_web_address(true, window, cx);
                self.workspace_focus.focus(window, cx);
            }
            WorkspaceRoute::Content(item @ WorkspaceItem::Document { .. }) => {
                self.request_workspace_source(&item, cx);
                self.ensure_document_panes(window, cx);
                if let Some(view) = self.active_document_view(&item) {
                    view.update(cx, |view, cx| view.focus(window, cx));
                }
            }
            WorkspaceRoute::Content(WorkspaceItem::Project(key)) => {
                self.open_project(key, window, cx)
            }
            WorkspaceRoute::Content(WorkspaceItem::Task(id)) => self.open_task(id, cx),
            WorkspaceRoute::Content(WorkspaceItem::App { name, panel }) => {
                self.open_app(name, panel, cx)
            }
            WorkspaceRoute::Content(WorkspaceItem::Compute) => self.open_compute(cx),
        }
        self.sync_follow(cx);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }

    fn activate_content(
        &mut self,
        item: WorkspaceItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        if let Some(route) = self.navigation.select(&item) {
            self.activate_route(route, window, cx);
        }
    }

    pub(crate) fn close_content(
        &mut self,
        item: &WorkspaceItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        self.queue_workspace_checkpoint(cx);
        if let WorkspaceItem::Web(id) = item {
            self.web_command(json!({"action":"web_close","id":id}), window, cx);
            return;
        }
        if let Some(deferred) = self
            .recovery
            .deferred
            .iter_mut()
            .find(|document| &document.saved.item() == item)
        {
            if deferred.saved.draft.is_some()
                || deferred.saved.draft_ref.is_some()
                || deferred.saved.legacy_draft
            {
                deferred.close_after_load = true;
                self.navigation.select(item);
                self.request_workspace_source(item, cx);
                cx.notify();
                return;
            }
            self.discard_document(item, window, cx);
            return;
        }
        if let Some(open) = self.documents.iter().find(|open| &open.item == item) {
            if open.view.read(cx).dirty() {
                if let Some(route) = self.navigation.select(item) {
                    self.activate_route(route, window, cx);
                }
                if let Some(view) = self.active_document_view(item) {
                    view.update(cx, |view, cx| view.request_close(cx));
                }
                self.navigation.select(item);
                cx.notify();
                return;
            }
            self.discard_document(item, window, cx);
            return;
        }
        if let Some(route) = self.navigation.close(item) {
            self.activate_route(route, window, cx);
        }
        cx.notify();
    }

    pub(crate) fn chat_visible(&self) -> bool {
        self.active_app_chat_slot().is_some()
            || self.layout.chat != ChatPlacement::Hidden
            || self
                .navigation
                .pane_layout()
                .filter(|_| self.navigation.pane_layout_visible())
                .is_some_and(|layout| layout.conversation().is_some())
    }

    pub(crate) fn chat_dock_visible(&self) -> bool {
        matches!(self.layout.chat, ChatPlacement::Dock | ChatPlacement::Float)
    }

    pub(crate) fn set_chat_dock(&mut self, open: bool, cx: &mut Context<Self>) {
        // Reopening from a closed dock is an explicit ask (titlebar toggle, Ask AI,
        // compose handoff). Keep the floating panel expanded so App controls that
        // hide themselves for question mode are not left with a collapsed stub.
        if open
            && !self.preferences.layout.chat_open
            && self.floating_chat
            && matches!(self.navigation.current(), Some(WorkspaceItem::App { .. }))
        {
            self.floating_chat_expanded = true;
        }
        self.preferences.layout.chat_open = open;
        self.save_preferences(self.preferences.clone(), cx);
        // The close control lives on the host dock, outside the App webview.
        #[cfg(not(target_family = "wasm"))]
        if !open {
            if let Some(WorkspaceItem::App { name, panel }) = self.navigation.current() {
                let key = (name.clone(), panel.clone());
                if let Some(page) = self.native_app_pages.get(&key) {
                    page.view.read(cx).send(json!({"type":"pero:app:event","event":"chat:closed"}), cx);
                }
            }
        }
        self.sync_follow(cx);
    }

    pub(crate) fn content_label(&self, item: &WorkspaceItem, cx: &App) -> (String, String) {
        match item {
            WorkspaceItem::Conversation(id) => (
                self.chat
                    .read(cx)
                    .chats
                    .iter()
                    .find(|chat| &chat.id == id)
                    .map(|chat| chat.title.display().to_owned())
                    .unwrap_or_else(|| self.t("chat.session").into()),
                "message-circle".into(),
            ),
            WorkspaceItem::PullRequest(reference) => (format!("PR #{} · {}",reference.number(),reference.repository()), "git-branch".into()),
            WorkspaceItem::Web(id) => (
                self.web_documents
                    .iter()
                    .find(|page| &page.id == id)
                    .map(|page| page.observation.title.clone())
                    .unwrap_or_else(|| self.t("web.open_url").into()),
                pero_chat_ui::icon_theme::kind_icon(
                    pero_contracts::content_icon::ContentIconKind::Web,
                    pero_theme::UiAppearance::global(cx).dark,
                ),
            ),
            item @ WorkspaceItem::Document { .. } => self.document_label(item, cx),
            WorkspaceItem::Project(key) => (
                self.project_catalog(cx)
                    .into_iter()
                    .find(|project| &project.key == key)
                    .map(|project| project.name)
                    .unwrap_or_else(|| self.t("nav.projects").into()),
                "folder".into(),
            ),
            WorkspaceItem::Task(id) => (
                self.remote
                    .tasks()
                    .iter()
                    .find(|task| task["id"].as_str() == Some(id))
                    .and_then(|task| task["title"].as_str())
                    .unwrap_or(id)
                    .into(),
                "layout-list".into(),
            ),
            WorkspaceItem::Compute => (self.t("nav.compute").into(), "cpu".into()),
            WorkspaceItem::App { name, .. } => (
                self.apps
                    .entries
                    .iter()
                    .find(|app| &app.name == name)
                    .map(|app| self.installed_app_title(&app.name, &app.display_name))
                    .unwrap_or_else(|| self.installed_app_title(name, name)),
                pero_chat_ui::icon_theme::app_icon(name, pero_theme::UiAppearance::global(cx).dark),
            ),
        }
    }

    pub(crate) fn content_tabs(&self, ruled: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let current = self.navigation.current();
        let chat = self.chat.read(cx);
        let attention = chat
            .active_chat
            .and_then(|index| chat.chats.get(index))
            .and_then(|chat| {
                if chat.permission.is_some() {
                    Some("chat.permission")
                } else if chat.error.is_some() {
                    Some("chat.failed")
                } else if chat.state == pero_chat_ui::session_state::SessionState::AuthRequired {
                    Some("chat.signin")
                } else if chat.busy() {
                    Some("chat.thinking")
                } else {
                    None
                }
            });
        let chat_label = if self.chat_dock_visible() {
            self.t("chat.close_panel").to_string()
        } else if let Some(attention) = attention {
            format!("{} · {}", self.t("chat.open_panel"), self.t(attention))
        } else {
            self.t("chat.open_panel").to_string()
        };
        div()
            .id("workspace-tabs")
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .items_center()
            .when(ruled, |el| el.border_b_1().border_color(p.border).bg(p.color("bg")))
            .child(
                div()
                    .id("workspace-tab-scroll")
                    .gap(px(pero_theme::SPACE_4)).px(px(pero_theme::SPACE_4))
                    .flex_1()
                    .min_w_0()
                    .h_full()
                    .flex()
                    .items_center()
                    .overflow_x_scroll()
                    .track_scroll(&self.tab_scroll)
                    .children(
                        self.navigation
                            .titlebar_tabs()
                            .map(|item| {
                                let (title, icon) = self.content_label(item, cx);
                                let select = item.clone();
                                let close = item.clone();
                                pero_theme::content_tab(
                                    SharedString::from(format!("workspace-tab-shell:{item:?}")),
                                    pero_theme::ContentTabState { active: current == Some(item), focused: true, pinned: false },
                                    pero_theme::Chrome::from_app(cx),
                                )
                                    .on_mouse_down(MouseButton::Left, |_, _, cx| { cx.stop_propagation(); })
                                    .child(
                                        Button::new(SharedString::from(format!(
                                            "workspace-tab:{item:?}"
                                        )))
                                        .custom(ButtonCustomVariant::new(cx).foreground(
                                            if current == Some(item) { p.accent_text } else { p.text_muted }
                                        ))
                                        .small()
                                        .flex_1()
                                        .min_w_0()
                                        .h(px(pero_theme::UiAppearance::global(cx)
                                            .typography
                                            .control_height()))
                                        .justify_start()
                                        .text_size(pero_theme::Chrome::from_app(cx).text(pero_theme::TYPE_TAB))
                                        .icon(
                                            Icon::default()
                                                .size(pero_theme::Chrome::from_app(cx).text(pero_theme::CONTENT_TAB_ICON))
                                                .path(pero_chat_ui::icon_theme::asset_path(&icon)),
                                        )
                                        .child(pero_theme::content_tab_label(title.clone().into(), false, pero_theme::Chrome::from_app(cx)))
                                        .tooltip(title.clone())
                                        .accessibility_label(title.clone())
                                        .toggled(current == Some(item))
                                        .on_click(
                                            cx.listener(move |this, _, window, cx| {
                                                this.activate_content(select.clone(), window, cx)
                                            }),
                                        ),
                                    )
                                    .child(
                                        pero_theme::content_tab_close_button(SharedString::from(format!(
                                            "workspace-tab-close:{item:?}"
                                        )), pero_theme::Chrome::from_app(cx), cx)
                                        .icon(Icon::default().size(pero_theme::Chrome::from_app(cx).text(pero_theme::CONTENT_TAB_ICON)).path("icons/x.svg"))
                                        .tooltip(self.t("workspace.close_tab"))
                                        .accessibility_label(format!(
                                            "{}: {title}",
                                            self.t("workspace.close_tab")
                                        ))
                                        .on_click(
                                            cx.listener(move |this, _, window, cx| {
                                                this.close_content(&close, window, cx)
                                            }),
                                        ),
                                    )
                            }),
                    )
                    .child(div().flex_1().h_full().min_w(px(8.))),
            )
            .when(self.navigation.route().can_clone_pane(), |strip| {
                strip.child(self.workspace_split_control(cx))
            })
            .when(
                matches!(self.navigation.current(), Some(WorkspaceItem::App { .. })),
                |el| {
                    el.child(
                        Button::new("workspace-apps")
                            .ghost()
                            .small()
                            .w(px(32.))
                            .h(px(pero_theme::UiAppearance::global(cx)
                                .typography
                                .control_height()))
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
                !matches!(self.layout.chat, ChatPlacement::Slot | ChatPlacement::Float)
                    && (self.navigation.page() == WorkbenchPage::Tasks
                        || self.navigation.page() == WorkbenchPage::Web
                        || matches!(self.navigation.current(), Some(WorkspaceItem::App { .. }))),
                |el| {
                    el.child(
                        Button::new("workspace-chat-toggle")
                            .ghost()
                            .small()
                            .h(px(pero_theme::UiAppearance::global(cx)
                                .typography
                                .control_height()))
                            .mr(px(8.))
                            .icon(Icon::default().path(if self.chat_dock_visible() {
                                "icons/panel-right-close.svg"
                            } else {
                                "icons/panel-right-open.svg"
                            }))
                            .label(chat_label)
                            .toggled(self.chat_dock_visible())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.set_chat_dock(!this.preferences.layout.chat_open, cx)
                            })),
                    )
                },
            )
            .when(
                cfg!(target_family = "wasm")
                    && self.layout.chat == ChatPlacement::Dock
                    && self
                        .navigation
                        .pane_layout()
                        .is_none_or(|layout| layout.leaves().len() <= 1)
                    && matches!(self.navigation.current(), Some(WorkspaceItem::App { .. })),
                |el| {
                    el.child(
                        Button::new("workspace-chat-floating")
                            .ghost()
                            .small()
                            .label(self.t(if self.floating_chat {
                                "chat.dock"
                            } else {
                                "chat.float"
                            }))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.floating_chat = !this.floating_chat;
                                this.floating_chat_expanded = false;
                                this.sync_follow(cx);
                                cx.notify();
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
                        .absolute()
                        .top_0()
                        .left_0()
                        .w(px(4.))
                        .h_full()
                        .child(div().absolute().left_0().top_0().w(px(1.)).h_full()
                            .when(self.chat_resize_focus.is_focused(window), |el| el.bg(p.focus)))
                        .cursor(CursorStyle::ResizeLeftRight)
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, event: &MouseDownEvent, window, cx| {
                                this.chat_resize_focus.focus(window, cx);
                                if event.click_count == 2 {
                                    this.preferences.layout.resize_chat(
                                        pero_contracts::workbench::LayoutPreferences::default().chat_width());
                                    this.save_preferences(this.preferences.clone(), cx);
                                } else {
                                    this.resizing_chat = true;
                                }
                                cx.stop_propagation();
                                cx.notify();
                            }),
                        )
                        .on_key_down(cx.listener(|this, event: &KeyDownEvent, _, cx| {
                            let width = match event.keystroke.key.as_str() {
                                "left" => this.preferences.layout.chat_width() + 20.,
                                "right" => this.preferences.layout.chat_width() - 20.,
                                "enter" => pero_contracts::workbench::LayoutPreferences::default().chat_width(),
                                _ => return,
                            };
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
        self.remember_current_location(cx);
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
