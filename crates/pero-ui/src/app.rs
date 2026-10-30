#[cfg(all(feature = "native", not(target_family = "wasm")))]
pub(crate) use crate::native::{request_locale, send_probe, session_command};
use crate::theme::Palettes;
use crate::{
    layout::WorkspaceLayout,
    workspace::{
        ConversationTab, WorkbenchPage, WorkspaceItem, WorkspaceNavigation, WorkspaceRoute,
    },
};
use gpui_kit::{
    component::input::{InputEvent, InputState},
    *,
};
use pero_chat_ui::{ChatAction, ChatPanel};
use pero_contracts::{EchoRequest, HostEvent, MAX_TEXT_CHARS};
use serde_json::{Value, json};
#[cfg(target_family = "wasm")]
use std::{borrow::Cow, cell::RefCell, rc::Rc, sync::Arc};
#[cfg(target_family = "wasm")]
use wasm_bindgen::prelude::*;

#[cfg(target_family = "wasm")]
thread_local! {
    static APPLICATION: RefCell<Option<ApplicationHandle>> = const { RefCell::new(None) };
    static WORKBENCH: RefCell<Option<(AnyWindowHandle, WeakEntity<Workbench>)>> = const { RefCell::new(None) };
}

#[cfg(target_family = "wasm")]
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = window, js_name = peroSendProbe, catch)]
    fn send_probe(json: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = window, js_name = peroSetLocale, catch)]
    pub(crate) fn request_locale(locale: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = window, js_name = peroSessionCommand, catch)]
    pub(crate) fn session_command(json: &str) -> Result<(), JsValue>;
}

pub(crate) struct Workbench {
    pub workspace_focus:FocusHandle,
    pub input: Entity<InputState>,
    pub documents:Vec<crate::documents::WorkspaceDocument>,
    #[cfg(not(target_family="wasm"))]
    pub native_web_pages:std::collections::BTreeMap<String,crate::web_documents::WorkspaceNativeWeb>,
    pub web_documents:Vec<pero_contracts::web_document::WebDocument>,
    pub web_address:Entity<InputState>,
    pub web_entry_open:bool,
    pub web_surface:String,
    pub locale: String,
    pub input_locale: String,
    pub palettes: Palettes,
    pub system_dark: bool,
    pub preferences: pero_contracts::workbench::WorkbenchPreferences,
    pub preferences_status: crate::settings_menu::PreferenceSaveState,
    pub settings_menu_open: bool,
    pub computer: Option<pero_contracts::computer_runtime::ComputerUseState>,
    pub settings_panel: Option<Entity<crate::settings_view::SettingsPanel>>,
    #[cfg(not(target_family = "wasm"))]
    pub settings_window: Option<AnyWindowHandle>,
    pub settings_subscriptions: Vec<Subscription>,
    pub recent_tasks: Vec<String>,
    pub selected_project: Option<String>,
    pub project_binding: Entity<InputState>,
    pub collapsed_projects: std::collections::HashSet<String>,
    pub project_tab: crate::projects::ProjectTab,
    pub(crate) local_roadmap: crate::local_roadmap::RoadmapState,
    pub task_status: crate::projects::TaskStatusFilter,
    pub pending_project_workspace: bool,
    pub navigation: WorkspaceNavigation,
    pub remote: crate::remote::RemoteState,
    pub local_execution: crate::local_execution::LocalExecution,
    pub contribution: crate::contributions::ContributionState,
    pub apps: crate::apps::AppCatalog,
    pub app_surface: String,
    pub layout: WorkspaceLayout,
    pub resizing_chat: bool,
    pub chat_resize_focus: FocusHandle,
    pub tab: ConversationTab,
    pub connected: bool,
    pub pending: Option<String>,
    pub next_request: u64,
    pub received: usize,
    pub last_echo: String,
    pub error: Option<String>,
    pub events: Vec<HostEvent>,
    pub chat: Entity<ChatPanel>,
    pub search: Entity<InputState>,
    pub workspace: String,
    pub workspace_repositories: Vec<pero_contracts::workbench::WorkspaceRepository>,
    pub task_scroll: ScrollHandle,
    pub tab_scroll: ScrollHandle,
    pub revealed_tab: Option<(WorkspaceItem, usize, Pixels)>,
    /// A further task page was requested and its result has not arrived yet.
    pub task_more_pending: bool,
    pub(crate) _subscriptions: Vec<Subscription>,
}

