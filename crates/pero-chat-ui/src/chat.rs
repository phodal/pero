use crate::session_state::SessionState;
use crate::{
    conversation::{Conversation, StreamItem},
    panel::ChatPanel,
};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::HostEvent;
use serde_json::json;

enum RenderItem {
    Message(usize),
    Tools(Vec<usize>),
}
fn render_items(chat: &Conversation) -> Vec<RenderItem> {
    let mut rows = Vec::new();
    for item in &chat.timeline {
        match *item {
            StreamItem::Message(i) => rows.push(RenderItem::Message(i)),
            StreamItem::Tool(i) => {
                if chat.tools.get(i).is_some_and(|tool| {
                    tool.cancelled && !crate::tool_ui::visible_output(&tool.content, &tool.output)
                }) {
                    continue;
                }
                let compact = chat
                    .tools
                    .get(i)
                    .is_some_and(|t| matches!(t.kind.as_str(), "read" | "search" | "fetch"));
                if compact {
                    if let Some(RenderItem::Tools(tools)) = rows.last_mut() {
                        if tools.iter().all(|index| {
                            chat.tools.get(*index).is_some_and(|t| {
                                matches!(t.kind.as_str(), "read" | "search" | "fetch")
                            })
                        }) {
                            tools.push(i);
                            continue;
                        }
                    }
                }
                rows.push(RenderItem::Tools(vec![i]));
            }
        }
    }
    rows
}

impl ChatPanel {
    pub fn sync_follow(&mut self, cx: &mut Context<Self>) {
        for (i, chat) in self.chats.iter_mut().enumerate() {
            let enabled = self.active_chat == Some(i) && self.visible;
            let open_tools = if enabled {
                render_items(chat)
                    .into_iter()
                    .filter_map(|item| match item {
                        RenderItem::Tools(indices) => {
                            let first = chat.tools.get(*indices.first()?)?;
                            self.expanded_tools
                                .contains(&format!("{}/{}", chat.id, first.id))
                                .then_some(indices)
                        }
                        _ => None,
                    })
                    .flatten()
                    .collect::<std::collections::HashSet<_>>()
            } else {
                std::collections::HashSet::new()
            };
            for message in &chat.messages {
                message.view.update(cx, |view, _| {
                    view.set_scroll_handle(enabled.then(|| self.chat_scroll.clone()))
                });
            }
            for (index, tool) in chat.tools.iter_mut().enumerate() {
                let open = open_tools.contains(&index);
                tool.set_body_open(open, cx);
                if let Some(view) = &tool.view {
                    view.update(cx, |view, _| {
                        view.set_scroll_handle(open.then(|| self.chat_scroll.clone()))
                    });
                }
            }
        }
    }
    pub fn focus_chat(&mut self, index: Option<usize>, cx: &mut Context<Self>) {
        if self.active_chat != index {
            if let Some(chat) = self.active_chat.and_then(|i| self.chats.get_mut(i)) {
                chat.draft = self
                    .composer_restore
                    .clone()
                    .unwrap_or_else(|| self.composer.read(cx).content());
                chat.draft_references = self.composer_state.references.clone();
            }
            self.composer_state = Default::default();
            self.attachments.clear();
            if let Some(chat) = index.and_then(|i| self.chats.get(i)) {
                self.composer_restore = Some(chat.draft.clone());
                self.composer_state.references = chat.draft_references.clone();
            } else {
                self.composer_restore = Some(gpui_kit::component::input::InputContent::new(""));
            }
        }
        let previous=self.active_chat.and_then(|i|self.chats.get(i)).map(|c|c.id.clone());
        self.active_chat = index;
        let thread_id=index.and_then(|i|self.chats.get(i)).map(|c|c.id.clone());
        if previous!=thread_id {cx.emit(crate::ChatAction::Selected{thread_id});}
        self.prepare_chat(cx);
        self.sync_follow(cx);
        cx.notify();
    }
    pub fn delete_chat(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(chat) = self.chats.get(index) else {
            self.deleting_chat = None;
            cx.notify();
            return;
        };
        if chat.state == SessionState::Draft {
            self.forget_chat(index, cx);
            return;
        }
        let id = chat.id.clone();
        self.command(json!({"action":"delete","thread_id":id}), cx);
    }
    fn forget_chat(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(chat) = self.chats.get(index) else {
            return;
        };
        let id = chat.id.clone();
        let active = self.active_chat == Some(index);
        self.expanded_tools
            .retain(|key| !key.starts_with(&format!("{id}/")));
        self.chats.remove(index);
        self.active_chat = match self.active_chat {
            Some(current) if current == index => None,
            Some(current) if current > index => Some(current - 1),
            current => current,
        };
        if self.deleting_chat.as_deref() == Some(id.as_str()) {
            self.deleting_chat = None;
        }
        if active {
            self.composer_restore = Some(gpui_kit::component::input::InputContent::new(""));
            self.composer_state = Default::default();
            self.attachments.clear();
        }
        self.sync_follow(cx);
        cx.notify();
    }
    pub fn new_chat(&mut self, cx: &mut Context<Self>) {
        let empty = self.chats.iter().enumerate().rposition(|(index, chat)| {
            chat.scope == self.scope && chat.workspace == self.workspace && chat.can_retarget()
                && if self.active_chat == Some(index) {
                    self.composer.read(cx).value().trim().is_empty() && self.attachments.is_empty()
                } else {
                    chat.draft.text().trim().is_empty() && chat.draft_references.is_empty()
                }
        });
        if let Some(index) = empty {
            self.focus_chat(Some(index), cx);
        } else {
            self.new_draft(cx);
        }
        cx.emit(crate::ChatAction::Activated);
    }

