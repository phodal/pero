use crate::artifact_read::ArtifactView;
use crate::session_state::SessionState;
use crate::{content_reader::ContentReader, stream::StreamText};
use pero_contracts::content_document::{ContentDocument,DocumentSource};
use pero_contracts::content_origin::ContentOrigin;
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
    pub fn new(role: impl Into<String>, text: impl Into<String>, images: crate::inline_images::ConversationImages, cx: &mut App) -> Self {
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
        let view = cx.new(|cx| { let mut view = StreamText::new(if streamed { "" } else { display }, cx); view.images = Some(images); view });
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
    pub chart: Option<crate::chart_view::ChartView>,
    pub chart_error: Option<String>,
    #[serde(skip)]
    pub chart_reader: Option<Entity<ContentReader>>,
    pub id: String,
    pub title: String,
    pub kind: String,
    pub activity: crate::tool_activity::ToolActivity,
    pub body: crate::tool_body::ToolBody,
    pub output_expanded: bool,
    pub locations: Vec<String>,
    pub status: String,
    pub content: String,
    pub source_revision:u64,
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
    pub app_links:Vec<crate::app_links::AppResultLink>,
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
            if !self.body.specialized() && self.document.is_none() && self.view.is_none() {
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ComposerDraftError {
    ImagesUnsupported,
    Context(&'static str),
    Prompt(&'static str),
    Token(String),
}
impl ComposerDraftError {
    pub(crate) fn message(&self, locale: &str) -> String {
        match self {
            Self::ImagesUnsupported => pero_contracts::i18n::text(locale, "composer.image_unsupported").into(),
            Self::Context(error) | Self::Prompt(error) => (*error).into(),
            Self::Token(error) => error.clone(),
        }
    }
}

impl ComposerDraft {
    /// Tokens may mention a resource repeatedly; the turn includes its bytes only once.
    pub(crate) fn contexts(
        content: &gpui_kit::component::input::InputContent,
        references: &std::collections::HashMap<String, pero_contracts::context::ContextReference>,
    ) -> Vec<pero_contracts::context::ContextReference> {
        let mut seen = std::collections::HashSet::new();
        content.tokens().iter()
            .filter_map(|span| references.get(span.token().id().as_ref()))
            .filter(|reference| seen.insert(reference.id.clone()))
            .cloned()
            .collect()
    }

    pub(crate) fn reference_token(reference: &pero_contracts::context::ContextReference) -> gpui_kit::component::input::InlineToken {
        gpui_kit::component::input::InlineToken::new(reference.id.clone(), format!("@{}", reference.label.replace(['\n', '\r', '\t'], " ")))
            .with_label(reference.label.clone())
    }
    pub(crate) fn admit_contexts(
        &self,
        incoming: &[pero_contracts::context::ContextReference],
        images: bool,
    ) -> Result<std::collections::HashMap<String, pero_contracts::context::ContextReference>, ComposerDraftError> {
        use pero_contracts::context::{ContextKind, ContextReference};
        if !images && incoming.iter().any(|reference| reference.kind == ContextKind::Image) {
            return Err(ComposerDraftError::ImagesUnsupported);
        }
        let mut references: std::collections::HashMap<_, _> = Self::contexts(&self.content, &self.references).into_iter()
            .map(|reference| (reference.id.clone(), reference)).collect();
        for reference in incoming { references.insert(reference.id.clone(), reference.clone()); }
        ContextReference::validate_all(&references.values().cloned().collect::<Vec<_>>())
            .map_err(ComposerDraftError::Context)?;
        Ok(references)
    }

    /// Admit the whole addition before the shell mutates either the text or its references.
    pub(crate) fn append(
        &self,
        text: &str,
        contexts: &[pero_contracts::context::ContextReference],
        replace: bool,
        images: bool,
    ) -> Result<Self, ComposerDraftError> {
        use gpui_kit::component::input::InputContent;
        let base = if replace { Self { content: InputContent::new(""), references: Default::default() } } else { self.clone() };
        let references = base.admit_contexts(contexts, images)?;
        let mut text_value = base.content.text().to_string();
        let mut tokens = base.content.tokens().iter().map(|span| (span.range(), span.token().clone())).collect::<Vec<_>>();
        text_value.push_str(text);
        for reference in contexts {
            let start = text_value.len();
            let token = Self::reference_token(reference);
            text_value.push_str(token.text());
            tokens.push((start..text_value.len(), token));
            text_value.push(' ');
        }
        pero_contracts::context::validate_prompt_text(text_value.trim_end())
            .map_err(ComposerDraftError::Prompt)?;
        let mut content = InputContent::new(text_value);
        for (range, token) in tokens {
            content = content.with_token(range, token).map_err(|error| ComposerDraftError::Token(error.to_string()))?;
        }
        Ok(Self { content, references })
    }

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
    #[serde(skip)]
    pub(crate) images: crate::inline_images::ConversationImages,
    pub workspace: String,
    pub scope: Option<pero_contracts::AppChatScope>,
    pub brief: Option<crate::brief_conversation::BriefConversation>,
    pub usage: Option<pero_contracts::usage::SessionUsage>,
    pub mcp: Option<pero_contracts::mcp_runtime::McpRuntimeSession>,
    pub id: String,
    pub title: crate::conversation_title::ConversationTitle,
    #[serde(skip)]
    pub thinking: crate::thinking::ThinkingState,
    #[serde(skip)]
    pub reply_actions: crate::process::ReplyActions,
    pub agent: String,
    pub state: SessionState,
    pub notice: crate::session_state::SessionNotice,
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
    pub(crate) user_questions: Vec<crate::user_questions::QuestionForm>,
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
    pub fn list_status(&self) -> crate::session_state::SessionListStatus {
        crate::session_state::SessionListStatus::of(self.state,
            self.permission.is_some() || self.user_questions.iter().any(|form| !form.submitted),
            self.error.is_some())
    }

    pub fn new(id: String, agent: String, title: String) -> Self {
        Self {
            images: Default::default(),
            workspace: String::new(),
            scope: None,
            brief: None,
            usage: None,
            mcp: None,
            id,
            agent,
            title: crate::conversation_title::ConversationTitle::new(title),
            thinking: Default::default(),
            reply_actions: Default::default(),
            state: SessionState::Draft,
            notice: Default::default(),
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
            user_questions: vec![],
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

    pub fn can_retry(&self) -> bool {
        self.can_retarget() && (self.state == SessionState::Closed
            || self.mcp.as_ref().is_some_and(|mcp| !mcp.failed_servers().is_empty()))
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
        self.messages.push(Message::new("user", text, self.images.clone(), cx));
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
                self.messages.push(Message::new(role, text, self.images.clone(), cx));
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
                            chart: None,
                            chart_error: None,
                            chart_reader: None,
                            id: id.clone(),
                            title: "Tool".into(),
                            kind: "other".into(),
                            activity: Default::default(),
                            body: Default::default(),
                            output_expanded: false,
                            locations: vec![],
                            status: "pending".into(),
                            content: String::new(),
                            source_revision:0,
                            output: vec![],
                            transcript: Default::default(),
                            input_open: false,
                            input_view: None,
                            input_bounds: Default::default(),
                            cancelled: false,
                            document: None,
                            artifact: None,
                            app_links:vec![],
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
                tool.activity = crate::tool_activity::ToolActivity::from_acp(&tool.kind, &tool.title, &tool.locations, tool.transcript.input.as_ref());
                tool.output = tool.transcript.output();
                if tool.status == "completed" && !tool.cancelled { self.images.observe(&tool.output); }
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
                tool.body = crate::tool_body::ToolBody::derive(tool.activity.kind, tool.transcript.input.as_ref(), tool.transcript.raw_output.as_ref(), &next, &tool.output, &tool.locations);
                if next != tool.content {
                    tool.chart_reader = None;
                    tool.source_revision+=1;
                    let revision=tool.source_revision;
                    tool.artifact = ArtifactView::from_content(&next);
                    tool.app_links = crate::app_links::AppResultLink::from_content(&next);
                    tool.document = ContentDocument::from_tool(
                        DocumentSource {id:format!("{}/{}",self.id,tool.id),title:tool.title.clone(),origin:ContentOrigin::Conversation {thread_id:self.id.clone()}}, revision, &next,
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

                tool.chart = None;
                tool.chart_error = None;
                if tool.status == "completed" && !tool.cancelled && tool.title == "chart_render" {
                    match crate::chart_view::ChartView::from_content(&tool.content) {
                        Ok(chart) => tool.chart = Some(chart),
                        Err(error) => tool.chart_error = Some(error),
                    }
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
    /// projects delivered image references once per changed message.
    pub fn flush(&self, cx: &mut App) {
        for message in &self.messages {
            if message.view.read(cx).has_pending() {
                message.view.update(cx, |view, cx| view.flush(cx));
            }
            message.view.update(cx, |view, cx| view.link_images(&message.text, cx));
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

#[cfg(test)]
mod composer_draft_tests {
    use super::*;
    use pero_contracts::context::{ContextContent, ContextKind, ContextReference};
    use gpui_kit::component::input::InputContent;

    fn file(id: &str, size: usize) -> ContextReference {
        ContextReference {
            id: id.into(), kind: ContextKind::File, label: id.into(), source: id.into(),
            content: ContextContent::Text { text: "x".repeat(size) },
        }
    }

    #[test]
    fn repeated_references_are_admitted_and_submitted_once() {
        let mut draft = ComposerDraft { content: InputContent::new("Keep my draft. "), references: Default::default() };
        for reference in [file("A", 70_000), file("B", 1), file("A", 70_000)] {
            draft = draft.append("", &[reference], false, false).unwrap();
        }
        assert_eq!(draft.content.tokens().len(), 3);
        let submitted = ComposerDraft::contexts(&draft.content, &draft.references);
        assert_eq!(submitted.iter().map(|reference| reference.id.as_str()).collect::<Vec<_>>(), ["A", "B"]);
        assert_eq!(ContextReference::validate_all(&submitted), Ok(()));
        for number in 0..14 {
            draft = draft.append("", &[file(&format!("file-{number}"), 1)], false, false).unwrap();
        }
        for _ in 0..3 {
            draft = draft.append("", &[file("A", 70_000), file("B", 1)], false, false).unwrap();
        }
        let submitted = ComposerDraft::contexts(&draft.content, &draft.references);
        assert_eq!(submitted.len(), 16);
        assert_eq!(ContextReference::validate_all(&submitted), Ok(()));
        assert_eq!(draft.append("", &[file("seventeenth", 1)], false, false).err(),
            Some(ComposerDraftError::Context("Choose at most 16 context references")));
    }

    #[test]
    fn insertion_admission_checks_the_complete_prompt_before_changing_the_draft() {
        for (existing, incoming, contexts, replace, valid) in [
            (String::new(), "x".repeat(70_000), vec![], false, false),
            ("x".repeat(63_995), "12345".into(), vec![], false, true),
            ("x".repeat(63_995), "12345".into(), vec![file("a", 1)], false, false),
            ("界".repeat(63_999), "界".into(), vec![], false, true),
            ("x".repeat(63_999), "xx".into(), vec![], true, true),
            ("x".repeat(63_000), "x".repeat(1_001), vec![], false, false),
        ] {
            let current = ComposerDraft { content: InputContent::new(existing.clone()), references: Default::default() };
            let next = current.append(&incoming, &contexts, replace, false);
            assert_eq!(next.is_ok(), valid);
            assert_eq!(current.content.text().as_ref(), existing);
            if let Err(error) = next {
                assert_eq!(error, ComposerDraftError::Prompt("Message exceeds 64,000 characters"));
                assert!(current.content.tokens().is_empty());
                assert!(current.references.is_empty());
            }
        }
    }

    #[test]
    fn insertion_admission_preserves_the_draft_on_limit_or_capability_rejection() {
        let empty = ComposerDraft { content: InputContent::new("Keep my draft. "), references: Default::default() };
        let current = empty.append("", &[file("existing", 70_000)], false, false).unwrap();
        let image = ContextReference {
            id: "image".into(), kind: ContextKind::Image, label: "image.png".into(), source: "image".into(),
            content: ContextContent::Image { data: "eA==".into(), mime_type: "image/png".into() },
        };
        for (incoming, images, replace, expected) in [
            (vec![file("other", 70_000)], false, false, Some(ComposerDraftError::Context("Context text exceeds 128 KB or contains binary data"))),
            (vec![file("valid", 1), image.clone()], false, false, Some(ComposerDraftError::ImagesUnsupported)),
            (vec![image], true, false, None),
            (vec![file("other", 70_000)], false, true, None),
        ] {
            let before = (current.content.text().to_string(), current.content.tokens().to_vec(), current.references.clone());
            let result = current.append("Quoted selection. ", &incoming, replace, images);
            assert_eq!(result.as_ref().err(), expected.as_ref());
            assert_eq!((current.content.text().to_string(), current.content.tokens().to_vec(), current.references.clone()), before);
            if let Ok(next) = result {
                assert!(next.content.text().contains("Quoted selection."));
                assert_eq!(next.references.contains_key("existing"), !replace);
                assert_eq!(next.content.tokens().len(), incoming.len() + usize::from(!replace));
            }
        }
    }
}