impl Workbench {
    pub(crate) fn new(
        palettes: Palettes,
        dark: bool,
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.bind_keys([
            KeyBinding::new("cmd-l",crate::web_documents::OpenWeb,None),
            KeyBinding::new("ctrl-l",crate::web_documents::OpenWeb,None),
            KeyBinding::new("cmd-o",crate::workspace_view::OpenDocument,None),
            KeyBinding::new("ctrl-o",crate::workspace_view::OpenDocument,None),
            KeyBinding::new("ctrl-tab", crate::workspace_view::NextContent, None),
            KeyBinding::new("ctrl-shift-tab", crate::workspace_view::PreviousContent, None),
        ]);
        let workspace_focus=cx.focus_handle();
        workspace_focus.focus(window,cx);
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(pero_contracts::i18n::text(&locale, "input.placeholder"))
        });
        let subscriptions = vec![cx.subscribe_in(&input, window, |this, _, event, _, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                this.send(cx);
            }
            cx.notify();
        })];
        let chat = cx.new(|cx| {let mut panel=ChatPanel::new(locale.clone(),window,cx);panel.can_open_documents=true;panel});
        let search = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(pero_contracts::i18n::text(&locale, "sessions.search"))
        });
        let mut subscriptions = subscriptions;
        subscriptions.push(cx.observe_in(&chat, window, |this, _, window, cx| {
            this.reconcile_content(window, cx);
            this.sync_follow(cx);
            cx.notify();
        }));
        subscriptions.push(cx.subscribe_in(&chat, window, |this, _, event, window, cx| {
            match event {
                ChatAction::Command(command) => this.command(
                    serde_json::to_value(command).expect("serializable command"),
                    cx,
                ),
                ChatAction::OpenDocument(document)=>this.open_document(document.clone(),window,cx),
                ChatAction::Content(intent) => this.command(serde_json::to_value(intent).expect("content intent"), cx),
                ChatAction::ChooseWorkspace => {
                    this.command(json!({"action":"choose_workspace"}), cx)
                }
                ChatAction::ChooseContext { kind, request_id } => this.command(
                    json!({"action":"choose_context","kind":kind,"request_id":request_id}),
                    cx,
                ),
                ChatAction::PreviewContext { reference, thread_id } => {
                    if cfg!(target_family = "wasm") {
                        this.command(json!({"action":"app_context_preview","reference":reference,"thread_id":thread_id}),cx);
                    }
                }
                ChatAction::Selected { thread_id } => {
                    if cfg!(target_family = "wasm") {
                        this.command(json!({"action":"app_use_selection","thread_id":thread_id}),cx);
                    }
                }
                ChatAction::Activated => {
                    if !this.chat_dock_visible() {
                        let index = this.chat.read(cx).active_chat;
                        this.focus_chat(index, ConversationTab::Chat, cx);
                    }
                    this.tab = ConversationTab::Chat;
                    this.error = None;
                    this.sync_follow(cx);
                }
                ChatAction::ReturnToReview => {
                    this.remote.public_contributions = true;
                    this.navigate(WorkbenchPage::Tasks, cx);
                    this.sync_follow(cx);
                }
            }
            cx.notify();
        }));
        subscriptions.push(cx.subscribe(&search, |_, _, _: &InputEvent, cx| cx.notify()));
        let web_address=cx.new(|cx|InputState::new(window,cx).placeholder("https://"));
        subscriptions.push(cx.subscribe_in(&web_address,window,|this,input,event:&InputEvent,window,cx| {
            if matches!(event,InputEvent::PressEnter {..}) {
                let url=input.read(cx).value().to_string();
                let command=match this.navigation.current() {
                    Some(WorkspaceItem::Web(id))=>json!({"action":"web_navigate","id":id,"url":url}),
                    _=>json!({"action":"web_open","url":url}),
                };
                this.web_command(command,window,cx);
                this.workspace_focus.focus(window,cx);
            }
        }));
        let project_binding = cx.new(|cx| InputState::new(window, cx));
        subscriptions.push(cx.subscribe(&project_binding, |this, _, event, cx| {
            if matches!(event, InputEvent::Change) {
                this.preferences_status = crate::settings_menu::PreferenceSaveState::Idle;
            }
            cx.notify();
        }));
        let remote = crate::remote::RemoteState::new(window, cx);
        let local_execution = crate::local_execution::LocalExecution::new(&locale, window, cx);
        let navigation = WorkspaceNavigation::default();
        let preferences = pero_contracts::workbench::WorkbenchPreferences::default();
        let layout = WorkspaceLayout::resolve(
            window.viewport_size().width.into(),
            navigation.route(),
            ConversationTab::Chat,
            &preferences.layout,
            false,
        );
        Self {
            workspace_focus,
            #[cfg(not(target_family="wasm"))]
            native_web_pages:Default::default(),
            web_documents:vec![],web_address,web_entry_open:false,web_surface:String::new(),
            remote,
            local_execution,
            contribution: Default::default(),
            apps: crate::apps::AppCatalog::default(),
            app_surface: String::new(),
            layout,
            resizing_chat: false,
            chat_resize_focus: cx.focus_handle().tab_stop(true),
            input,
            documents:vec![],
            input_locale: String::new(),
            locale,
            palettes,
            system_dark: dark,
            preferences,
            preferences_status: Default::default(),
            settings_menu_open: false,
            computer: None,
            settings_panel: None,
            #[cfg(not(target_family = "wasm"))]
            settings_window: None,
            settings_subscriptions: Vec::new(),
            recent_tasks: Vec::new(),
            selected_project: None,
            project_binding,
            collapsed_projects: Default::default(),
            project_tab: Default::default(),
            local_roadmap: Default::default(),
            task_status: Default::default(),
            pending_project_workspace: false,
            navigation,
            tab: ConversationTab::Chat,
            connected: false,
            pending: None,
            next_request: 0,
            received: 0,
            last_echo: String::new(),
            error: None,
            events: Vec::new(),
            chat,
            search,
            workspace: String::new(),
            workspace_repositories: vec![],
            task_scroll: ScrollHandle::new(),
            tab_scroll: ScrollHandle::new(),
            revealed_tab: None,
            task_more_pending: false,
            _subscriptions: subscriptions,
        }
    }

    pub fn sync_follow(&mut self, cx: &mut Context<Self>) {
        let origin=match self.navigation.current() {
            Some(WorkspaceItem::App {name,panel})=>Some(pero_contracts::content_origin::ContentOrigin::App {app:name.clone(),panel:panel.clone()}),
            Some(WorkspaceItem::Conversation(id))=>Some(pero_contracts::content_origin::ContentOrigin::Conversation {thread_id:id.clone()}),
            Some(WorkspaceItem::Document {origin,..})=>Some(origin.clone()),
            _=>None,
        };
        let scope=origin.and_then(|origin|match origin {
            pero_contracts::content_origin::ContentOrigin::App {app,panel}=>Some(pero_contracts::AppChatScope {app,panel}),
            origin=>origin.thread_id().and_then(|id|self.chat.read(cx).chats.iter().find(|chat|chat.id==id).and_then(|chat|chat.scope.clone())),
        });
        let visible = self.chat_visible();
        let show_return = self
            .chat
            .read(cx)
            .active_chat
            .and_then(|i| self.chat.read(cx).chats.get(i))
            .is_some_and(|chat| {
                self.contribution.data["local"]["thread_id"].as_str() == Some(chat.id.as_str())
            });
        self.chat.update(cx, |chat, cx| {
            if !visible { chat.set_visible(false, cx); }
            chat.set_scope(scope, cx);
            chat.set_visible(visible, cx);
            chat.show_return_to_review = show_return;
        });
    }

    pub(crate) fn navigate(&mut self, page: WorkbenchPage, cx: &mut Context<Self>) {
        self.navigation.show(page);
        self.sync_follow(cx);
        cx.notify();
    }

    pub fn focus_chat(
        &mut self,
        index: Option<usize>,
        tab: ConversationTab,
        cx: &mut Context<Self>,
    ) {
        self.tab = tab;
        let selected = index
            .and_then(|i| self.chat.read(cx).chats.get(i))
            .map(|chat| (chat.id.clone(), chat.scope.clone()));
        if let Some((id, scope)) = selected {
            self.navigation.open(WorkspaceItem::Conversation(id));
            self.chat.update(cx, |chat, cx| {
                chat.set_scope(scope, cx);
                chat.focus_chat(index, cx);
            });
        } else {
            self.navigation.show(WorkbenchPage::Conversation);
            self.chat.update(cx, |chat, cx| chat.focus_chat(None, cx));
        }
        self.sync_follow(cx);
        cx.notify();
    }

    pub fn new_chat(&mut self, cx: &mut Context<Self>) {
        self.navigation.show(WorkbenchPage::Conversation);
        self.tab = ConversationTab::Chat;
        self.error = None;
        self.chat
            .update(cx, |chat, cx| chat.new_chat_in_scope(None, cx));
        let index = self.chat.read(cx).active_chat;
        self.focus_chat(index, ConversationTab::Chat, cx);
    }

    pub fn command(&mut self, value: Value, cx: &mut Context<Self>) {
        if value["action"] == "remote_select" {
            self.record_task_selection(value["task_id"].as_str().map(str::to_owned));
            self.sync_follow(cx);
        }
        if value["action"] == "choose_workspace"
            && (self.navigation.page() != WorkbenchPage::Tasks
                || self.project_tab != crate::projects::ProjectTab::Settings)
        {
            self.pending_project_workspace = false;
        }
        if session_command(&value.to_string()).is_err() {
            self.chat.update(cx, |panel, cx| {
                if let Some(chat) = panel
                    .active_chat
                    .and_then(|index| panel.chats.get_mut(index))
                {
                    chat.pending_model = None;
                    chat.pending_setting = None;
                }
                cx.notify();
            });
            self.error = Some("error.connection".into());
        }
        cx.notify();
    }

    pub fn send(&mut self, cx: &mut Context<Self>) {
        let text = self.input.read(cx).value().to_string();
        if !self.connected || self.pending.is_some() {
            return;
        }
        if text.trim().is_empty() || text.chars().count() > MAX_TEXT_CHARS {
            self.error = Some("error.input_length".into());
            cx.notify();
            return;
        }
        self.next_request += 1;
        let id = format!("probe-{}", self.next_request);
        let request = EchoRequest {
            id: id.clone(),
            text,
        };
        self.error = None;
        self.pending = Some(id);
        if send_probe(&serde_json::to_string(&request).expect("serializable request")).is_err() {
            self.error = Some("error.send".into());
            self.pending = None;
        }
        cx.notify();
    }

    pub(crate) fn receive(
        &mut self,
        event: HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let event_kind = event.kind.clone();
        let feature_handled = self.receive_web(&event,window,cx) || self.receive_document(&event,window,cx)
            || self.receive_computer(&event, cx) || self.receive_roadmap(&event, cx)
            || self.receive_local_execution(&event, cx)
            || self.receive_contribution(&event, cx)
            || self.receive_apps(&event, cx)
            || self.receive_remote(&event, cx);
        if !feature_handled {
            let handled = self.chat.update(cx, |chat, cx| chat.receive(&event, cx));
            if event.kind == "agents" {
                self.workspace = event.text.clone();
            }
            if event.kind == "workspace" {
                self.workspace = event.text.clone();
                if let Ok(identity) = serde_json::from_value::<
                    pero_contracts::workbench::WorkspaceIdentity,
                >(event.data.clone())
                {
                    self.workspace_repositories
                        .retain(|entry| entry.workspace != event.text);
                    if let Some(repository) = identity.repository {
                        self.workspace_repositories.push(
                            pero_contracts::workbench::WorkspaceRepository {
                                workspace: event.text.clone(),
                                repository,
                            },
                        );
                    }
                }
                self.reconcile_project_selection(cx);
                if self.pending_project_workspace {
                    self.pending_project_workspace = false;
                    if let Some(id) = self
                        .current_project(cx)
                        .and_then(|project| project.shared_id)
                    {
                        let mut preferences = self.preferences.clone();
                        preferences.bind(event.text.clone(), id);
                        self.save_preferences(preferences, cx);
                        self.selected_project = Some(format!("workspace:{}", event.text));
                    }
                }
            }
            if !handled || matches!(event.kind.as_str(), "ready" | "disconnected" | "settings") {
                match event.kind.as_str() {
                    "workbench_settings" => {
                        if let Ok(preferences) = serde_json::from_value::<
                            pero_contracts::workbench::WorkbenchPreferences,
                        >(event.data.clone())
                        {
                            self.preferences = preferences;
                            if self.preferences_status
                                == crate::settings_menu::PreferenceSaveState::Saving
                            {
                                self.preferences_status =
                                    crate::settings_menu::PreferenceSaveState::Saved;
                            }
                            self.install_appearance(cx);
                            self.error = None;
                        }
                    }
                    "settings" => {
                        self.locale = pero_contracts::i18n::normalize(&event.text).into();
                        for open in &self.documents {open.view.update(cx,|view,cx|{view.locale=self.locale.clone();cx.notify();});}
                        gpui_kit::component::set_locale(&self.locale);
                        self.chat
                            .update(cx, |chat, cx| chat.set_locale(&self.locale, cx));
                    }
                    "ready" => self.connected = true,
                    "disconnected" => {
                        self.connected = false;
                        self.pending = None;
                        self.chat.update(cx, |panel, cx| {
                            for chat in &mut panel.chats {
                                chat.pending_model = None;
                            }
                            cx.notify();
                        });
                        self.error = Some(event.message_key.clone().unwrap_or_else(|| {
                            if event.text.is_empty() {
                                "error.connection".into()
                            } else {
                                event.text.clone()
                            }
                        }));
                    }
                    "error" => {
                        if event.message_key.as_deref() == Some("error.preferences") {
                            self.preferences_status =
                                crate::settings_menu::PreferenceSaveState::Idle;
                        }
                        self.error = Some(event.message_key.clone().unwrap_or_else(|| {
                            if event.text.is_empty() {
                                "error.connection".into()
                            } else {
                                event.text.clone()
                            }
                        }));
                        if event.request_id == self.pending {
                            self.pending = None;
                        }
                    }
                    "echo" if event.request_id == self.pending => {
                        self.pending = None;
                        self.received += 1;
                        self.last_echo = event.text.clone();
                    }
                    _ => {}
                }
                self.events.push(event);
                if self.events.len() > 100 {
                    self.events.remove(0);
                }
            }
        }
        if event_kind == "replay" {
            let index = match self.navigation.route() {
                WorkspaceRoute::Page(WorkbenchPage::Conversation) => self.chat.read(cx).active_chat,
                WorkspaceRoute::Content(WorkspaceItem::Conversation(id)) => self
                    .chat
                    .read(cx)
                    .chats
                    .iter()
                    .position(|chat| &chat.id == id),
                _ => None,
            };
            if let Some(index) = index {
                self.focus_chat(Some(index), self.tab, cx);
            }
        }
        if event_kind == "remote_open"
            && matches!(
                self.navigation.route(),
                WorkspaceRoute::Page(WorkbenchPage::Tasks)
            )
        {
            let id = self.remote.data["selected_task_id"]
                .as_str()
                .map(str::to_owned);
            self.record_task_selection(id);
        }
        if matches!(event_kind.as_str(), "workbench_settings" | "settings" | "error" | "disconnected") {
            self.sync_settings_panel(cx);
        }
        self.apply_local_execution(window, cx);
        self.reconcile_content(window, cx);
        self.sync_follow(cx);
        cx.notify();
    }
    pub(crate) fn install_appearance(&mut self, cx: &mut Context<Self>) {
        pero_theme::ResolvedAppearance::resolve(&self.preferences, self.system_dark, &self.palettes).install(cx);
    }
    pub fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }
    pub fn event_text(&self, event: &HostEvent) -> String {
        event
            .message_key
            .as_deref()
            .map(|key| self.t(key).to_string())
            .unwrap_or_else(|| event.text.clone())
    }
}