    pub(crate) fn new_draft(&mut self, cx: &mut Context<Self>) {
        let agent = self
            .agents
            .get(self.agent_index)
            .map(|a| a.id.clone())
            .unwrap_or("codex".into());
        let id = self.next_chat_id();
        self.chats
            .push(Conversation::new(id, agent, self.t("chat.new").into()));
        self.chats.last_mut().unwrap().workspace = self.workspace.clone();
        self.chats.last_mut().unwrap().scope = self.scope.clone();
        self.error = None;
        self.focus_chat(Some(self.chats.len() - 1), cx);
    }

    fn next_chat_id(&mut self) -> String {
        self.next_request += 1;
        #[cfg(target_family = "wasm")]
        let now = js_sys::Date::now() as u64;
        #[cfg(not(target_family = "wasm"))]
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;
        format!("chat-{}-{}", now, self.next_request)
    }

    pub(crate) fn prepare_chat(&mut self, cx: &mut Context<Self>) {
        if !self.connected || !self.replayed || !self.visible || self.workspace.is_empty() {
            return;
        }
        if let Some(i) = self.active_chat {
            if self.chats[i].state == SessionState::Draft
                && self.agents.iter().any(|agent| agent.id == self.chats[i].agent && agent.available)
            {
                self.chats[i].state = SessionState::Connecting;
                self.chats[i].workspace = self.workspace.clone();
                self.command(json!({"action":"new_session","thread_id":self.chats[i].id,"agent_id":self.chats[i].agent,"scope":self.chats[i].scope}),cx);
            }
        }
    }

    pub(crate) fn select_agent(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(agent) = self.agents.get(index).filter(|agent| agent.available) else { return; };
        let id = agent.id.clone();
        if self.active_chat.and_then(|i| self.chats.get(i)).is_some_and(|chat| !chat.can_retarget()) {
            return;
        }
        self.agent_index = index;
        if self.active_chat.is_none() {
            self.new_draft(cx);
        } else if self.active_chat.is_some_and(|i| self.chats[i].agent != id) {
            self.replace_empty_session(id, cx);
        }
        self.prepare_chat(cx);
        cx.notify();
    }

    pub(crate) fn retry_chat(&mut self, cx: &mut Context<Self>) {
        let Some(chat) = self.active_chat.and_then(|i| self.chats.get(i)) else { return; };
        if chat.state == SessionState::Closed && chat.can_retarget() {
            self.replace_empty_session(chat.agent.clone(), cx);
        }
    }

    pub fn replacement_thread(&self, id: &str) -> Option<&str> {
        self.retired_chats.get(id).map(String::as_str)
    }

