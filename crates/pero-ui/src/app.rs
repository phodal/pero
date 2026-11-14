#[cfg(target_family="wasm")]
use crate::workspace::LegacyPage;
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
use std::{cell::RefCell, rc::Rc, sync::Arc};
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
    #[wasm_bindgen(js_namespace = window, js_name = peroWindowCloseResult)]
    pub(crate) fn window_close_result(ready:bool);
    #[wasm_bindgen(js_namespace = window, js_name = peroSetLocale, catch)]
    pub(crate) fn request_locale(locale: &str) -> Result<(), JsValue>;
    #[wasm_bindgen(js_namespace = window, js_name = peroSessionCommand, catch)]
    pub(crate) fn session_command(json: &str) -> Result<(), JsValue>;
}

pub(crate) struct Workbench {
    pub terminal: crate::terminal::TerminalDock,
    pub view_bounds: crate::view_bounds::WorkbenchBounds,
    pub workspace_focus:FocusHandle,
    pub input: Entity<InputState>,
    pub documents:Vec<crate::documents::WorkspaceDocument>,
    pub pane_views:Vec<crate::workspace_pane_views::PaneReader>,
    pub pane_tabs:crate::workspace_pane_tabs::PaneTabsUiState,
    pub pane_surfaces:Vec<pero_contracts::workspace_panes::PaneSurface>,
    pub pane_split_bounds:Vec<(u64,pero_contracts::workspace_panes::PaneBounds)>,
    pub pane_resize:Option<crate::workspace_pane_views::PaneResize>,
    pub pending_close:Option<crate::workspace_close::ClosePlan>,
    pub pending_save_as:Option<crate::document_save_as::PendingSaveAs>,
    pub save_as_feedback:Option<crate::document_save_as::SaveAsFeedback>,
    #[cfg(not(target_family="wasm"))]
    pub(crate) native_panel_slots:std::collections::BTreeMap<String,crate::native_app_panels::NativePanelSlot>,
    #[cfg(not(target_family="wasm"))]
    pub native_app_pages:std::collections::BTreeMap<(String,String),crate::native_app_surface::RetainedApp>,
    #[cfg(all(feature = "native", not(target_family = "wasm")))]
    pub(crate) mcp_app_wait: Option<crate::mcp_app::McpAppWait>,
    #[cfg(not(target_family="wasm"))]
    pub artifact_preview:Option<crate::native_artifact_preview::RetainedArtifactPreview>,
    #[cfg(not(target_family="wasm"))]
    pub(crate) native_mcp_views:std::collections::BTreeMap<(String,String),crate::native_mcp_view::NativeMcpView>,
    #[cfg(not(target_family="wasm"))]
    pub native_web_pages:std::collections::BTreeMap<String,crate::web_documents::WorkspaceNativeWeb>,
    pub(crate) discovered_pull_requests: std::collections::BTreeSet<pero_contracts::pull_request::PullRequestRef>,
    pub(crate) pull_requests:Vec<crate::pull_requests::PullRequestContent>,
    pub(crate) pull_request_index: crate::pull_request_index::PullRequestIndex,
    pub(crate) pull_request_poll: u64,
    pub(crate) pull_request_poll_armed: bool,
    pub(crate) restored_pull_requests: Vec<pero_contracts::pull_request::PullRequestReading>,
    pub(crate) pending_citations: Vec<(String, crate::source_navigation::PendingCitation)>,
    pub(crate) plan_sessions: Vec<(String, String)>,
    pub web_documents:Vec<pero_contracts::web_document::WebDocument>,
    pub web_address:Entity<InputState>,
    pub web_entry_open:bool,
    #[cfg(target_family = "wasm")]
    pub web_surface:String,
    pub locale: String,
    pub input_locale: String,
    pub palettes: Palettes,
    pub system_dark: bool,
    pub preferences: pero_contracts::workbench::WorkbenchPreferences,
    pub preferences_status: crate::settings_menu::PreferenceSaveState,
    pub settings_menu_open: bool,
    pub harness: Option<pero_contracts::harness_settings::HarnessState>,
    pub computer: Option<pero_contracts::computer_runtime::ComputerUseState>,
    pub settings_panel: Option<Entity<crate::settings_view::SettingsPanel>>,
    pub settings_section: Option<crate::settings_view::SettingsSection>,
    #[cfg(not(target_family = "wasm"))]
    pub settings_window: Option<AnyWindowHandle>,
    pub settings_subscriptions: Vec<Subscription>,
    pub recent_tasks: Vec<String>,
    pub selected_project: Option<String>,
    pub(crate) research: crate::research_projects::ResearchProjectsView,
    pub(crate) project_agents: crate::project_agent::ProjectAgentsView,
    pub project_binding: Entity<InputState>,
    pub collapsed_projects: std::collections::HashSet<String>,
    pub revealed_sessions: std::collections::HashMap<String, usize>,
    /// Hides the sidebar column. Project expansion and revealed session counts stay.
    pub sidebar_collapsed: bool,
    pub project_tab: crate::projects::ProjectTab,
    pub(crate) local_roadmap: crate::local_roadmap::RoadmapState,
    pub task_status: crate::projects::TaskStatusFilter,
    pub pending_project_workspace: bool,
    pub navigation: WorkspaceNavigation,
    pub recovery:crate::workspace_restore::WorkspaceRecovery,
    pub remote: crate::remote::RemoteState,
    pub local_execution: crate::local_execution::LocalExecution,
    pub contribution: crate::contributions::ContributionState,
    pub apps: crate::apps::AppCatalog,
    pub(crate) app_examples:std::collections::BTreeMap<(String,String),crate::components::app_examples::Examples>,
    pub(crate) pending_app: Option<(String, String)>,
    #[cfg(not(target_family="wasm"))]
    pub(crate) pending_app_location:Option<pero_contracts::app_chat::AppLocation>,
    pub app_surface: String,
    pub app_chat_slot: Option<crate::apps::AppChatSlot>,
    pub floating_chat: bool,
    pub floating_chat_expanded: bool,
    pub layout: WorkspaceLayout,
    pub resizing_chat: bool,
    pub resizing_sidebar: bool,
    pub resizing_sessions: bool,
    pub sessions_resize_focus: FocusHandle,
    pub chat_resize_focus: FocusHandle,
    pub sidebar_resize_focus: FocusHandle,
    pub tab: ConversationTab,
    pub connected: bool,
    pub pending: Option<String>,
    pub next_request: u64,
    pub received: usize,
    pub last_echo: String,
    pub error: Option<String>,
    pub events: Vec<HostEvent>,
    pub chat: Entity<ChatPanel>,
    pub session_search: Entity<InputState>,
    pub session_search_open: bool,
    pub session_menu_open: Option<String>,
    pub pending_session_workspace: crate::session_workspace::PendingSessionWorkspace,
    pub spotlight: Option<Entity<crate::spotlight::SpotlightList>>,
    pub spotlight_query: String,
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
        crate::shortcuts::install(&Default::default(), cx);
        cx.bind_keys([
            KeyBinding::new("enter",crate::workspace_pane_tabs::ConfirmPaneTabSwitch,Some("PaneTabSwitcher")),
            KeyBinding::new("escape",crate::workspace_pane_tabs::CancelPaneTabSwitch,Some("PaneTabSwitcher")),
        ]);
        #[cfg(all(feature = "native", not(target_family = "wasm")))]
        cx.bind_keys([
            KeyBinding::new("cmd-c", gpui_kit::component::input::Copy, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("cmd-x", gpui_kit::component::input::Cut, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("cmd-v", gpui_kit::component::input::Paste, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("cmd-a", gpui_kit::component::input::SelectAll, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("ctrl-c", gpui_kit::component::input::Copy, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("ctrl-x", gpui_kit::component::input::Cut, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("ctrl-v", gpui_kit::component::input::Paste, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
            KeyBinding::new("ctrl-a", gpui_kit::component::input::SelectAll, Some(crate::web_documents::SURFACE_KEY_CONTEXT)),
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
        let mut subscriptions = subscriptions;
        subscriptions.push(cx.observe_in(&chat, window, |this, _, window, cx| {
            this.reconcile_content(window, cx);
            let panel = this.chat.read(cx);
            let needs_attention = panel.error.is_some() || panel.chats.get(panel.active_chat.unwrap_or(usize::MAX)).is_some_and(|chat| {
                chat.permission.is_some() || chat.error.is_some() || chat.state == pero_chat_ui::session_state::SessionState::AuthRequired
            });
            if needs_attention && this.floating_chat && this.preferences.layout.chat_open && matches!(this.navigation.current(), Some(WorkspaceItem::App { .. })) {
                this.floating_chat_expanded = true;
            }
            this.sync_follow(cx);
            cx.notify();
        }));
        subscriptions.push(cx.subscribe_in(&chat, window, |this, _, event, window, cx| {
            match event {
                ChatAction::Command(command) => {
                    let command = serde_json::to_value(command).expect("serializable command");
                    if command["action"] == "prompt" && this.floating_chat && matches!(this.navigation.current(), Some(WorkspaceItem::App { .. })) {
                        this.floating_chat_expanded = true;
                        this.sync_follow(cx);
                    }
                    this.command(command, cx)
                },
                ChatAction::Mcp(request)=>this.command(serde_json::to_value(request).expect("typed MCP surface request"),cx),
                ChatAction::AppLink(href)=>this.open_workspace_link(href,window,cx),
                ChatAction::FollowLink { href, middle, primary_modifier } => this.follow_link(href, pero_contracts::workbench::LinkClick { middle: *middle, primary_modifier: *primary_modifier }, window, cx),
                ChatAction::OpenSource { target, middle, primary_modifier } => this.open_source(target.clone().resolve_remote(false), pero_contracts::workbench::LinkClick { middle: *middle, primary_modifier: *primary_modifier }, window, cx),
                ChatAction::OpenDocument(document)=>this.open_document(document.clone(),window,cx),
                ChatAction::Content(intent) => this.command(serde_json::to_value(intent).expect("content intent"), cx),
                ChatAction::WorkspaceFiles(request) => this.command(serde_json::to_value(request).expect("workspace file request"), cx),
                ChatAction::ResourceTab { tab } => {let mut preferences=this.preferences.clone();preferences.layout.resource_tab=*tab;this.save_preferences(preferences,cx);},
                ChatAction::Changes(request) => this.command(serde_json::to_value(request).expect("changes request"),cx),
                ChatAction::Artifacts(request) => this.command(serde_json::to_value(request).expect("artifact request"), cx),
                ChatAction::ArtifactPreview(target) => {
                    #[cfg(not(target_family="wasm"))]
                    this.open_artifact_preview(target.clone(),window,cx);
                    #[cfg(target_family="wasm")]
                    let _=target;
                }
                ChatAction::ArtifactComposeResult{id,error} => {
                    #[cfg(not(target_family="wasm"))]
                    this.reply_artifact_compose(id,error.as_deref(),cx);
                    #[cfg(target_family="wasm")]
                    this.command(json!({"action":"artifact_compose_result","id":id,"error":error}),cx);
                }
                ChatAction::ArtifactPaneWidth { width } => {
                    let mut preferences = this.preferences.clone();
                    preferences.layout.resize_artifact_pane(*width);
                    this.save_preferences(preferences, cx);
                }
                ChatAction::ArtifactView { view } => {
                    let mut preferences = this.preferences.clone();
                    preferences.layout.artifact_view = *view;
                    this.save_preferences(preferences, cx);
                }
                ChatAction::ChooseArtifactFile { thread_id } => this.command(json!({"action":"choose_artifact_file","thread_id":thread_id}), cx),
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
                ChatAction::OpenContext { reference } => this.open_context_reference(&reference, window, cx),
                ChatAction::Selected { thread_id } => {
                    if cfg!(target_family = "wasm") {
                        this.command(json!({"action":"app_use_selection","thread_id":thread_id}),cx);
                    }
                }
                ChatAction::Activated => {
                    if !this.chat_dock_visible() && !this.project_agent_active() {
                        let index = this.chat.read(cx).active_chat;
                        this.focus_chat(index, ConversationTab::Chat, cx);
                    }
                    this.tab = ConversationTab::Chat;
                    this.error = None;
                    this.sync_follow(cx);
                }
                ChatAction::ClosePanel => this.set_chat_dock(false, cx),
                ChatAction::CompactNeedsSpace => {
                    if this.floating_chat && this.chat_dock_visible() && !this.floating_chat_expanded {
                        this.floating_chat_expanded = true;
                        this.sync_follow(cx);
                    }
                }
                ChatAction::ReturnToReview => {
                    this.remote.public_contributions = true;
                    this.navigate(WorkbenchPage::Tasks, cx);
                    this.sync_follow(cx);
                }
            }
            cx.notify();
        }));
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
        let session_search = cx.new(|cx| InputState::new(window, cx));
        subscriptions.push(cx.subscribe(&session_search, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) { cx.notify(); }
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
            None,
        );
        Self {
            session_search,
            session_search_open: false,
            session_menu_open: None,
            pending_session_workspace: Default::default(),
            terminal: Default::default(),
            view_bounds: Default::default(),
            workspace_focus,
            #[cfg(not(target_family="wasm"))]
            native_web_pages:Default::default(),
            #[cfg(not(target_family="wasm"))]
            native_app_pages:Default::default(),
            #[cfg(not(target_family="wasm"))]
            native_panel_slots:Default::default(),
            #[cfg(all(feature = "native", not(target_family = "wasm")))]
            mcp_app_wait: None,
            #[cfg(not(target_family="wasm"))]
            artifact_preview:None,
            #[cfg(not(target_family="wasm"))]
            native_mcp_views:Default::default(),
            discovered_pull_requests:Default::default(), pull_requests:vec![],
            pull_request_index: Default::default(), pull_request_poll: 0, pull_request_poll_armed: false,
            restored_pull_requests: Vec::new(), pending_citations: Vec::new(), plan_sessions: Vec::new(),
            web_documents:vec![],web_address,web_entry_open:false,
            #[cfg(target_family = "wasm")]
            web_surface: String::new(),
            remote,
            local_execution,
            contribution: Default::default(),
            apps: crate::apps::AppCatalog::default(),
            app_examples:Default::default(),
            pending_app: None,
            #[cfg(not(target_family="wasm"))]
            pending_app_location:None,
            app_surface: String::new(),
            app_chat_slot: None,
            floating_chat: cfg!(target_family="wasm"),
            floating_chat_expanded: false,
            layout,
            resizing_chat: false,
            resizing_sidebar: false,
            resizing_sessions: false,
            sessions_resize_focus: cx.focus_handle().tab_stop(true),
            chat_resize_focus: cx.focus_handle().tab_stop(true),
            sidebar_resize_focus: cx.focus_handle().tab_stop(true),
            input,
            documents:vec![],pane_views:vec![],pane_tabs:Default::default(),pane_surfaces:vec![],pane_split_bounds:vec![],pane_resize:None,pending_close:None,pending_save_as:None,save_as_feedback:None,
            input_locale: String::new(),
            locale,
            palettes,
            system_dark: dark,
            preferences,
            preferences_status: Default::default(),
            settings_menu_open: false,
            harness: None,
            computer: None,
            settings_panel: None,
            settings_section: None,
            #[cfg(not(target_family = "wasm"))]
            settings_window: None,
            settings_subscriptions: Vec::new(),
            recent_tasks: Vec::new(),
            selected_project: None,
            research: Default::default(), project_agents: Default::default(),
            project_binding,
            collapsed_projects: Default::default(),
            revealed_sessions: Default::default(),
            sidebar_collapsed: false,
            project_tab: Default::default(),
            local_roadmap: Default::default(),
            task_status: Default::default(),
            pending_project_workspace: false,
            navigation,
            recovery:Default::default(),
            tab: ConversationTab::Chat,
            connected: false,
            pending: None,
            next_request: 0,
            received: 0,
            last_echo: String::new(),
            error: None,
            events: Vec::new(),
            chat,
            spotlight: None,
            spotlight_query: String::new(),
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
        let pane_thread=self.navigation.pane_layout().filter(|_|self.navigation.pane_layout_visible()).and_then(|layout|layout.conversation().map(str::to_owned));
        let pinned_thread=pane_thread.or_else(||self.project_agent_active().then(||self.project_agent_thread()).flatten().map(str::to_owned));
        let origin=pinned_thread.as_ref().map(|id|pero_contracts::content_origin::ContentOrigin::Conversation {thread_id:id.clone()}).or_else(||match self.navigation.current() {
            Some(WorkspaceItem::App {name,panel})=>Some(pero_contracts::content_origin::ContentOrigin::App {app:name.clone(),panel:panel.clone()}),
            Some(WorkspaceItem::Conversation(id))=>Some(pero_contracts::content_origin::ContentOrigin::Conversation {thread_id:id.clone()}),
            Some(WorkspaceItem::Document {origin,..})=>Some(origin.clone()),
            _=>None,
        });
        let pinned=pinned_thread.and_then(|id|self.chat.read(cx).chats.iter().position(|chat|chat.id==id));
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
        let compact = self.active_app_chat_slot().is_none() && self.floating_chat && !self.floating_chat_expanded && self.navigation.pane_layout().is_none_or(|layout| layout.leaves().len() <= 1) && matches!(self.navigation.current(), Some(WorkspaceItem::App { .. }));
        self.chat.update(cx, |chat, cx| {
            if !visible { chat.set_visible(false, cx); }
            chat.set_scope(scope, cx);
            if let Some(index)=pinned {if chat.active_chat!=Some(index) {chat.focus_chat(Some(index),cx);}}
            chat.set_visible(visible, cx);
            chat.show_return_to_review = show_return;
            if chat.compact != compact { chat.compact = compact; cx.notify(); }
        });
    }

    pub(crate) fn navigate(&mut self, page: WorkbenchPage, cx: &mut Context<Self>) {
        self.navigation.show(page);
        self.queue_workspace_checkpoint(cx);
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
                panel.fail_file_reads(cx);
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
        #[cfg(not(target_family="wasm"))]
        self.receive_native_app(&event,window,cx);
        if event.kind=="scientific_paper_open" {
            if self.apps.contains_panel("paper-agent","main") { self.open_app("paper-agent".into(),"main".into(),cx); }
            return;
        }
        if event.kind=="automation_session_open" {
            if let Some(id)=event.data["sessionId"].as_str(){self.open_automation_session(id,cx);}
            return;
        }
        if event.kind == "shortcut_command" {
            if let Ok(command) = serde_json::from_value::<pero_contracts::shortcuts::CommandId>(event.data.clone()) {
                self.execute_shortcut(command, window, cx);
            }
            return;
        }
        if event.kind == "automation_open" { self.open_automations(window, cx); return; }
        if event.kind=="turn_finished" {
            if let Some(thread_id)=&event.thread_id {
                self.next_request+=1;
                self.command(json!({"method":"pull_requests","action":"discover","request_id":format!("pr-discover-{}",self.next_request),"thread_id":thread_id}),cx);
            }
        }
        #[cfg(not(target_family="wasm"))]
        self.receive_inline_mcp(&event,window,cx);
        let event_kind = event.kind.clone();
        let feature_handled = self.receive_terminal(&event,cx) || self.receive_mcp(&event, cx) || self.receive_icon_themes(&event,cx) || self.receive_workspace(&event,window,cx) || self.receive_pull_request(&event,window,cx) || self.receive_web(&event,window,cx) || self.receive_document(&event,window,cx)
            || self.receive_harness(&event, cx) || self.receive_computer(&event, cx) || self.receive_engram(&event, window, cx) || self.receive_roadmap(&event, cx)
            || self.receive_local_execution(&event, window, cx)
            || self.receive_contribution(&event, cx)
            || self.receive_project_agents(&event, cx) || self.receive_research_resources(&event, cx)
            || self.receive_apps(&event, cx)
            || self.receive_remote(&event, cx);
        // App lifecycle notifications also reach Chat; scope admission stays with Apps.
        let handled = (!feature_handled || event.kind.starts_with("apps_"))
            && self.chat.update(cx, |chat, cx| chat.receive(&event, cx));
        if !feature_handled {
            if event.kind == "agents" {
                self.workspace = event.text.clone();
            }
            if event.kind == "workspace" {
                self.workspace = event.text.clone();
                if self.settings_panel.is_some() {
                    self.command(serde_json::json!({"method":"settings.engram.get"}), cx);
                }
                self.research_workspace_ready(&event.text,cx);
                if let Ok(identity) = serde_json::from_value::<
                    pero_contracts::workbench::WorkspaceIdentity,
                >(event.data.clone())
                {
                    self.workspace_repositories
                        .retain(|entry| !pero_contracts::workspace_path::WorkspacePath(&entry.workspace).matches(&event.text));
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
            self.receive_session_workspace(&event, window, cx);
            if !handled || matches!(event.kind.as_str(), "ready" | "disconnected" | "settings") {
                match event.kind.as_str() {
                    "workbench_settings" => {
                        if let Ok(preferences) = serde_json::from_value::<
                            pero_contracts::workbench::WorkbenchPreferences,
                        >(event.data.clone())
                        {
                            self.preferences = preferences;
                            self.install_shortcuts(cx);
                            let width = self.preferences.layout.artifact_pane_width();
                            let view = self.preferences.layout.artifact_view;
                            self.preferences.layout.resource_tab = self.chat.update(cx, |chat, cx| {
                                chat.set_artifact_pane_width(width, cx);
                                chat.set_artifact_view(view, cx);
                                chat.set_resource_tab(self.preferences.layout.resource_tab, cx)
                            });
                            self.research_saved(window, cx);
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
                        self.cancel_workspace_close();
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
        self.apply_workspace_recovery(window,cx);
        self.reconcile_content(window, cx);
        self.sync_follow(cx);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn install_appearance(&mut self, cx: &mut Context<Self>) {
        pero_theme::ResolvedAppearance::resolve(&self.preferences, self.system_dark, &self.palettes).install(cx);
        #[cfg(not(target_family = "wasm"))]
        if let Some(settings) = self.settings_window {
            let dark = pero_theme::UiAppearance::global(cx).dark;
            let _ = settings.update(cx, |_, window, _| crate::settings_window::sync_settings_titlebar(window, dark));
        }
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
            pero_chat_ui::web_platform::initialize(cx);
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

#[cfg(target_family="wasm")]
#[wasm_bindgen]
pub fn request_window_close() {
    update(|ui,window,cx|ui.request_workspace_window_close(window,cx));
}

#[cfg(target_family="wasm")]
#[wasm_bindgen]
pub fn checkpoint_workspace(discard:bool)->String {
    let mut command=String::new();
    update(|ui,_,cx| {if let Some(value)=ui.workspace_checkpoint(discard,true,cx) {command=value.to_string();}});
    command
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
            "appExamplesBounds":ui.app_examples_bounds(), "apps": ui.apps.entries, "activeApp": ui.navigation.current().and_then(|item| match item { WorkspaceItem::App { name, panel } => Some(json!({"name":name,"panel":panel})), _ => None }), "appError": ui.apps.error, "appsLoading": ui.apps.loading, "appChatOpen": ui.preferences.layout.chat_open, "floatingChat": ui.layout.chat == crate::layout::ChatPlacement::Float, "floatingChatExpanded": ui.floating_chat_expanded, "appChatSlot": if ui.layout.chat == crate::layout::ChatPlacement::Slot { ui.active_app_chat_slot() } else { None },
            "locale": ui.locale, "labels": { "tasks": ui.t("nav.tasks"), "send": ui.t("probe.send") },
            "tab": ui.tab.legacy_index(), "events": ui.events, "workspace": ui.workspace,
        });
        value["researchProjects"] = ui.research.snapshot(cx); value["projectAgent"] = ui.project_agents.snapshot(cx);
        value["projectControls"] = ui.view_bounds.projects.snapshot();
        value["terminal"] = ui.terminal.snapshot(cx);
        value["terminalControls"] = ui.view_bounds.terminal.snapshot();
        value["sidebarButtonBounds"] = ui.view_bounds.sidebar.snapshot();
        value["settingsButtonBounds"] = ui.view_bounds.settings.snapshot()["settings"].clone();
        value["settingsMenuOpen"] = serde_json::json!(ui.settings_menu_open);
        value["newChatButtonBounds"] = ui.view_bounds.new_chat.snapshot()["new-chat"].clone();
        value["sessionRowBounds"] = ui.view_bounds.sessions.snapshot();
        value["appOpenButtonBounds"] = ui.view_bounds.app_open.snapshot();
        value["chatCloseButtonBounds"] = ui.view_bounds.chat_close.snapshot()["float-chat-close"].clone();
        value["chatVisible"] = serde_json::json!(ui.chat_visible());
        value["pullRequests"]=json!(ui.pull_requests.iter().map(|view|json!({"reference":view.state.reference,"pending":view.state.pending,"error":view.state.error,"tab":view.state.tab,"selectedFile":view.state.selected_file,"snapshot":view.state.snapshot,"discussions":view.discussions.snapshot(cx)})).collect::<Vec<_>>());
        value["prControls"]=ui.view_bounds.pull_request.snapshot();
        value["webDocuments"]=json!(ui.web_documents);
        value["webAddress"]=json!(ui.web_address.read(cx).value().as_ref());
        value["webEntryOpen"]=json!(ui.web_entry_open);
        value["documents"]=json!(ui.documents.iter().map(|open|json!({"item":open.item,"title":open.view.read(cx).document.title,"reader":open.view.read(cx).snapshot(cx)})).collect::<Vec<_>>());
        value["contentTabs"] = serde_json::json!(ui.navigation.items());
        value["pendingClose"]=serde_json::json!(&ui.pending_close);
        value["paneSurfaces"]=serde_json::json!(ui.pane_surfaces);
        value["paneViews"]=serde_json::json!(ui.pane_views.iter().map(|view|serde_json::json!({"view":view.id,"pane":ui.navigation.pane_layout().and_then(|layout|layout.view(view.id).map(|(pane,_)|pane)),"item":view.item,"reader":view.view.read(cx).snapshot(cx)})).collect::<Vec<_>>());
        if let Some(layout)=ui.navigation.pane_layout() {
            let strips=ui.pane_tabs_snapshot(layout,cx);
            if ui.navigation.pane_layout_visible() {if let Some(bounds)=strips.as_array().and_then(|strips|strips.iter().find(|strip|strip["pane"]==serde_json::json!(layout.focused))).and_then(|strip|strip["tabs"].as_array()).and_then(|tabs|tabs.iter().find(|tab|tab["active"]==true)) {value["activeTabBounds"]=bounds.clone();}}
            value["paneTabs"]=strips;
        }
        value["workspaceNavigation"]=serde_json::json!(ui.navigation.snapshot());
        value["activeContent"] = serde_json::json!(ui.navigation.current());
        if !ui.navigation.pane_layout_visible() {if let Some(index)=ui.navigation.current().and_then(|item|ui.navigation.titlebar_tabs().position(|candidate|candidate==item)) {
            if let Some(bounds)=ui.tab_scroll.bounds_for_item(index) {
                let strip=ui.tab_scroll.bounds();let offset=ui.tab_scroll.offset().x;
                value["activeTabBounds"]=json!({"left":f32::from(bounds.left()+offset),"right":f32::from(bounds.right()+offset),"stripLeft":f32::from(strip.left()),"stripRight":f32::from(strip.right())});
            }
        }
        }
        value["chatPanelWidth"] = serde_json::json!(ui.preferences.layout.chat_width());
        value["preferencesStatus"] = serde_json::json!(ui.preferences_status);
        value["settingsOpen"] = serde_json::json!(ui.settings_panel.is_some());
        value["settings"] = ui.settings_panel.as_ref().map(|panel| panel.read(cx).snapshot(cx)).unwrap_or_default();
        value["settingsSearch"] = value["settings"]["query"].clone();
        value["projectBinding"] = serde_json::json!(ui.project_binding.read(cx).value().as_ref());
        value["sidebarSearch"] = serde_json::json!(ui.spotlight_query);
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