#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn run(theme_json: &str, dark: bool, locale: &str) -> Result<(), JsValue> {
    let locale = pero_contracts::i18n::normalize(locale).to_string();
    console_error_panic_hook::set_once();
    let palettes: Palettes =
        serde_json::from_str(theme_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    gpui_kit::platform::web_init();
    use gpui_kit::web::{CanvasFontFallback, WebBackendPreference, WebPlatform};
    let platform = Rc::new(WebPlatform::new_with_backend_and_font_fallback(
        false,
        WebBackendPreference::Auto,
        CanvasFontFallback::EmojiAndCjk,
    ));
    let http = Arc::new(platform.fetch_http_client());
    let handle = Application::with_platform(platform)
        .with_assets(crate::assets::UiAssets)
        .with_http_client(http)
        .run_embedded(move |cx| {
            // Catalog glyphs are bundled; arbitrary CJK text uses the canvas fallback above.
            cx.text_system()
                .add_fonts(vec![
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Inter-Regular.ttf").as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-regular.ttf")
                            .as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-bold.ttf").as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/IBMPlexSans-Regular.ttf")
                            .as_slice(),
                    ),
                    Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/JetBrainsMono-Regular.ttf")
                            .as_slice(),
                    ),
                ])
                .expect("bundled fonts");
            gpui_kit::init(cx);
            // Wasm has no target_os=macos; bind ordinary editing to the actual OS.
            if cx.platform_info().is_mac() {
                use gpui_kit::component::input::{
                    Copy, Cut, DeleteToBeginningOfLine, DeleteToEndOfLine, MoveEnd, MoveHome,
                    Paste, Redo, SelectAll, Undo,
                };
                cx.bind_keys([
                    KeyBinding::new("cmd-a", SelectAll, Some("Input")),
                    KeyBinding::new("cmd-c", Copy, Some("Input")),
                    KeyBinding::new("cmd-x", Cut, Some("Input")),
                    KeyBinding::new("cmd-v", Paste, Some("Input")),
                    KeyBinding::new("cmd-z", Undo, Some("Input")),
                    KeyBinding::new("cmd-shift-z", Redo, Some("Input")),
                    KeyBinding::new("cmd-left", MoveHome, Some("Input")),
                    KeyBinding::new("cmd-right", MoveEnd, Some("Input")),
                    KeyBinding::new("cmd-backspace", DeleteToBeginningOfLine, Some("Input")),
                    KeyBinding::new("cmd-delete", DeleteToEndOfLine, Some("Input")),
                ]);
            }
            gpui_kit::component::set_locale(&locale);
            pero_theme::ResolvedAppearance::resolve(&Default::default(), dark, &palettes).install(cx);
            let (window, view) =
                gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                    let view = cx.new(|cx| Workbench::new(palettes, dark, locale, window, cx));
                    view
                })
                .expect("workbench window");
            WORKBENCH.with(|slot| *slot.borrow_mut() = Some((window.into(), view.downgrade())));
        });
    APPLICATION.with(|slot| *slot.borrow_mut() = Some(handle));
    Ok(())
}

