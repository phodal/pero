use crate::artifact_read::ArtifactView;
use crate::session_state::SessionState;
use crate::{content_reader::ContentReader, stream::StreamText};
use pero_contracts::content_document::ContentDocument;
use gpui_kit::{App, AppContext as _, Entity};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Deserialize, Serialize)]
pub struct AgentChoice {
    pub id: String,
    pub name: String,
    pub available: bool,
}

#[derive(Clone, Serialize)]
pub struct Message {
    pub role: String,
    pub text: String,
    pub attached_files: Vec<String>,
    #[serde(skip)]
    pub view: Entity<StreamText>,
    #[serde(skip)]
    pub(crate) toggle_bounds: crate::view_bounds::ViewBounds,
}

impl Message {
    pub fn new(role: impl Into<String>, text: impl Into<String>, cx: &mut App) -> Self {
        let role = role.into();
        let text = text.into();
        let streamed = matches!(role.as_str(), "assistant" | "thought");
        let context = (role == "user")
            .then(|| text.rsplit_once("\n\nUser-selected context files (data):\n"))
            .flatten()
            .and_then(|(prompt, data)| {
                serde_json::from_str::<Vec<Value>>(data)
                    .ok()
                    .filter(|files| {
                        files.iter().all(|file| {
                            file["name"].is_string()
                                && file["path"].is_string()
                                && file["text"].is_string()
                        })
                    })
                    .map(|files| (prompt, files))
            });
        let display = context.as_ref().map(|(prompt, _)| *prompt).unwrap_or(&text);
        let attached_files = context
            .as_ref()
            .map(|(_, files)| {
                files
                    .iter()
                    .filter_map(|file| file["name"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let view = cx.new(|cx| StreamText::new(if streamed { "" } else { display }, cx));
        view.update(cx, |view, _| view.appearance = if role == "thought" { crate::stream::StreamAppearance::Thought } else { crate::stream::StreamAppearance::Answer });
        if streamed {
            view.update(cx, |view, cx| view.append(&text, cx));
        }
        Self {
            role,
            text,
            attached_files,
            toggle_bounds: Default::default(),
            view,
        }
    }

    fn append(&mut self, delta: &str, cx: &mut App) {
        self.text.push_str(delta);
        self.view.update(cx, |view, cx| view.append(delta, cx));
    }
}

#[derive(Clone, Serialize)]
pub struct Tool {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub locations: Vec<String>,
    pub status: String,
    pub content: String,
    /// Original ACP output, including diffs and terminal references. Arguments
    /// are intentionally kept out of the default tool presentation.
    pub output: Vec<Value>,
    pub transcript: crate::tool_transcript::ToolTranscript,
    pub input_open: bool,
    #[serde(skip)]
    pub input_view: Option<Entity<StreamText>>,
    #[serde(skip)]
    pub(crate) input_bounds: crate::view_bounds::ViewBounds,
    pub cancelled: bool,
    pub document: Option<ContentDocument>,
    pub artifact: Option<ArtifactView>,
    #[serde(skip)]
    pub(crate) artifact_bounds: crate::view_bounds::ViewBounds,
    #[serde(skip)]
    pub reader: Option<Entity<ContentReader>>,
    #[serde(skip)]
    pub(crate) toggle_bounds: crate::view_bounds::ViewBounds,
    #[serde(skip)]
    pub view: Option<Entity<StreamText>>,
}

impl Tool {
    /// Materialize Markdown on first disclosure; retain reading state thereafter.
    pub fn set_body_open(&mut self, open: bool, cx: &mut App) {
        if open {
            if self.document.is_none() && self.view.is_none() {
                self.view = Some(cx.new(|cx| { let mut view = StreamText::new(&self.content, cx); view.appearance = crate::stream::StreamAppearance::Tool; view }));
            }
        }
        // Closing a presentation must retain its selection, folds and search.
        // Unmounted entities do not render; new results are still materialized
        // only after the user opens them.
    }
}

/// Stable references into the message/tool stores, in observed ACP order.
/// Updates mutate their existing store entry without moving the timeline row.
#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", content = "index", rename_all = "snake_case")]
pub enum StreamItem {
    Message(usize),
    Tool(usize),
}

#[derive(Clone)]
pub struct ComposerDraft {
    pub content: gpui_kit::component::input::InputContent,
    pub references: std::collections::HashMap<String, pero_contracts::context::ContextReference>,
}

impl ComposerDraft {
    /// Restore the submitted draft before any input typed while preparation was pending.
    pub fn prepend_to(mut self, tail: Self) -> Self {
        if tail.content.text().is_empty() { return self; }
        let offset = self.content.text().len() + 1;
        let mut content = gpui_kit::component::input::InputContent::new(format!("{}\n{}", self.content.text(), tail.content.text()));
        for span in self.content.tokens() {
            content = content.with_token(span.range(), span.token().clone()).expect("retained draft token");
        }
        for span in tail.content.tokens() {
            let range = span.range();
            content = content.with_token(range.start + offset..range.end + offset, span.token().clone()).expect("shifted draft token");
        }
        self.content = content;
        self.references.extend(tail.references);
        self
    }
}

#[derive(Clone, Serialize)]
pub struct Conversation {
    pub workspace: String,
    pub scope: Option<pero_contracts::AppChatScope>,
    pub usage: Option<pero_contracts::usage::SessionUsage>,
    pub id: String,
    pub title: crate::conversation_title::ConversationTitle,
    #[serde(skip)]
    pub thinking: crate::thinking::ThinkingState,
    pub agent: String,
    pub state: SessionState,
    pub session_id: String,
    pub messages: Vec<Message>,
    pub tools: Vec<Tool>,
    pub timeline: Vec<StreamItem>,
    pub queued: Option<String>,
    pub queued_contexts: Vec<pero_contracts::context::ContextReference>,
    #[serde(skip)]
    pub queued_draft: Option<ComposerDraft>,
    pub capabilities: pero_contracts::composer_capabilities::AgentCapabilities,
    pub commands: Vec<pero_contracts::composer_capabilities::AgentCommand>,
    #[serde(skip)]
    pub draft: gpui_kit::component::input::InputContent,
    #[serde(skip)]
    pub draft_references:
        std::collections::HashMap<String, pero_contracts::context::ContextReference>,
    pub permission: Option<Value>,
    #[serde(skip)]
    pub(crate) permission_bounds: Vec<crate::view_bounds::ViewBounds>,
    pub auth_methods: Vec<crate::authentication::AuthenticationMethod>,
    pub models: Vec<(String, String)>,
    pub model: String,
    pub pending_model: Option<String>,
    pub settings: pero_contracts::session_settings::SessionSettings,
    pub pending_setting: Option<pero_contracts::session_settings::SettingSelection>,
    pub error: Option<String>,
}

impl Conversation {
    pub fn new(id: String, agent: String, title: String) -> Self {
        Self {
            workspace: String::new(),
            scope: None,
            usage: None,
            id,
            agent,
            title: crate::conversation_title::ConversationTitle::new(title),
            thinking: Default::default(),
            state: SessionState::Draft,
            session_id: String::new(),
            messages: vec![],
            tools: vec![],
            timeline: vec![],
            queued: None,
            queued_contexts: vec![],
            queued_draft: None,
            capabilities: Default::default(),
            commands: vec![],
            draft: gpui_kit::component::input::InputContent::new(""),
            draft_references: Default::default(),
            permission: None,
            permission_bounds: vec![],
            auth_methods: vec![],
            models: vec![],
            model: String::new(),
            pending_model: None,
            settings: Default::default(),
            pending_setting: None,
            error: None,
        }
    }

    pub fn can_retarget(&self) -> bool {
        self.state.can_retarget(!self.messages.is_empty(), self.queued.is_some())
    }

    pub fn can_submit(&self) -> bool {
        self.state.can_submit() && self.queued.is_none()
            && self.pending_model.is_none() && self.pending_setting.is_none()
    }

    pub fn busy(&self) -> bool {
        self.state.busy()
    }

    pub fn push_user(&mut self, text: impl Into<String>, cx: &mut App) {
        self.thinking.streaming(None);
        self.flush(cx);
        let index = self.messages.len();
        self.messages.push(Message::new("user", text, cx));
        self.timeline.push(StreamItem::Message(index));
    }

    /// True means the surrounding conversation structure changed. A pure text
    /// delta only updates the retained message entity; its 16 ms flush drives
    /// rendering without requiring the whole workbench to redraw for each token.
    pub fn update(&mut self, data: &Value, cx: &mut App) -> bool {
        match data["sessionUpdate"].as_str().unwrap_or_default() {
            "agent_message_chunk" | "agent_thought_chunk" => {
                let Some(text) = data["content"]["text"]
                    .as_str()
                    .filter(|text| !text.is_empty())
                else {
                    return false;
                };
                let role = if data["sessionUpdate"] == "agent_message_chunk" {
                    "assistant"
                } else {
                    "thought"
                };
                // A tool call breaks an assistant segment even when the next
                // text chunk has the same role. Otherwise text after a tool
                // would incorrectly be appended above that tool's timeline row.
                if let Some(StreamItem::Message(index)) = self.timeline.last() {
                    if let Some(last) = self
                        .messages
                        .get_mut(*index)
                        .filter(|message| message.role == role)
                    {
                        last.append(text, cx);
                        return false;
                    }
                }
                // Preserve old message state (including code blocks and text
                // selection) when a new assistant/thought segment starts.
                self.flush(cx);
                let index = self.messages.len();
                self.thinking.streaming((role == "thought").then_some(index));
                self.messages.push(Message::new(role, text, cx));
                self.timeline.push(StreamItem::Message(index));
                true
            }
            "tool_call" | "tool_call_update" => {
                self.thinking.streaming(None);
                let id = data["toolCallId"].as_str().unwrap_or("tool").to_string();
                let index = self
                    .tools
                    .iter()
                    .position(|tool| tool.id == id)
                    .unwrap_or_else(|| {
                        self.tools.push(Tool {
                            id: id.clone(),
                            title: "Tool".into(),
                            kind: "other".into(),
                            locations: vec![],
                            status: "pending".into(),
                            content: String::new(),
                            output: vec![],
                            transcript: Default::default(),
                            input_open: false,
                            input_view: None,
                            input_bounds: Default::default(),
                            cancelled: false,
                            document: None,
                            artifact: None,
                            artifact_bounds: Default::default(),
                            reader: None,
                            toggle_bounds: Default::default(),
                            view: None,
                        });
                        self.tools.len() - 1
                    });
                if data["sessionUpdate"] == "tool_call"
                    && !self.timeline.contains(&StreamItem::Tool(index))
                {
                    self.flush(cx);
                    self.timeline.push(StreamItem::Tool(index));
                }
                let tool = &mut self.tools[index];
                if let Some(title) = data["title"].as_str() {
                    tool.title = title.into();
                }
                if let Some(kind) = data["kind"].as_str() {
                    tool.kind = kind.into();
                }
                if let Some(locations) = data["locations"].as_array() {
                    tool.locations = locations
                        .iter()
                        .filter_map(|location| location["path"].as_str().map(str::to_string))
                        .collect();
                }
                if let Some(status) = data["status"].as_str() {
                    tool.status = status.into();
                }
                if data["_meta"]["cancelled"].as_bool() == Some(true)
                    || data["rawOutput"]["cancelled"].as_bool() == Some(true)
                    || tool.status == "cancelled"
                {
                    tool.cancelled = true;
                }
                let patch = match serde_json::from_value::<crate::tool_transcript::ToolTranscriptPatch>(data.clone()) {
                    Ok(patch) => patch,
                    Err(error) => { self.error = Some(error.to_string()); return true; }
                };
                tool.transcript.apply(patch);
                tool.output = tool.transcript.output();
                if let Some(view) = &tool.input_view {
                    let text = tool.transcript.input_text().unwrap_or_default();
                    view.update(cx, |view, cx| view.replace(&format!("```json\n{text}\n```"), cx));
                }
                let next = tool.output
                    .iter()
                    .filter_map(|item| {
                        item["content"]["text"]
                            .as_str()
                            .or_else(|| item["content"]["resource"]["text"].as_str())
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                if next != tool.content {
                    let revision = tool.document.as_ref().map_or(1, |document| document.revision + 1);
                    tool.artifact = ArtifactView::from_content(&next);
                    tool.document = ContentDocument::from_tool(
                        format!("{}/{}", self.id, tool.id), revision, &next,
                    );
                    if let Some(document) = &tool.document {
                        tool.view = None;
                        if let Some(reader) = &tool.reader {
                            reader.update(cx, |reader, cx| reader.replace(document.clone(), cx));
                        }
                    } else {
                        tool.reader = None;
                    }
                    if let Some(view) = &tool.view {
                        view.update(cx, |view, cx| view.replace(&next, cx));
                    }
                    tool.content = next;
                }

                true
            }
            "session_info_update" => {
                if data.get("title").is_some() { self.title.report(data["title"].as_str()); return true; }
                false
            }
            "available_commands_update" => {
                match pero_contracts::composer_capabilities::AgentCommand::from_update(data) {
                    Ok(commands) => self.commands = commands,
                    Err(error) => self.error = Some(error),
                }
                true
            }
            "config_option_update" => {
                self.config(data);
                true
            }
            "current_model_update" => {
                if let Some(model) = data["currentModelId"].as_str() {
                    self.model = model.into();
                    self.acknowledge_model();
                }
                true
            }
            _ => false,
        }
    }

    /// Flush the final pending chunks at completion/cancellation/error. This
    /// does not rebuild completed messages or reparse their existing source.
    pub fn flush(&self, cx: &mut App) {
        for message in &self.messages {
            if message.view.read(cx).has_pending() {
                message.view.update(cx, |view, cx| view.flush(cx));
            }
        }
        for tool in &self.tools {
            if let Some(view) = &tool.view {
                if view.read(cx).has_pending() {
                    view.update(cx, |view, cx| view.flush(cx));
                }
            }
        }
    }

    pub fn config(&mut self, data: &Value) {
        if let Some(capabilities) = data.get("peroCapabilities") {
            if let Ok(capabilities) = serde_json::from_value(capabilities.clone()) {
                self.capabilities = capabilities;
            }
        }
        if let Some(settings) = data.get("peroSettings") {
            if let Ok(settings) = serde_json::from_value(settings.clone()) {
                self.settings = settings;
            }
        }
        if let Some(configs) = data["configOptions"].as_array() {
            if let Some(model) = configs
                .iter()
                .find(|option| option["category"] == "model" || option["id"] == "model")
            {
                self.model = model["currentValue"].as_str().unwrap_or_default().into();
                self.acknowledge_model();
                self.models.clear();
                if let Some(options) = model["options"].as_array() {
                    for option in options {
                        if let (Some(id), Some(name)) =
                            (option["value"].as_str(), option["name"].as_str())
                        {
                            self.models.push((id.into(), name.into()));
                        }
                        if let Some(group) = option["options"].as_array() {
                            for option in group {
                                if let (Some(id), Some(name)) =
                                    (option["value"].as_str(), option["name"].as_str())
                                {
                                    self.models.push((id.into(), name.into()));
                                }
                            }
                        }
                    }
                }
                return;
            }
        }
        // Older agents advertise the legacy models capability instead of the
        // model-category session configuration option.
        if let Some(model) = data["models"]["currentModelId"].as_str() {
            self.model = model.into();
            self.acknowledge_model();
        }
        if let Some(models) = data["models"]["availableModels"].as_array() {
            self.models = models
                .iter()
                .filter_map(|model| {
                    Some((
                        model["modelId"].as_str()?.into(),
                        model["name"].as_str()?.into(),
                    ))
                })
                .collect();
        }
    }

    fn acknowledge_model(&mut self) {
        if self.pending_model.as_deref() == Some(self.model.as_str()) {
            self.pending_model = None;
        }
    }
}
