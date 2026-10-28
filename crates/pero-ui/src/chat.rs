use crate::{
    app::{Workbench, session_command},
    conversation::{Conversation, StreamItem},
};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::HostEvent;
use serde_json::{Value, json};

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

impl Workbench {
    pub fn sync_follow(&mut self, cx: &mut Context<Self>) {
        for (i, chat) in self.chats.iter_mut().enumerate() {
            let enabled = self.active_chat == Some(i) && self.tab == 4 && self.navigation == 0;
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
                tool.set_body_open(open_tools.contains(&index), cx);
                if let Some(view) = &tool.view {
                    view.update(cx, |view, _| {
                        view.set_scroll_handle(enabled.then(|| self.chat_scroll.clone()))
                    });
                }
            }
        }
    }
    pub fn focus_chat(&mut self, index: Option<usize>, tab: usize, cx: &mut Context<Self>) {
        self.active_chat = index;
        self.tab = tab;
        self.sync_follow(cx);
        cx.notify();
    }
    pub fn command(&mut self, value: Value, cx: &mut Context<Self>) {
        if session_command(&value.to_string()).is_err() {
            if let Some(chat) = self.active_chat.and_then(|index| self.chats.get_mut(index)) {
                chat.pending_model = None;
                chat.pending_setting = None;
            }
            self.error = Some("error.connection".into());
        }
        cx.notify();
    }
    pub fn new_chat(&mut self, cx: &mut Context<Self>) {
        let agent = self
            .agents
            .get(self.agent_index)
            .map(|a| a.id.clone())
            .unwrap_or("codex".into());
        #[cfg(target_family = "wasm")]
        let now = js_sys::Date::now() as u64;
        #[cfg(not(target_family = "wasm"))]
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
        let id = format!("chat-{}-{}", now, self.chats.len());
        self.chats
            .push(Conversation::new(id, agent, self.t("chat.new").into()));
        self.navigation = 0;
        self.error = None;
        self.focus_chat(Some(self.chats.len() - 1), 4, cx);
    }
    pub fn connect_chat(&mut self, cx: &mut Context<Self>) {
        if let Some(i) = self.active_chat {
            if self.chats[i].state == "draft" {
                self.chats[i].state = "connecting".into();
                self.command(json!({"action":"new_session","thread_id":self.chats[i].id,"agent_id":self.chats[i].agent}),cx);
            }
        }
    }
    pub fn send_chat(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let mut text = self.composer.read(cx).value().trim_end().to_string();
        if !self.attachments.is_empty() {
            text.push_str("\n\nUser-selected context files (data):\n");
            text.push_str(&serde_json::to_string(&self.attachments).unwrap_or_default());
        }
        if text.trim().is_empty() || text.chars().count() > 64000 || !self.connected {
            return;
        }
        if self.active_chat.is_none() {
            self.new_chat(cx);
        }
        let index = self.active_chat.unwrap();
        let chat = &mut self.chats[index];
        if !matches!(chat.state.as_str(), "draft" | "idle") || chat.pending_model.is_some() || chat.pending_setting.is_some() {
            return;
        }
        if chat.messages.is_empty() {
            chat.title = Conversation::title_from(&text);
        }
        chat.error = None;
        let value = if chat.state == "draft" {
            chat.state = "connecting".into();
            chat.queued = Some(text);
            json!({"action":"new_session","thread_id":chat.id,"agent_id":chat.agent})
        } else {
            chat.state = "running".into();
            json!({"action":"prompt","thread_id":chat.id,"text":text})
        };
        self.attachments.clear();
        self.composer
            .update(cx, |input, cx| input.set_value("", window, cx));
        crate::stream::scroll_after_layout(&self.chat_scroll, window);
        self.command(value, cx);
    }
    pub fn receive_chat(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "replay" {
            self.chats.clear();
            self.active_chat = None;
            if let Some(events) = event.data["events"].as_array() {
                for value in events {
                    if let Ok(event) = serde_json::from_value(value.clone()) {
                        self.receive_chat(&event, cx);
                    }
                }
            }
            for chat in &mut self.chats {
                if !event.data["active"]
                    .as_array()
                    .is_some_and(|ids| ids.iter().any(|id| id.as_str() == Some(&chat.id)))
                {
                    chat.state = "closed".into();
                }
                chat.queued = None;
                if chat.state == "closed" {
                    chat.permission = None;
                }
            }
            cx.notify();
            return true;
        }
        if event.kind == "agents" {
            self.agents = serde_json::from_value(event.data.clone()).unwrap_or_default();
            self.workspace = event.text.clone();
            cx.notify();
            return true;
        }
        if event.kind == "context_files" {
            self.attachments = event.data.as_array().cloned().unwrap_or_default();
            cx.notify();
            return true;
        }
        if event.kind == "workspace" {
            self.workspace = event.text.clone();
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
        let chat = &mut self.chats[index];
        match event.kind.as_str() {
            "agent_info" => {
                chat.auth_methods = event.data["authMethods"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default()
            }
            "session_authenticated" => {
                chat.state = "idle".into();
                chat.error = None;
            }
            "session_auth_required" | "session_auth_error" => {
                chat.auth_methods = event.data["authMethods"]
                    .as_array()
                    .cloned()
                    .unwrap_or_else(|| chat.auth_methods.clone());
                chat.error = Some(event.text.clone());
                chat.state = "auth_required".into();
            }
            "user_message" => {
                if chat.messages.is_empty() {
                    chat.title = Conversation::title_from(&event.text);
                }
                chat.push_user(event.text.clone(), cx);
            }
            "session_connecting" => chat.state = "connecting".into(),
            "session_ready" => {
                chat.session_id = event.data["sessionId"].as_str().unwrap_or_default().into();
                chat.config(&event.data);
                chat.state = "idle".into();
                if let Some(text) = chat.queued.take() {
                    chat.state = "running".into();
                    let value = json!({"action":"prompt","thread_id":chat.id,"text":text});
                    self.command(value, cx);
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
                if let Ok(settings) = serde_json::from_value(event.data.clone()) { chat.settings = settings; }
                chat.pending_setting = None;
            }
            "turn_started" => chat.state = "running".into(),
            "turn_finished" => {
                chat.flush(cx);
                chat.state = "idle".into();
                chat.permission = None;
            }
            "permission" => chat.permission = Some(event.data.clone()),
            "session_error" => {
                chat.pending_setting = None;
                chat.pending_model = None;
                chat.flush(cx);
                chat.error = Some(event.text.clone());
                chat.state = "idle".into();
                chat.permission = None;
            }
            "session_closed" => {
                chat.pending_setting = None;
                chat.pending_model = None;
                chat.flush(cx);
                chat.state = "closed".into();
                chat.permission = None;
            }
            _ => {}
        }
        self.sync_follow(cx);
        cx.notify();
        true
    }
    pub fn chat_view(&self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if crate::stream::near_bottom(&self.chat_scroll) {
            crate::stream::scroll_after_layout(&self.chat_scroll, window);
        }
        let p = self.palettes.get(self.dark);
        let chat = self.active_chat.and_then(|i| self.chats.get(i));
        let busy = chat.is_some_and(|c| c.busy());
        let id = chat.map(|c| c.id.clone()).unwrap_or_default();
        let agent = chat
            .map(|c| c.agent.clone())
            .or_else(|| self.agents.get(self.agent_index).map(|a| a.id.clone()))
            .unwrap_or_else(|| "codex".into());
        div().flex_1().min_h_0().flex().flex_col()
            .when(self.contribution.data["local"]["thread_id"].as_str()==Some(id.as_str()),|el|el.child(
                div().px(px(16.)).py(px(8.)).border_b_1().border_color(p.color("border")).child(
                    Button::new("contribution-return").outline().small().label(self.t("contribution.return_review")).on_click(cx.listener(|this,_,_,cx|{
                        this.remote.public_contributions=true;this.navigation=3;this.sync_follow(cx);cx.notify();
                    })))))
            .child(div().id("messages").flex_1().min_h_0().overflow_y_scroll().track_scroll(&self.chat_scroll).px(px(16.)).py(px(10.))
                .when(chat.is_none_or(|c|c.messages.is_empty()),|el|el.child(div().py(px(24.)).flex().flex_col().gap(px(12.))
                    .child(div().text_size(px(18.)).font_weight(FontWeight::BOLD).child(self.t("chat.welcome")))
                    .child(div().text_color(p.color("text-muted")).child(self.t("chat.description")))))
                .children(chat.into_iter().flat_map(render_items).enumerate().filter_map(|(i,item)|{
                    let conversation=chat?;
                    match item {
                        RenderItem::Message(index)=>{
                            let message=conversation.messages.get(index)?;
                            if message.role=="thought" {
                                return Some(div().id(("thought",i)).mb(px(10.))
                                    .child(Button::new(("thought-toggle",i)).ghost().small().icon(IconName::ChevronDown).label(self.t("chat.reasoning"))
                                        .on_click(cx.listener(|this,_,_,cx|{this.show_details=!this.show_details;cx.notify();})))
                                    .when(self.show_details,|el|el.child(message.view.clone())).into_any_element());
                            }
                            Some(div().id(("message",i)).mb(px(10.)).flex().flex_col().gap(px(3.))
                                .child(div().text_size(px(11.)).font_weight(FontWeight::BOLD).text_color(p.color("text-muted")).child(if message.role=="user"{self.t("chat.you").to_string()}else{agent.clone()}))
                                .child(message.view.clone())
                                .when(!message.attached_files.is_empty(),|el|el.child(div().flex().flex_wrap().gap(px(8.)).text_size(px(11.)).text_color(p.color("text-muted"))
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
                .when(busy,|el|el.child(div().text_color(p.color("text-muted")).child(self.t("chat.thinking"))))
                .when(chat.and_then(|c|c.error.as_ref()).is_some(),|el|el.child(div().p(px(14.)).bg(p.color("error-bg")).text_color(p.color("error")).rounded(px(6.)).child(chat.and_then(|c|c.error.clone()).unwrap_or_default()))))
            .children(chat.filter(|c|c.state=="auth_required").into_iter().map(|chat|{
                div().mx(px(16.)).mb(px(10.)).p(px(12.)).bg(p.color("warning-bg")).rounded(px(4.))
                    .child(div().font_weight(FontWeight::BOLD).child(self.t("chat.signin")))
                    .child(div().mt(px(8.)).flex().gap(px(8.)).children(chat.auth_methods.iter().enumerate().map(|(i,method)|{
                        let method_id=method["id"].as_str().unwrap_or_default().to_string();let thread=chat.id.clone();let interactive=method["type"].as_str()==Some("terminal");
                        Button::new(("auth-method",i)).outline().small().label(if interactive{format!("{} · {}",method["name"].as_str().unwrap_or("Login"),self.t("chat.terminal_login"))}else{method["name"].as_str().unwrap_or("Login").to_string()}).disabled(interactive)
                            .on_click(cx.listener(move|this,_,_,cx|this.command(json!({"action":"authenticate","thread_id":thread,"method_id":method_id}),cx)))
                    })))
            }))
            .children(chat.and_then(|c|c.permission.as_ref()).into_iter().map(|permission|{
                let request=permission["permission_id"].as_str().unwrap_or_default().to_string();
                div().mx(px(28.)).mb(px(12.)).p(px(14.)).rounded(px(6.)).bg(p.color("warning-bg"))
                    .child(div().font_weight(FontWeight::BOLD).child(self.t("chat.permission")))
                    .child(div().my(px(10.)).child(permission["toolCall"]["title"].as_str().unwrap_or_default().to_string()))
                    .child(div().flex().gap(px(8.)).children(permission["options"].as_array().into_iter().flatten().enumerate().map(|(i,option)|{
                        let option_id=option["optionId"].as_str().unwrap_or_default().to_string();let thread=id.clone();let request=request.clone();
                        Button::new(("permission",i)).label(option["name"].as_str().unwrap_or("Allow").to_string()).on_click(cx.listener(move|this,_,_,cx|{
                            this.command(json!({"action":"permission","thread_id":thread,"request_id":request,"option_id":option_id}),cx);
                            if let Some(i)=this.active_chat{this.chats[i].permission=None;}cx.notify();
                        }))
                    })))
            }))
            .child(self.composer_view(cx))
    }
}