#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn receive_host_event(json: &str) -> Result<(), JsValue> {
    let event: HostEvent =
        serde_json::from_str(json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    if event.version != pero_contracts::PROTOCOL_VERSION {
        return Err(JsValue::from_str("Unsupported event version"));
    }
    update(|ui, window, cx| ui.receive(event, window, cx));
    Ok(())
}

#[cfg(target_family = "wasm")]
fn update(f: impl FnOnce(&mut Workbench, &mut Window, &mut Context<Workbench>)) {
    APPLICATION.with(|app| {
        if let Some(app) = app.borrow().as_ref() {
            app.update(|cx| {
                WORKBENCH.with(|view| {
                    if let Some((window, view)) = view.borrow().as_ref() {
                        let _ = window.update(cx, |_, window, cx| {
                            view.update(cx, |ui, cx| f(ui, window, cx))
                        });
                    }
                })
            });
        }
    });
}

/// Closing or reloading must not silently discard editable source buffers.
#[cfg(target_family="wasm")]
#[wasm_bindgen]
pub fn has_unsaved_documents()->bool {
    let mut dirty=false;
    update(|ui,_,cx|dirty=ui.has_unsaved_documents(cx));
    dirty
}

/// Read-only diagnostic state. Tests still enter text through Chromium input.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn snapshot() -> String {
    let mut value = serde_json::json!({"ready": false});
    update(|ui, _, cx| {
        value = serde_json::json!({
            "ready": true, "remote": ui.remote.snapshot(cx), "contribution": ui.contribution.data, "publicContributions": ui.remote.public_contributions, "connected": ui.connected, "input": ui.input.read(cx).value().as_ref(),
            "received": ui.received, "lastEcho": ui.last_echo, "pending": ui.pending,
            "error": ui.error, "dark": pero_theme::UiAppearance::global(cx).dark, "navigation": ui.navigation.page().legacy_index(),
            "appearance": appearance_snapshot(cx), "preferences":ui.preferences,"selectedProject":ui.selected_project,"projectTab":ui.project_tab,"taskStatus":ui.task_status,
            "projects":ui.project_catalog(cx),"workspaceRepositories":ui.workspace_repositories,
            "apps": ui.apps.entries, "activeApp": ui.navigation.current().and_then(|item| match item { WorkspaceItem::App { name, panel } => Some(json!({"name":name,"panel":panel})), _ => None }), "appError": ui.apps.error, "appsLoading": ui.apps.loading, "appChatOpen": ui.preferences.layout.chat_open,
            "locale": ui.locale, "labels": { "tasks": ui.t("nav.tasks"), "send": ui.t("probe.send") },
            "tab": ui.tab.legacy_index(), "events": ui.events, "workspace": ui.workspace,
        });
        value["chatVisible"] = serde_json::json!(ui.chat_visible());
        value["webDocuments"]=json!(ui.web_documents);
        value["webAddress"]=json!(ui.web_address.read(cx).value().as_ref());
        value["webEntryOpen"]=json!(ui.web_entry_open);
        value["documents"]=json!(ui.documents.iter().map(|open|json!({"item":open.item,"title":open.view.read(cx).document.title,"reader":open.view.read(cx).snapshot(cx)})).collect::<Vec<_>>());
        value["contentTabs"] = serde_json::json!(ui.navigation.items());
        value["activeContent"] = serde_json::json!(ui.navigation.current());
        if let Some(index)=ui.navigation.current().and_then(|item|ui.navigation.items().iter().position(|candidate|candidate==item)) {
            if let Some(bounds)=ui.tab_scroll.bounds_for_item(index) {
                let strip=ui.tab_scroll.bounds();let offset=ui.tab_scroll.offset().x;
                value["activeTabBounds"]=json!({"left":f32::from(bounds.left()+offset),"right":f32::from(bounds.right()+offset),"stripLeft":f32::from(strip.left()),"stripRight":f32::from(strip.right())});
            }
        }
        value["chatPanelWidth"] = serde_json::json!(ui.preferences.layout.chat_width());
        value["preferencesStatus"] = serde_json::json!(ui.preferences_status);
        value["settingsOpen"] = serde_json::json!(ui.settings_panel.is_some());
        value["settings"] = ui.settings_panel.as_ref().map(|panel| panel.read(cx).snapshot(cx)).unwrap_or_default();
        value["settingsSearch"] = value["settings"]["query"].clone();
        value["projectBinding"] = serde_json::json!(ui.project_binding.read(cx).value().as_ref());
        value["sidebarSearch"] = serde_json::json!(ui.search.read(cx).value().as_ref());
        if let Some(fields) = ui.chat.read(cx).snapshot(cx).as_object() {
            value.as_object_mut().expect("workbench snapshot").extend(
                fields
                    .iter()
                    .filter(|(key, _)| {
                        !matches!(
                            key.as_str(),
                            "connected" | "error" | "dark" | "locale" | "workspace"
                        )
                    })
                    .map(|(key, value)| (key.clone(), value.clone())),
            );
        }
        value["localRoadmap"] = serde_json::json!(ui.local_roadmap);
        value["localExecution"] = ui.local_execution.snapshot(&ui.locale, cx);
    });
    value.to_string()
}

/// Browser clipboard images enter through this UI-only bridge; Host validates the turn.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn paste_image(data: &str, mime_type: &str) {
    update(|ui, _, cx| {
        ui.chat.update(cx, |chat, cx| {
            chat.queue_composer_image(data.to_owned(), mime_type.to_owned(), cx)
        })
    });
}

#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub fn set_system_theme(dark: bool) {
    update(|ui, _, cx| {
        ui.system_dark = dark;
        ui.install_appearance(cx);
        cx.notify();
    });
}

#[cfg(target_family = "wasm")]
fn appearance_snapshot(cx: &App) -> serde_json::Value {
    serde_json::to_value(pero_theme::UiAppearance::global(cx)).expect("serializable appearance")
}
