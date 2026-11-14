//! A retained conversation surface. Shells carry out its typed intents.
use crate::{
    composer_state::ComposerState,
    conversation::{AgentChoice, Conversation},
    session_artifacts::InlineArtifactAction,
};
use gpui_kit::{
    component::input::{InputContent, InputEvent, TextareaState},
    prelude::*,
    *,
};
use pero_contracts::{
    HostCommand, HostEvent,
    context::{ContextKind, ContextReference},
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub enum ChatAction {
    Command(HostCommand),
    Mcp(pero_contracts::mcp_source::McpSourceRequest),
    Content(crate::artifact_read::ContentReadIntent),
    Artifacts(pero_contracts::session_artifact::ArtifactRequest),
    WorkspaceFiles(pero_contracts::workspace_files::WorkspaceFilesRequest),
    ResourceTab { tab: pero_contracts::workbench::ResourceTab },
    Changes(pero_contracts::workspace_changes::ChangesRequest),
    ChooseArtifactFile { thread_id: String },
    ArtifactPaneWidth { width: f32 },
    ArtifactPreview(Option<pero_contracts::session_artifact::ArtifactBrowserState>),
    ArtifactView {view:pero_contracts::workbench::ArtifactView},
    ArtifactComposeResult { id:String, error:Option<String> },
    AppLink(String),
    FollowLink {
        href: String,
        middle: bool,
        primary_modifier: bool,
    },
    OpenSource {
        target: pero_contracts::source_target::SourceTarget,
        middle: bool,
        primary_modifier: bool,
    },
    OpenDocument(pero_contracts::content_document::ContentDocument),
    ChooseWorkspace,
    ChooseContext {
        kind: Option<ContextKind>,
        request_id: Option<String>,
    },
    PreviewContext { reference: ContextReference, thread_id: String },
    /// Open the App or source named by a frozen composer reference.
    OpenContext { reference: ContextReference },
    Selected { thread_id: Option<String> },
    /// A compact surface needs room for a picker or a larger draft.
    CompactNeedsSpace,
    ClosePanel,
    Activated,
    ReturnToReview,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ComposerInsertion {
    pub(crate) thread_id: String,
    #[serde(default)]
    pub(crate) text: String,
    #[serde(default)]
    pub(crate) contexts: Vec<ContextReference>,
    #[serde(default)]
    pub(crate) replace: bool,
    #[serde(skip)]
    pub(crate) surface_request: Option<String>,
}

pub struct ChatPanel {
    pub locale: String,
    pub connected: bool,
    pub error: Option<String>,
    pub composer: Entity<TextareaState>,
    pub chats: Vec<Conversation>,
    pub active_chat: Option<usize>,
    pub deleting_chat: Option<String>,
    pub agents: Vec<AgentChoice>,
    pub agent_index: usize,
    pub model_menu: bool,
    /// A menu opened from the chat dock. It does not cover the center surface.
    pub dock_menu: bool,
    pub workspace: String,
    pub chat_scroll: ScrollHandle,
    pub attachments: Vec<ContextReference>,
    pub(crate) context_preview_bounds: HashMap<String, crate::view_bounds::ViewBounds>,
    pub(crate) literature_bounds: std::rc::Rc<std::cell::RefCell<HashMap<String, crate::view_bounds::ViewBounds>>>,
    pub(crate) stop_button_bounds: crate::view_bounds::ViewBounds,
    pub(crate) composer_bounds: crate::view_bounds::ComposerBounds,
    pub composer_focused: bool,
    pub composer_restore: Option<InputContent>,
    pub composer_picker_scroll: ScrollHandle,
    pub composer_state: ComposerState,
    pub expanded_tools: HashSet<String>,
    pub pull_request_notes: Vec<pero_contracts::pull_request::PullRequestSummary>,
    pub show_return_to_review: bool,
    pub can_open_documents: bool,
    /// Render only the composer and required attention controls in compact shells.
    pub compact: bool,
    /// The shell places this conversation in a dock with a close action.
    pub docked: bool,
    /// The workbench titleband is drawing the side resources header.
    pub host_titleband: bool,
    /// Side resources column measured by the last layout. Bottom stack is none.
    pub resource_column: Option<crate::artifact_panel::ResourceColumn>,
    pub(crate) pending_prompts: Vec<ComposerInsertion>,
    pub scope: Option<pero_contracts::AppChatScope>,
    pub(crate) scope_selection: HashMap<Option<pero_contracts::AppChatScope>, String>,
    input_locale: String,
    pub(crate) replayed: bool,
    pub(crate) visible: bool,
    pub(crate) next_request: u64,
    pub(crate) retired_chats: HashMap<String, String>,
    pub(crate) artifacts: crate::session_artifacts::SessionArtifacts,
    pub(crate) files: crate::workspace_files::SessionFiles,
    link_subscriptions: HashMap<gpui_kit::EntityId, Subscription>,
    _subscriptions: Vec<Subscription>,
}

impl EventEmitter<ChatAction> for ChatPanel {}

impl ChatPanel {
    pub fn new(
        locale: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let composer = cx.new(|cx| {
            TextareaState::new(window, cx)
                .submit_on_enter(true)
                .placeholder(pero_contracts::i18n::text(&locale, "chat.placeholder"))
        });
        let subscriptions = vec![
            cx.subscribe_in(&composer, window, |this, _, event, window, cx| {
                match event {
                    InputEvent::PressEnter { shift: false, .. } => {
                        if this.composer_state.open {
                            this.select_composer_candidate(
                                this.composer_state.selected,
                                window,
                                cx,
                            );
                        } else {
                            this.send_chat(window, cx);
                        }
                    }
                    InputEvent::Change => this.update_composer_completion(cx),
                    _ => {}
                }
                cx.notify();
            }),
            cx.observe(&composer, |this, _, cx| this.update_composer_completion(cx)),
        ];
        Self {
            link_subscriptions: HashMap::new(),
            locale,
            connected: false,
            error: None,
            composer,
            chats: vec![],
            active_chat: None,
            deleting_chat: None,
            agents: vec![],
            agent_index: 0,
            model_menu: false,
            dock_menu: false,
            workspace: String::new(),
            chat_scroll: ScrollHandle::new(),
            attachments: vec![],
            context_preview_bounds: HashMap::new(),
            literature_bounds: std::rc::Rc::new(std::cell::RefCell::new(HashMap::new())),
            stop_button_bounds: Default::default(),
            composer_bounds: Default::default(),
            composer_focused: false,
            composer_restore: None,
            composer_picker_scroll: ScrollHandle::new(),
            composer_state: ComposerState::default(),
            expanded_tools: HashSet::new(),
            pull_request_notes: Vec::new(),
            show_return_to_review: false,
            can_open_documents: false,
            compact: false,
            docked: false,
            host_titleband: false,
            resource_column: None,
            pending_prompts: vec![],
            scope: None,
            scope_selection: HashMap::new(),
            input_locale: String::new(),
            replayed: false,
            visible: true,
            next_request: 0,
            retired_chats: HashMap::new(),
            artifacts: Default::default(),
            files: Default::default(),
            _subscriptions: subscriptions,
        }
    }

    pub fn note_pull_request(&mut self, summary: pero_contracts::pull_request::PullRequestSummary) {
        if let Some(existing) = self
            .pull_request_notes
            .iter_mut()
            .find(|item| item.reference == summary.reference)
        {
            *existing = summary;
        } else {
            self.pull_request_notes.push(summary);
        }
    }
    pub fn reveal_tool(&mut self, thread: &str, tool: &str, cx: &mut Context<Self>) -> bool {
        let Some(index) = self.chats.iter().position(|chat| chat.id == thread) else {
            return false;
        };
        if !self.chats[index].tools.iter().any(|item| item.id == tool) {
            return false;
        }
        self.focus_chat(Some(index), cx);
        self.expanded_tools.insert(format!("{thread}/{tool}"));
        cx.notify();
        true
    }
    pub fn t(&self, key: &str) -> &'static str {
        pero_contracts::i18n::text(&self.locale, key)
    }
    pub(crate) fn icon(&self, name: &str) -> Svg {
        crate::assets::UiIcon::named(name).element()
    }

    pub fn set_locale(&mut self, locale: &str, cx: &mut Context<Self>) {
        self.locale = pero_contracts::i18n::normalize(locale).into();
        for chat in &self.chats {
            for tool in &chat.tools {
                if let Some(reader) = &tool.reader {
                    reader.update(cx, |reader, cx| { reader.locale = self.locale.clone(); cx.notify(); });
                }
            }
        }
        gpui_kit::component::set_locale(&self.locale);
        cx.notify();
    }

    pub fn compose(&mut self, text: String, cx: &mut Context<Self>) {
        self.compose_with_context(text, vec![], cx);
    }

    /// Append a frozen source to the editable draft without submitting it.
    pub fn compose_with_context(&mut self, text: String, contexts: Vec<ContextReference>, cx: &mut Context<Self>) {
        if self.active_chat.is_none() {
            self.new_draft(cx);
        }
        if let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) {
            self.pending_prompts.push(ComposerInsertion {
                thread_id: chat.id.clone(),
                text,contexts,replace:false,surface_request:None,
            });
        }
        cx.notify();
    }

    /// The market opens an ordinary draft; Host resolves its immutable skill version.
    pub fn add_market_skill(&mut self, source: &str, message: &str, cx: &mut Context<Self>) {
        self.next_request += 1;
        let request = format!("market-skill-{}", self.next_request);
        self.composer_state.paste_requests.insert(request.clone());
        self.command(json!({"action":"resolve_context","request_id":request,"kind":ContextKind::Skill,"source":source}),cx);
        if !message.is_empty() { self.compose(message.into(), cx); }
        cx.notify();
    }

    pub fn new_chat_in_scope(
        &mut self,
        scope: Option<pero_contracts::AppChatScope>,
        cx: &mut Context<Self>,
    ) {
        if let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) {
            self.scope_selection
                .insert(self.scope.clone(), chat.id.clone());
        }
        self.scope = scope;
        self.new_chat(cx);
    }

    /// An explicit App launch needs an editable destination, including after restart.
    pub fn open_app_draft(&mut self, scope: pero_contracts::AppChatScope, cx: &mut Context<Self>) {
        self.set_scope(Some(scope), cx);
        if self.active_chat.and_then(|index|self.chats.get(index)).is_some_and(|chat|chat.state==crate::session_state::SessionState::Closed) {
            self.new_draft(cx);
        }
    }

    pub fn set_scope(
        &mut self,
        scope: Option<pero_contracts::AppChatScope>,
        cx: &mut Context<Self>,
    ) {
        if self.scope == scope {
            return;
        }
        if let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) {
            self.scope_selection
                .insert(self.scope.clone(), chat.id.clone());
        }
        self.scope = scope;
        let next = self
            .scope_selection
            .get(&self.scope)
            .and_then(|id| self.chats.iter().position(|chat| &chat.id == id))
            .or_else(|| self.chats.iter().rposition(|chat| chat.scope == self.scope));
        self.focus_chat(next, cx);
        if next.is_none() {
            self.new_draft(cx);
        }
    }

    pub fn set_visible(&mut self, visible: bool, cx: &mut Context<Self>) {
        if self.visible != visible {
            self.visible = visible;
            if !visible { self.hide_mcp_surfaces(); }
            if visible {
                if let Some(chat) = self.active_chat.and_then(|index| self.chats.get_mut(index)) { chat.notice.read(); }
                if self.active_chat.is_none() && self.replayed { self.new_draft(cx); }
                else { self.prepare_chat(cx); }
            }
            self.sync_follow(cx);
            cx.notify();
        }
    }

    /// UI controls enter the command boundary here; only typed intents leave it.
    pub fn command(&mut self, value: Value, cx: &mut Context<Self>) {
        let action = match value["action"].as_str() {
            Some("choose_workspace") => Ok(ChatAction::ChooseWorkspace),
            Some("choose_context") => {
                serde_json::from_value::<Option<ContextKind>>(value["kind"].clone()).map(|kind| {
                    ChatAction::ChooseContext {
                        kind,
                        request_id: value["request_id"].as_str().map(str::to_owned),
                    }
                })
            }
            _ => serde_json::from_value::<HostCommand>(value).map(ChatAction::Command),
        };
        match action {
            Ok(action) => cx.emit(action),
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }

    pub fn receive(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if self.receive_mcp_app(event,cx){return true;}
        if self.receive_files(event, cx) { return true; }
        if self.changes_event(event,cx) {return true;}
        if self.receive_artifacts(event, cx) { return true; }
        if self.receive_composer(event, cx) {
            return true;
        }
        match event.kind.as_str() {
            "apps_catalog" | "apps_opened" | "apps_error" => {
                // Both shells resume waiting drafts through this shared owner.
                for chat in &mut self.chats { chat.state = chat.state.app_available(); }
                self.prepare_chat(cx);
            }
            "ready" => {
                self.connected = true;
                self.error = None;
                self.prepare_chat(cx);
            }
            "disconnected" => {
                self.connected = false;
                for chat in &mut self.chats {
                    chat.user_questions.clear();
                    chat.pending_model = None;
                    chat.pending_setting = None;
                }
                self.error = Some(
                    event
                        .message_key
                        .clone()
                        .unwrap_or_else(|| "error.connection".into()),
                );
            }
            "settings" => {
                self.locale = pero_contracts::i18n::normalize(&event.text).into();
                gpui_kit::component::set_locale(&self.locale);
            }
            "app_scope" => {
                if let Ok(scope) = serde_json::from_value::<Option<pero_contracts::AppChatScope>>(
                    event.data.clone(),
                ) {
                    if let Some(scope)=scope { self.open_app_draft(scope,cx); } else { self.set_scope(None,cx); }
                }
            }
            "mcp_resource_selected" => {
                let result = serde_json::from_value::<pero_contracts::mcp_resource::McpResourceSelection>(event.data.clone())
                    .map_err(|_| "Invalid MCP resource selection")
                    .and_then(|selection| selection.into_context(event.thread_id.as_deref().unwrap_or_default()));
                match result {
                    Ok(reference) => self.pending_prompts.push(ComposerInsertion {
                        thread_id: event.thread_id.clone().unwrap_or_default(), text: String::new(),
                        contexts: vec![reference], replace: false, surface_request: None,
                    }),
                    Err(error) => self.error = Some(error.into()),
                }
            }
            "compose_context" => {
                match serde_json::from_value::<ComposerInsertion>(event.data.clone()) {
                    Ok(mut insertion)=>{insertion.text=event.text.clone();self.pending_prompts.push(insertion);},
                    Err(error)=>self.error=Some(error.to_string()),
                }
            }
            "artifact_select" => {
                if let Ok(target)=serde_json::from_value::<pero_contracts::session_artifact::ArtifactPreviewTarget>(event.data.clone()) {
                    if self.artifact_target_available(&target) {self.read_artifact(&target.thread_id,&target.artifact_id,target.version,false,cx);}
                }
            }
            "artifact_inline_action" => {
                let action = match event.text.as_str() {
                    "collapse" => Some(InlineArtifactAction::Collapse),
                    "open_pane" => Some(InlineArtifactAction::OpenPane),
                    _ => None,
                };
                if let (Some(action), Ok(target)) = (action, serde_json::from_value(event.data.clone())) {
                    self.act_on_inline_artifact(&target, action, cx);
                }
            }
            "artifact_compose" => {
                if let Ok(target)=serde_json::from_value::<pero_contracts::session_artifact::ArtifactPreviewTarget>(event.data.clone()) {
                    if self.artifact_preview_target().as_ref()==Some(&target) && event.text.len()<=128_000 {
                        self.request_artifact_context(&target,event.text.clone(),event.request_id.clone(),cx);
                    } else if let Some(id)=event.request_id.clone() {
                        cx.emit(ChatAction::ArtifactComposeResult{id,error:Some("This artifact is no longer selected".into())});
                    }
                }
            }
            "content_document" => {
                #[derive(serde::Deserialize)]
                struct Completion {tool_call_id:String, artifact_id:String, status:CompletionStatus}
                #[derive(serde::Deserialize)]
                #[serde(rename_all="snake_case")]
                enum CompletionStatus {Ready, Error}
                if let Ok(data)=serde_json::from_value::<Completion>(event.data.clone()) {
                    if let Some(tool)=self.chats.iter_mut().find(|chat|Some(&chat.id)==event.thread_id.as_ref())
                        .and_then(|chat|chat.tools.iter_mut().find(|tool|tool.id==data.tool_call_id)) {
                        if let Some(artifact)=&mut tool.artifact {
                            let result=match data.status {
                                CompletionStatus::Ready=>Ok(pero_contracts::content_document::ContentDocument::new(pero_contracts::content_document::DocumentSource {id:format!("artifact:{}",data.artifact_id),title:tool.title.clone(),origin:pero_contracts::content_origin::ContentOrigin::Conversation {thread_id:event.thread_id.clone().unwrap_or_default()}},1,event.text.clone(),pero_contracts::content_document::ContentFormat::Json)),
                                CompletionStatus::Error=>Err(event.text.clone()),
                            };
                            if let Some(document)=artifact.finish(&data.artifact_id,event.request_id.as_deref().unwrap_or_default(),result) {
                                if let Some(reader)=&tool.reader {reader.update(cx,|reader,cx|reader.replace(document.clone(),cx));}
                                tool.document=Some(document);
                            }
                        }
                    }
                }
            }
            "compose_intent" => {
                self.compose(event.text.clone(), cx);
            }
            "chat_visibility" => {
                self.set_visible(event.data.as_bool().unwrap_or(true), cx);
            }
            "chat_compact" => {
                self.compact = event.data.as_bool().unwrap_or(false);
                cx.notify();
            }
            _ => return self.receive_chat(event, cx),
        }
        cx.notify();
        true
    }

    /// Diagnostic projection used by both shells; never a second history store.
    pub fn snapshot(&self, cx: &App) -> Value {
        json!({"chats":self.chats,"activeChat":self.active_chat,"agents":self.agents,
            "changes":self.changes_snapshot(),"connected":self.connected,"error":self.error,"dark":pero_theme::UiAppearance::global(cx).dark,"locale":self.locale,"scope":self.scope,"artifacts":self.artifact_snapshot(cx),"files":self.files_snapshot(cx),
            "composer":self.composer.read(cx).value().as_ref(),"composerFocused":self.composer_focused,
            "workspace":self.workspace,"attachments":self.attachments.iter().map(|r|r.label.as_str()).collect::<Vec<_>>(),
            "expandedTools":self.expanded_tools,"expandedReasoning":self.chats.iter().flat_map(|chat|chat.messages.iter().enumerate().filter(|(i,m)|m.role=="thought" && chat.thinking.open(*i)).map(|(i,_)|(&chat.id,i))).collect::<Vec<_>>(),
            "processBounds":self.chats.iter().flat_map(|chat| crate::chat::render_items(chat).into_iter().filter_map(move |row| {
                if let crate::chat::RenderItem::Process(group) = row {
                    let key = format!("{}/process:{}", chat.id, group.first().key());
                    Some(json!({"chat":chat.id,"key":key,"members":group.members(),"open":crate::chat::process_open(chat,&group,&self.expanded_tools),"bounds":self.artifacts.bounds.get(&key).map(|bounds|bounds.snapshot())}))
                } else { None }
            })).collect::<Vec<_>>(),
            "modelMenu":self.model_menu,"deletingChat":self.deleting_chat,
            "stopButtonBounds":self.stop_button_bounds.snapshot(),
            "composerBounds":self.composer_bounds.snapshot(),
            "retryButtonBounds":self.composer_bounds.reconnect.snapshot(),
            "completion":{"open":self.composer_state.open,"loading":self.composer_state.loading,"error":self.composer_state.error,
                "selected":self.composer_state.selected,"items":self.composer_picker_items().iter().map(|i|&i.label).collect::<Vec<_>>()},
            "contextPreviewBounds":self.attachments.iter().map(|reference|json!({"id":reference.id,"image":matches!(reference.content, pero_contracts::context::ContextContent::Image{..}),"bounds":self.context_preview_bounds.get(&reference.id).map(|bounds|bounds.snapshot())})).collect::<Vec<_>>(),
            "permissionBounds":self.chats.iter().flat_map(|chat|chat.permission_bounds.iter().enumerate().map(move |(index,bounds)|json!({"chat":chat.id,"index":index,"bounds":bounds.snapshot()}))).collect::<Vec<_>>(),
            "userQuestionBounds":self.chats.iter().flat_map(|chat|chat.user_questions.iter().map(|form|form.bounds())).collect::<Vec<_>>(),
            "reasoningBounds":self.chats.iter().flat_map(|chat|chat.messages.iter().enumerate().filter(|(_,m)|m.role=="thought").map(move |(index,message)|json!({"chat":chat.id,"index":index,"open":chat.thinking.open(index),"bounds":if crate::chat::process_member_visible(chat,crate::process::ProcessEntry::Thought(index),&self.expanded_tools) {message.toggle_bounds.snapshot()} else {Value::Null}}))).collect::<Vec<_>>(),
            "inputBounds":self.chats.iter().flat_map(|chat|chat.tools.iter().map(move |tool|json!({"chat":chat.id,"tool":tool.id,"bounds":tool.input_bounds.snapshot()}))).collect::<Vec<_>>(),
            "appLinkBounds":self.chats.iter().flat_map(|chat|chat.tools.iter().flat_map(move |tool|tool.app_links.iter().map(move |link|json!({"chat":chat.id,"url":link.url,"label":link.label,"bounds":link.bounds.snapshot()})))).collect::<Vec<_>>(),
            "toolBounds":self.chats.iter().flat_map(|chat|chat.tools.iter().enumerate().map(move |(index,tool)|json!({"chat":chat.id,"tool":tool.id,"bounds":if crate::chat::process_member_visible(chat,crate::process::ProcessEntry::Tool(index),&self.expanded_tools) {tool.toggle_bounds.snapshot()} else {Value::Null},"artifact":tool.artifact_bounds.snapshot()}))).collect::<Vec<_>>(),
            "tableBounds":self.chats.iter().flat_map(|chat|chat.tools.iter()).filter_map(|tool|tool.table.as_ref().map(|table|json!({"id":table.artifact_id,"data":table.data_bounds.snapshot(),"source":table.source_bounds.snapshot(),"cite":table.cite_bounds.snapshot()}))).collect::<Vec<_>>(),
            "literature":self.literature_snapshot(),
            "chartBounds":self.chats.iter().flat_map(|chat|chat.tools.iter()).filter_map(|tool|tool.chart.as_ref().map(|chart|json!({"id":chart.artifact_id,"data":chart.data_bounds.snapshot(),"source":chart.source_bounds.snapshot()}))).collect::<Vec<_>>(),
            "contentReaders":self.chats.iter().flat_map(|chat|chat.tools.iter()).filter_map(|tool|tool.reader.as_ref().map(|reader|reader.read(cx).snapshot(cx))).collect::<Vec<_>>(),
            "toolViews":self.chats.iter().map(|c|c.tools.iter().filter(|t|t.view.is_some()).count()).collect::<Vec<_>>(),
            "scroll":{"y":f32::from(self.chat_scroll.offset().y),"max":f32::from(self.chat_scroll.max_offset().y)},
            "renderStats":self.chats.iter().map(|c|c.messages.iter().map(|m|m.view.read(cx).stats()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "renderedBytes":self.chats.iter().map(|c|c.messages.iter().map(|m|m.view.read(cx).rendered_bytes(cx)).collect::<Vec<_>>()).collect::<Vec<_>>()})
    }
}

impl Render for ChatPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.hide_mcp_surfaces();
        self.sync_mcp_app_requests(cx);
        self.composer_focused = self.composer.read(cx).focus_handle(cx).is_focused(window);
        let views: Vec<_> = self.chats.iter().flat_map(|chat| chat.messages.iter().map(|message|message.view.clone()).chain(chat.tools.iter().filter_map(|tool|tool.view.clone()))).collect();
        for view in views {
            if self.link_subscriptions.contains_key(&view.entity_id()) { continue; }
            view.update(cx,|view,_|view.capture_links=true);
            let subscription=cx.subscribe(&view,|_,_,link:&crate::stream::MarkdownLink,cx|cx.emit(ChatAction::FollowLink{href:link.href.clone(),middle:link.middle,primary_modifier:link.primary_modifier}));
            self.link_subscriptions.insert(view.entity_id(),subscription);
        }
        self.apply_composer_context(window, cx);
        self.apply_pending_composer_insertions(window, cx);
        if self.input_locale != self.locale {
            self.input_locale = self.locale.clone();
            let placeholder = self.t("chat.placeholder");
            self.composer.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
        }
        self.prepare_artifacts(window, cx);
        let view = cx.entity().clone();
        container_query(move |size, window, cx| view.update(cx, |this, cx| this.artifact_chat_layout(size, window, cx)))
    }
}
