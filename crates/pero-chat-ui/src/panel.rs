//! A retained conversation surface. Shells carry out its typed intents.
use crate::{
    composer_state::ComposerState,
    conversation::{AgentChoice, Conversation},
};
use gpui_kit::{
    component::input::{InlineToken, InputContent, InputEvent, TextareaState},
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
    Content(crate::artifact_read::ContentReadIntent),
    ChooseWorkspace,
    ChooseContext {
        kind: Option<ContextKind>,
        request_id: Option<String>,
    },
    PreviewContext { reference: ContextReference, thread_id: String },
    Selected { thread_id: Option<String> },
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
    pub workspace: String,
    pub chat_scroll: ScrollHandle,
    pub attachments: Vec<ContextReference>,
    pub composer_focused: bool,
    pub composer_restore: Option<InputContent>,
    pub composer_picker_scroll: ScrollHandle,
    pub composer_state: ComposerState,
    pub expanded_tools: HashSet<String>,
    pub show_return_to_review: bool,
    pub(crate) pending_prompts: Vec<ComposerInsertion>,
    pub scope: Option<pero_contracts::AppChatScope>,
    pub(crate) scope_selection: HashMap<Option<pero_contracts::AppChatScope>, String>,
    input_locale: String,
    pub(crate) replayed: bool,
    pub(crate) visible: bool,
    pub(crate) next_request: u64,
    pub(crate) retired_chats: HashMap<String, String>,
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
            workspace: String::new(),
            chat_scroll: ScrollHandle::new(),
            attachments: vec![],
            composer_focused: false,
            composer_restore: None,
            composer_picker_scroll: ScrollHandle::new(),
            composer_state: ComposerState::default(),
            expanded_tools: HashSet::new(),
            show_return_to_review: false,
            pending_prompts: vec![],
            scope: None,
            scope_selection: HashMap::new(),
            input_locale: String::new(),
            replayed: false,
            visible: true,
            next_request: 0,
            retired_chats: HashMap::new(),
            _subscriptions: subscriptions,
        }
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
        if self.active_chat.is_none() {
            self.new_draft(cx);
        }
        if let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) {
            self.pending_prompts.push(ComposerInsertion {
                thread_id: chat.id.clone(),
                text,contexts:vec![],replace:false,
            });
        }
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
            if visible {
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
        if self.receive_composer(event, cx) {
            return true;
        }
        match event.kind.as_str() {
            "ready" => {
                self.connected = true;
                self.error = None;
                self.prepare_chat(cx);
            }
            "disconnected" => {
                self.connected = false;
                for chat in &mut self.chats {
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
                    self.set_scope(scope, cx);
                }
            }
            "compose_context" => {
                match serde_json::from_value::<ComposerInsertion>(event.data.clone()) {
                    Ok(mut insertion)=>{insertion.text=event.text.clone();self.pending_prompts.push(insertion);},
                    Err(error)=>self.error=Some(error.to_string()),
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
                                CompletionStatus::Ready=>Ok(pero_contracts::content_document::ContentDocument::new(format!("artifact:{}",data.artifact_id),1,event.text.clone(),pero_contracts::content_document::ContentFormat::Json)),
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
            _ => return self.receive_chat(event, cx),
        }
        cx.notify();
        true
    }

    /// Diagnostic projection used by both shells; never a second history store.
    pub fn snapshot(&self, cx: &App) -> Value {
        json!({"chats":self.chats,"activeChat":self.active_chat,"agents":self.agents,
            "connected":self.connected,"error":self.error,"dark":pero_theme::UiAppearance::global(cx).dark,"locale":self.locale,"scope":self.scope,
            "composer":self.composer.read(cx).value().as_ref(),"composerFocused":self.composer_focused,
            "workspace":self.workspace,"attachments":self.attachments.iter().map(|r|r.label.as_str()).collect::<Vec<_>>(),
            "expandedTools":self.expanded_tools,"expandedReasoning":self.chats.iter().flat_map(|chat|chat.messages.iter().enumerate().filter(|(i,m)|m.role=="thought" && chat.thinking.open(*i)).map(|(i,_)|(&chat.id,i))).collect::<Vec<_>>(),
            "modelMenu":self.model_menu,"deletingChat":self.deleting_chat,
            "completion":{"open":self.composer_state.open,"loading":self.composer_state.loading,"error":self.composer_state.error,
                "selected":self.composer_state.selected,"items":self.composer_picker_items().iter().map(|i|&i.label).collect::<Vec<_>>()},
            "permissionBounds":self.chats.iter().flat_map(|chat|chat.permission_bounds.iter().enumerate().map(move |(index,bounds)|json!({"chat":chat.id,"index":index,"bounds":bounds.snapshot()}))).collect::<Vec<_>>(),
            "reasoningBounds":self.chats.iter().flat_map(|chat|chat.messages.iter().enumerate().filter(|(_,m)|m.role=="thought").map(move |(index,message)|json!({"chat":chat.id,"index":index,"open":chat.thinking.open(index),"bounds":message.toggle_bounds.snapshot()}))).collect::<Vec<_>>(),
            "inputBounds":self.chats.iter().flat_map(|chat|chat.tools.iter().map(move |tool|json!({"chat":chat.id,"tool":tool.id,"bounds":tool.input_bounds.snapshot()}))).collect::<Vec<_>>(),
            "toolBounds":self.chats.iter().flat_map(|chat|chat.tools.iter().map(move |tool|json!({"chat":chat.id,"tool":tool.id,"bounds":tool.toggle_bounds.snapshot(),"artifact":tool.artifact_bounds.snapshot()}))).collect::<Vec<_>>(),
            "contentReaders":self.chats.iter().flat_map(|chat|chat.tools.iter()).filter_map(|tool|tool.reader.as_ref().map(|reader|reader.read(cx).snapshot(cx))).collect::<Vec<_>>(),
            "toolViews":self.chats.iter().map(|c|c.tools.iter().filter(|t|t.view.is_some()).count()).collect::<Vec<_>>(),
            "scroll":{"y":f32::from(self.chat_scroll.offset().y),"max":f32::from(self.chat_scroll.max_offset().y)},
            "renderStats":self.chats.iter().map(|c|c.messages.iter().map(|m|m.view.read(cx).stats()).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "renderedBytes":self.chats.iter().map(|c|c.messages.iter().map(|m|m.view.read(cx).rendered_bytes(cx)).collect::<Vec<_>>()).collect::<Vec<_>>()})
    }
}

impl Render for ChatPanel {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.composer_focused = self.composer.read(cx).focus_handle(cx).is_focused(window);
        self.apply_composer_context(window, cx);
        for insertion in std::mem::take(&mut self.pending_prompts) {
            let Some(index) = self
                .chats
                .iter()
                .position(|chat| chat.id == insertion.thread_id)
            else {
                continue;
            };
            if self.active_chat == Some(index) {
                let end=self.composer.read(cx).value().len();
                self.replace_composer_range(if insertion.replace{0..end}else{end..end},&insertion.text,window,cx);
                self.update_composer_completion(cx);
                for reference in insertion.contexts {
                    let end=self.composer.read(cx).value().len();
                    self.insert_composer_reference(reference,end..end,window,cx);
                }
                self.composer.update(cx,|input,cx|input.focus(window,cx));
            } else {
                let chat=&mut self.chats[index];
                let mut text=if insertion.replace{String::new()}else{chat.draft.text().to_string()};
                let mut tokens=if insertion.replace{vec![]}else{chat.draft.tokens().iter().map(|span|(span.range(),span.token().clone())).collect::<Vec<_>>()};
                text.push_str(&insertion.text);
                let mut references=if insertion.replace{HashMap::new()}else{chat.draft_references.clone()};
                references.retain(|id,_|tokens.iter().any(|(_,token)|token.id().as_ref()==id.as_str()));
                for reference in insertion.contexts {
                    let start=text.len();let label=format!("@{}",reference.label.replace(['\n','\r','\t']," "));
                    text.push_str(&label);let end=text.len();text.push(' ');
                    tokens.push((start..end,InlineToken::new(reference.id.clone(),label).with_label(reference.label.clone())));
                    references.insert(reference.id.clone(),reference);
                }
                if let Err(error)=ContextReference::validate_all(&references.values().cloned().collect::<Vec<_>>()){self.error=Some(error.into());continue;}
                let mut next=InputContent::new(text);
                for (range,token) in tokens{next=next.with_token(range,token).expect("valid appended token");}
                chat.draft=next;chat.draft_references=references;
            }

        }
        if self.input_locale != self.locale {
            self.input_locale = self.locale.clone();
            let placeholder = self.t("chat.placeholder");
            self.composer.update(cx, |input, cx| {
                input.set_placeholder(placeholder, window, cx)
            });
        }
        self.chat_view(window, cx)
    }
}