    fn replace_empty_session(&mut self, agent: String, cx: &mut Context<Self>) {
        let Some(index) = self.active_chat else { return; };
        if !self.chats[index].can_retarget() { return; }
        let mut replacement = Conversation::new(self.next_chat_id(), agent, self.t("chat.new").into());
        replacement.workspace = self.workspace.clone();
        replacement.scope = self.chats[index].scope.clone();
        replacement.draft = self.composer_restore.clone().unwrap_or_else(|| self.composer.read(cx).content());
        replacement.draft_references = self.composer_state.references.clone();
        let old = std::mem::replace(&mut self.chats[index], replacement);
        for replacement in self.retired_chats.values_mut() {
            if *replacement == old.id { *replacement = self.chats[index].id.clone(); }
        }
        self.retired_chats.insert(old.id.clone(), self.chats[index].id.clone());
        for insertion in &mut self.pending_prompts {
            if insertion.thread_id == old.id { insertion.thread_id = self.chats[index].id.clone(); }
        }
        for selected in self.scope_selection.values_mut() {
            if *selected == old.id { *selected = self.chats[index].id.clone(); }
        }
        cx.emit(crate::ChatAction::Selected { thread_id: Some(self.chats[index].id.clone()) });
        if old.state != SessionState::Draft {
            self.command(json!({"action":"delete","thread_id":old.id}), cx);
        }
        self.prepare_chat(cx);
        cx.notify();
    }
    pub fn send_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composer_state.loading && self.composer_state.resolve_range.is_some() { return; }
        let text = self.composer.read(cx).value().trim_end().to_string();
        let draft = crate::conversation::ComposerDraft {
            content: self.composer.read(cx).content(), references: self.composer_state.references.clone(),
        };
        if !self.submit_prompt(text, self.attachments.clone(), cx) { return; }
        self.attachments.clear();
        self.composer_state = Default::default();
        if let Some(chat) = self.active_chat.and_then(|i| self.chats.get_mut(i)) {
            if chat.queued.is_some() { chat.queued_draft = Some(draft); }
            chat.draft = gpui_kit::component::input::InputContent::new("");
            chat.draft_references.clear();
        }
        self.composer.update(cx, |input, cx| input.set_value("", window, cx));
        crate::stream::scroll_after_layout(&self.chat_scroll, window);
    }

    fn restore_queued_prompt(&mut self, index: usize, cx: &mut Context<Self>) {
        let chat = &mut self.chats[index];
        let Some(text) = chat.queued.take() else { return; };
        let contexts = std::mem::take(&mut chat.queued_contexts);
        if let Some(draft) = chat.queued_draft.take() {
            let active = self.active_chat == Some(index);
            let tail = crate::conversation::ComposerDraft {
                content: if active { self.composer.read(cx).content() } else { chat.draft.clone() },
                references: if active { self.composer_state.references.clone() } else { chat.draft_references.clone() },
            };
            let restored = draft.prepend_to(tail);
            chat.draft = restored.content.clone();
            chat.draft_references = restored.references.clone();
            if active {
                self.composer_restore = Some(restored.content);
                self.composer_state = Default::default();
                self.composer_state.references = restored.references;
            }
        } else {
            self.pending_prompts.push(crate::panel::ComposerInsertion { thread_id: chat.id.clone(), text, contexts, replace: false });
        }
    }

    pub fn submit_prompt(&mut self, text: String, contexts: Vec<pero_contracts::context::ContextReference>, cx: &mut Context<Self>) -> bool {
        if text.trim().is_empty() && contexts.is_empty()
            || text.chars().count() > 64000
            || !self.connected
        {
            return false;
        }
        if self.active_chat.is_none() {
            self.new_chat(cx);
        }
        let index = self.active_chat.unwrap();
        if !self.agents.iter().any(|agent| agent.id == self.chats[index].agent && agent.available) {
            return false;
        }
        let chat = &mut self.chats[index];
        if !chat.can_submit() {
            return false;
        }
        if contexts
            .iter()
            .any(|r| r.kind == pero_contracts::context::ContextKind::Image)
            && !chat.session_id.is_empty() && !chat.capabilities.images
        {
            chat.error =
                Some(pero_contracts::i18n::text(&self.locale, "composer.image_unsupported").into());
            cx.notify();
            return false;
        }
        if chat.messages.is_empty() {
            chat.title.prompt(&text);
        }
        chat.error = None;
        let value = if matches!(chat.state, SessionState::Draft | SessionState::Connecting) {
            chat.queued = Some(text);
            chat.queued_contexts = contexts;
            None
        } else {
            chat.state = SessionState::Running;
            Some(json!({"action":"prompt","thread_id":chat.id,"text":text,"contexts":contexts}))
        };
        if let Some(value) = value { self.command(value, cx); } else { self.prepare_chat(cx); }
        cx.notify();
        true
    }
    pub fn receive_chat(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.thread_id.as_ref().is_some_and(|id| self.retired_chats.contains_key(id)) {
            return true;
        }
        if event.kind == "replay" {
            // A refresh is a history snapshot, not a reset of the retained editor
            // or of newer live events that this surface has already observed.
            let selected = self
                .active_chat
                .and_then(|index| self.chats.get(index))
                .map(|chat| chat.id.clone());
            let retained = self
                .chats
                .iter()
                .map(|chat| chat.id.clone())
                .collect::<std::collections::HashSet<_>>();
            if let Some(events) = event.data["events"].as_array() {
                for value in events {
                    if let Ok(replayed) = serde_json::from_value::<HostEvent>(value.clone()) {
                        if replayed
                            .thread_id
                            .as_ref()
                            .is_some_and(|id| !retained.contains(id))
                        {
                            self.receive_chat(&replayed, cx);
                        }
                    }
                }
            }
            for chat in &mut self.chats {
                let active = event.data["active"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(&chat.id)));
                if active && chat.state == SessionState::Draft {
                    chat.state = SessionState::Connecting;
                }
                if !active && chat.state != SessionState::Draft {
                    chat.state = SessionState::Closed;
                    chat.permission = None;
                    chat.pending_model = None;
                    chat.pending_setting = None;
                    chat.flush(cx);
                }
            }
            let interrupted = self.chats.iter().enumerate()
                .filter_map(|(index, chat)| (chat.state == SessionState::Closed && chat.queued.is_some()).then_some(index))
                .collect::<Vec<_>>();
            for index in interrupted { self.restore_queued_prompt(index, cx); }
            // Preparing a draft must not turn unused sessions into history entries
            // after a Host restart. Retained drafts still own their local input.
            self.chats.retain(|chat| retained.contains(&chat.id)
                || !chat.messages.is_empty()
                || event.data["active"].as_array().is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(&chat.id))));
            let initial_empty = !self.replayed
                && self.pending_prompts.is_empty()
                && self.composer.read(cx).value().is_empty()
                && selected
                    .as_ref()
                    .and_then(|id| self.chats.iter().find(|chat| &chat.id == id))
                    .is_some_and(|chat| chat.state == SessionState::Draft && chat.draft.text().is_empty());
            let restored = initial_empty
                .then(|| {
                    self.chats
                        .iter()
                        .rposition(|chat| chat.scope == self.scope && chat.state != SessionState::Draft)
                })
                .flatten();
            let next = restored
                .or_else(|| {
                    selected
                        .as_ref()
                        .and_then(|id| self.chats.iter().position(|chat| &chat.id == id))
                })
                .or_else(|| self.chats.iter().rposition(|chat| chat.scope == self.scope));
            let first_replay = !self.replayed;
            self.replayed = true;
            self.focus_chat(next, cx);
            if next.is_none() && self.visible { self.new_draft(cx); }
            if first_replay && self.visible { self.retry_chat(cx); }
            cx.notify();
            return true;
        }
        if event.kind == "agents" {
            let selected = self.agents.get(self.agent_index).map(|agent| agent.id.clone());
            self.agents = serde_json::from_value(event.data.clone()).unwrap_or_default();
            self.agent_index = selected.and_then(|id| self.agents.iter().position(|agent| agent.id == id && agent.available))
                .or_else(|| self.agents.iter().position(|agent| agent.available)).unwrap_or(0);
            self.workspace = event.text.clone();
            if let Some(index) = self.active_chat {
                if self.chats[index].state == SessionState::Draft {
                    if let Some(agent) = self.agents.get(self.agent_index) { self.chats[index].agent = agent.id.clone(); }
                }
            }
            self.prepare_chat(cx);
            cx.notify();
            return true;
        }
        if event.kind == "context_files" {
            self.next_request += 1;
            self.composer_state.pending_files = event
                .data
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|file| {
                    let source = file["path"].as_str()?.to_string();
                    Some(pero_contracts::context::ContextReference {
                        id: format!("file:{}:{source}", self.next_request),
                        kind: pero_contracts::context::ContextKind::File,
                        label: file["name"].as_str()?.into(),
                        source,
                        content: pero_contracts::context::ContextContent::Text {
                            text: file["text"].as_str()?.into(),
                        },
                    })
                })
                .collect();
            cx.notify();
            return true;
        }
        if event.kind == "workspace" {
            self.workspace = event.text.clone();
            if let Some(chat) = self.active_chat.and_then(|i| self.chats.get(i)) {
                if chat.workspace != self.workspace && chat.can_retarget() {
                    self.replace_empty_session(chat.agent.clone(), cx);
                }
            }
            self.prepare_chat(cx);
            cx.notify();
            return true;
        }
        let Some(id) = event.thread_id.as_ref() else {
            return false;
        };
        if event.kind == "session_created" && !self.chats.iter().any(|c| &c.id == id) {
            self.chats.push(Conversation::new(
                id.clone(),
                event.data["agent"].as_str().unwrap_or("ACP").into(),
                self.t("chat.new").into(),
            ));
        }
        let Some(index) = self.chats.iter().position(|c| &c.id == id) else {
            return true;
        };
        if event.kind == "session_deleted" {
            self.forget_chat(index, cx);
            return true;
        }
        let chat = &mut self.chats[index];
        let mut followup = None;
        let mut restore_queue = false;
        match event.kind.as_str() {
            "session_created" => {
                chat.workspace = event.data["workspace"].as_str().unwrap_or_default().into();
                chat.scope = event
                    .data
                    .get("scope")
                    .and_then(|value| serde_json::from_value(value.clone()).ok());
            }
            "agent_info" => {
                chat.capabilities =
                    pero_contracts::composer_capabilities::AgentCapabilities::from_initialize(
                        &event.data,
                    )
                    .unwrap_or_default();
                chat.auth_methods = serde_json::from_value(event.data["authMethods"].clone()).unwrap_or_default()
            }
            "session_authenticated" => {
                chat.state = SessionState::Idle;
                chat.error = None;
            }
            "session_auth_required" | "session_auth_error" => {
                if let Ok(methods) = serde_json::from_value(event.data["authMethods"].clone()) { chat.auth_methods = methods; }
                chat.error = Some(event.text.clone());
                chat.state = SessionState::AuthRequired;
            }
            "user_message" => {
                if chat.messages.is_empty() {
                    chat.title.prompt(&event.text);
                }
                chat.push_user(event.text.clone(), cx);
                if let Some(message) = chat.messages.last_mut() {
                    message.attached_files = event.data["contexts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|r| r["label"].as_str().map(str::to_string))
                        .collect();
                }
            }
            "session_connecting" => chat.state = SessionState::Connecting,
            "session_ready" => {
                chat.session_id = event.data["sessionId"].as_str().unwrap_or_default().into();
                chat.config(&event.data);
                chat.state = SessionState::Idle;
                if chat.queued.is_some() && !chat.capabilities.images && chat.queued_contexts.iter().any(|r|r.kind==pero_contracts::context::ContextKind::Image) {
                    chat.error=Some(pero_contracts::i18n::text(&self.locale,"composer.image_unsupported").into());
                    restore_queue = true;
                } else if let Some(text) = chat.queued.take() {
                    chat.state = SessionState::Running;
                    chat.queued_draft = None;
                    let contexts = std::mem::take(&mut chat.queued_contexts);
                    let value = json!({"action":"prompt","thread_id":chat.id,"text":text,"contexts":contexts});
                    followup = Some(value);
                }
            }
            "session_update" => {
                if !chat.update(&event.data, cx) {
                    return true;
                }
            }
            "model_changed" => {
                chat.config(&event.data);
                chat.pending_model = None;
            }
            "configuration_changed" => {
                if let Ok(settings) = serde_json::from_value(event.data.clone()) {
                    chat.settings = settings;
                }
                chat.pending_setting = None;
            }
            "session_usage" => {
                if let Ok(usage) = serde_json::from_value(event.data.clone()) {
                    chat.usage = Some(usage);
                }
            }
            "turn_started" => chat.state = SessionState::Running,
            "turn_finished" => {
                chat.thinking.streaming(None);
                chat.flush(cx);
                chat.state = SessionState::Idle;
                chat.permission = None;
            }
            "permission" => {
                chat.permission_bounds = event.data["options"].as_array().into_iter().flatten().map(|_|Default::default()).collect();
                chat.permission = Some(event.data.clone());
            },
            "session_error" => {
                chat.thinking.streaming(None);
                chat.pending_setting = None;
                chat.pending_model = None;
                chat.flush(cx);
                chat.error = Some(event.text.clone());
                chat.state = if chat.session_id.is_empty() { SessionState::Closed } else { SessionState::Idle };
                chat.permission = None;
            }
            "session_closed" => {
                chat.thinking.streaming(None);
                chat.pending_setting = None;
                chat.pending_model = None;
                chat.flush(cx);
                chat.state = SessionState::Closed;
                chat.permission = None;
            }
            _ => {}
        }
        restore_queue |= matches!(chat.state, SessionState::Closed | SessionState::AuthRequired);
        if restore_queue { self.restore_queued_prompt(index, cx); }
        if let Some(value) = followup { self.command(value, cx); }
        if self.composer_state.open
            && matches!(
                self.composer_state.completion.as_ref().map(|q| &q.kind),
                Some(crate::composer_state::CompletionKind::Slash)
            )
            && event.data["sessionUpdate"] == "available_commands_update"
        {
            self.refresh_composer_commands();
        }
        self.sync_follow(cx);
        cx.notify();
        true
    }
    pub fn chat_view(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if crate::stream::near_bottom(&self.chat_scroll) {
            crate::stream::scroll_after_layout(&self.chat_scroll, window);
        }
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let chat = self.active_chat.and_then(|i| self.chats.get(i));
        let busy = chat.is_some_and(|c| c.busy());
        let id = chat.map(|c| c.id.clone()).unwrap_or_default();
        let agent = chat
            .map(|c| c.agent.clone())
            .or_else(|| self.agents.get(self.agent_index).map(|a| a.id.clone()))
            .unwrap_or_else(|| "codex".into());
        div().flex_1().min_h_0().flex().flex_col()
            .when(self.show_return_to_review,|el|el.child(
                div().px(px(16.)).py(px(8.)).border_b_1().border_color(p.border).child(
                    Button::new("contribution-return").outline().small().label(self.t("contribution.return_review")).on_click(cx.listener(|_,_,_,cx|{
                        cx.emit(crate::ChatAction::ReturnToReview);
                    })))))
            .child(div().id("messages").flex_1().min_h_0().overflow_y_scroll().track_scroll(&self.chat_scroll).px(px(16.)).py(px(10.))
                .when(chat.is_none_or(|c|c.messages.is_empty()),|el|el.child(div().py(px(24.)).flex().flex_col().gap(px(12.))
                    .child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Heading)).font_weight(FontWeight::BOLD).child(self.t("chat.welcome")))
                    .child(div().text_color(p.text_muted).child(self.t(if self.connected && !self.agents.iter().any(|agent|agent.available){"chat.install_agent"}else{"chat.description"})))))
                .children(chat.into_iter().flat_map(render_items).enumerate().filter_map(|(i,item)|{
                    let conversation=chat?;
                    match item {
                        RenderItem::Message(index)=>{
                            let message=conversation.messages.get(index)?;
                            if message.role=="thought" {
                                let thread = conversation.id.clone();
                                let open = conversation.thinking.open(index);
                                return Some(div().id(("thought",i)).mb(px(8.)).flex().flex_col()
                                    .child(Button::new(("thought-toggle",i)).relative().child(message.toggle_bounds.probe())
                                        .ghost().small().w_full().justify_start().px_0()
                                        .text_color(p.text_muted)
                                        .accessibility_label(self.t("chat.reasoning"))
                                        .child(self.icon(if open { "chevron-down" } else { "chevron-right" }).size(px(14.)).text_color(p.text_muted))
                                        .child(div().flex_1().text_left().text_color(p.text_muted).child(self.t("chat.reasoning")))
                                        .on_click(cx.listener(move |this,_,_,cx|{
                                            if let Some(chat) = this.chats.iter_mut().find(|chat|chat.id==thread) { chat.thinking.toggle(index); }
                                            cx.notify();
                                        })))
                                    .when(open,|el|el.child(div().pl(px(20.)).child(message.view.clone()))).into_any_element());
                            }
                            Some(div().id(("message",i)).mb(px(10.)).flex().flex_col().gap(px(3.))
                                .child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).font_weight(FontWeight::BOLD).text_color(p.text_muted).child(if message.role=="user"{self.t("chat.you").to_string()}else{agent.clone()}))
                                .child(message.view.clone())
                                .when(!message.attached_files.is_empty(),|el|el.child(div().flex().flex_wrap().gap(px(8.)).text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted)
                                    .children(message.attached_files.iter().map(|name|div().flex().items_center().gap(px(4.)).child(self.icon("file").size(px(13.))).child(name.clone())))))
                                .into_any_element())
                        },
                        RenderItem::Tools(indices)=>{
                            let tools=indices.iter().filter_map(|index|conversation.tools.get(*index)).collect::<Vec<_>>();
                            if tools.is_empty() { return None; }
                            Some(self.tool_group(&conversation.id, tools, i, cx))
                        }

                    }
                }))
                .when(busy,|el|el.child(div().text_color(p.text_muted).child(self.t(if chat.is_some_and(|c|c.state==SessionState::Connecting){"chat.preparing"}else{"chat.thinking"}))))
                .when(chat.is_some_and(|c|c.error.is_some() && c.state!=SessionState::AuthRequired),|el|el.child(div().p(px(14.)).bg(p.error_bg).text_color(p.error).rounded(px(6.)).child(chat.and_then(|c|c.error.clone()).unwrap_or_default()))))
            .children(chat.filter(|c|c.state==SessionState::AuthRequired).into_iter().map(|chat|{
                div().mx(px(16.)).mb(px(10.)).p(px(12.)).bg(p.warning_bg).rounded(px(4.))
                    .child(div().font_weight(FontWeight::BOLD).child(self.t("chat.signin")))
                    .when_some(chat.error.clone(),|el,error|el.child(div().mt(px(4.)).text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).child(error)))
                    .child(div().mt(px(8.)).flex().gap(px(8.)).children(chat.auth_methods.iter().enumerate().map(|(i,method)|{
                        let method_id=method.id.clone();let thread=chat.id.clone();let interactive=method.kind.as_deref()==Some("terminal");
                        let command=method.terminal_command();
                        div().flex().flex_col().gap(px(8.))
                            .when_some(command,|el,command|el
                                .child(self.t("chat.login_in_terminal"))
                                .child(div().font_family("monospace").child(command)))
                            .when(command.is_none() && !method.description.is_empty(),|el|el.child(method.description.clone()))
                            .child(Button::new(("auth-method",i)).outline().small()
                                .label(if command.is_some(){self.t("chat.login_complete").to_string()}else if interactive{self.t("chat.terminal_login").to_string()}else{method.name.clone()})
                                .disabled(interactive && command.is_none())
                                .on_click(cx.listener(move|this,_,_,cx|this.command(json!({"action":"authenticate","thread_id":thread,"method_id":method_id}),cx))))
                    })))
            }))
            .children(self.approval(&id, None, cx))
            .children(chat.and_then(|c| c.usage.as_ref()).map(|usage| crate::usage::render_usage(usage, &self.locale, p, cx)))
            .child(self.composer_view(window, cx))
    }
}
