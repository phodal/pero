//! A retained view of the Host-owned artifact catalog, scoped to each conversation.
use crate::panel::{ChatAction, ChatPanel, ComposerInsertion};
use gpui_kit::{component::input::InputState, *};
use pero_contracts::{
    HostEvent,
    content_document::{ContentFormat, DocumentHeader},
    context::ContextReference,
    session_artifact::{
        ArtifactMethod, ArtifactPresentation, ArtifactRequest, ArtifactSource, SessionArtifact,
    },
    workbench::LayoutPreferences,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::HashMap;

pub(crate) struct ArtifactPrompt {
    request_id: String,
    text: String,
    surface_request: Option<String>,
}

#[derive(Default)]
pub(crate) struct ArtifactCollection {
    pub items: Vec<SessionArtifact>,
    pub requested: bool,
    pub loading: bool,
    pub open: bool,
    pub inline_open: bool,
    pub bottom: bool,
    pub bottom_height: Option<f32>,
    pub maximized: bool,
    pub show_changes: bool,
    pub selected: Option<(String, u64)>,
    pub preview_request: Option<u64>,
    pub chart: Option<crate::chart_view::ChartView>,
    pub chart_source_open: bool,
    pub pending: Option<(String, bool)>,
    pub context: Option<ArtifactPrompt>,
    pub mutation: Option<String>,
    pub error: Option<String>,
    pub notice: Option<String>,
    pub path_open: bool,
    pub path_input: Option<Entity<InputState>>,
}

impl ArtifactCollection {
    /// The pane replaces an inline reader. Closing the pane does not put it back.
    pub fn show_pane(&mut self) {
        self.open = true;
        self.inline_open = false;
    }

    pub fn return_to_chat(&mut self, narrow: bool) {
        self.maximized = false;
        self.inline_open = false;
        if narrow {
            self.open = false;
        }
    }
}

/// Drag of the artifact column, measured from the pointer position where it started.
#[derive(Clone, Copy)]
pub(crate) struct ArtifactPaneResize {
    pub origin_x: f32,
    pub origin_width: f32,
    pub max_width: f32,
    pub vertical: bool,
}

#[derive(Default)]
pub(crate) struct SessionArtifacts {
    pub conversations: HashMap<String, ArtifactCollection>,
    pub anchors: HashMap<String, ScrollAnchor>,
    pub bounds: HashMap<String, crate::view_bounds::ViewBounds>,
    pub pane_width: Option<f32>,
    pub resize: Option<ArtifactPaneResize>,
    pub narrow: bool,
    pub surface_covered: bool,
    pub view: pero_contracts::workbench::ArtifactView,
    pub preview_requested: Option<pero_contracts::session_artifact::ArtifactBrowserState>,
    #[cfg(not(target_family = "wasm"))]
    pub native_preview: Option<(String, AnyView)>,
}

impl ChatPanel {
    pub(crate) fn open_inline_artifact(&mut self, thread: &str, id: &str, version: u64, cx: &mut Context<Self>) {
        self.open_delivered_artifact(thread, id, version, cx);
        let state = self.artifacts.conversations.get_mut(thread).expect("selected artifact");
        state.open = false;
        state.inline_open = true;
        cx.notify();
    }
    pub(crate) fn open_delivered_artifact(
        &mut self,
        thread: &str,
        id: &str,
        version: u64,
        cx: &mut Context<Self>,
    ) {
        self.next_request += 1;
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.preview_request = Some(self.next_request);
        state.show_changes = false;
        self.read_artifact(thread, id, version, false, cx);
        if self.compact {
            cx.emit(ChatAction::CompactNeedsSpace);
        }
    }

    pub(crate) fn artifact_delivery(
        &self,
        thread: &str,
        tool: &crate::conversation::Tool,
    ) -> Option<(
        &SessionArtifact,
        &pero_contracts::session_artifact::SessionArtifactVersion,
    )> {
        if tool.cancelled
            || tool.status != "completed"
            || crate::tool_ui::display_tool_title(&tool.title) != "deliver_artifact"
        {
            return None;
        }
        #[derive(Deserialize)]
        struct Delivery {
            artifact: SessionArtifact,
        }
        let delivery: Delivery = serde_json::from_str(&tool.content).ok()?;
        let delivered = delivery.artifact.versions.last()?;
        let item = self
            .artifacts
            .conversations
            .get(thread)?
            .items
            .iter()
            .find(|item| {
                item.id == delivery.artifact.id && item.thread_id == delivery.artifact.thread_id
            })?;
        let version = item.versions.iter().find(|version| {
            version.version == delivered.version && version.sha256 == delivered.sha256
        })?;
        Some((item, version))
    }

    pub fn set_artifact_view(
        &mut self,
        view: pero_contracts::workbench::ArtifactView,
        cx: &mut Context<Self>,
    ) {
        if self.artifacts.view != view {
            self.artifacts.view = view;
            cx.notify();
        }
    }
    pub fn artifact_pane_width(&self) -> f32 {
        self.artifacts
            .pane_width
            .unwrap_or(f32::from(LayoutPreferences::DEFAULT_ARTIFACT_PANE_WIDTH))
    }

    pub fn set_artifact_pane_width(&mut self, width: f32, cx: &mut Context<Self>) {
        if width.is_finite() && width >= 0. {
            self.artifacts.pane_width = Some(width);
            cx.notify();
        }
    }

    fn artifact_request_id(&mut self, action: &str) -> String {
        self.next_request += 1;
        format!("artifact-{action}-{}", self.next_request)
    }

    pub(crate) fn refresh_artifacts(&mut self, thread: &str, cx: &mut Context<Self>) {
        let request_id = self.artifact_request_id("list");
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.requested = true;
        state.loading = true;
        state.error = None;
        self.request_changes(thread, false, cx);
        cx.emit(ChatAction::Artifacts(ArtifactRequest::List {
            method: ArtifactMethod::Artifacts,
            request_id,
            thread_id: thread.into(),
        }));
    }

    pub(crate) fn read_artifact(
        &mut self,
        thread: &str,
        id: &str,
        version: u64,
        compose: bool,
        cx: &mut Context<Self>,
    ) {
        if self.files.selection.tab != pero_contracts::workbench::ResourceTab::Artifacts {
            self.choose_resource_tab(
                thread,
                pero_contracts::workbench::ResourceTab::Artifacts,
                cx,
            );
        }
        let request_id = self.artifact_request_id("read");
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.show_pane();
        state.selected = Some((id.into(), version));
        state.chart = None;
        state.chart_source_open = false;
        state.error = None;
        state.notice = None;
        state.pending = None;
        let inspect_chart = state
            .items
            .iter()
            .find(|item| item.id == id)
            .and_then(|item| item.versions.iter().find(|entry| entry.version == version))
            .is_some_and(|entry| {
                entry.bytes <= 2 * 1024 * 1024
                    && matches!(
                        entry.resolved_media(),
                        pero_contracts::session_artifact::ArtifactMedia::Document {
                            format: ContentFormat::Json
                        }
                    )
            });
        if compose {
            self.compose_artifact(thread, cx);
        } else if inspect_chart {
            state.pending = Some((request_id.clone(), false));
            cx.emit(ChatAction::Artifacts(ArtifactRequest::Read {
                method: ArtifactMethod::Artifacts,
                request_id,
                thread_id: thread.into(),
                artifact_id: id.into(),
                version: Some(version),
            }));
        }
        cx.notify();
    }

    pub(crate) fn save_reply_artifact(
        &mut self,
        thread: &str,
        index: usize,
        cx: &mut Context<Self>,
    ) {
        let Some(message) = self
            .chats
            .iter()
            .find(|chat| chat.id == thread)
            .and_then(|chat| chat.messages.get(index))
        else {
            return;
        };
        let text = message.text.clone();
        let title = text
            .lines()
            .map(|line| line.trim().trim_start_matches('#').trim())
            .find(|line| !line.is_empty())
            .unwrap_or(self.t("artifacts.document"))
            .chars()
            .take(80)
            .collect::<String>();
        let source_message_id = format!("message:{index}");
        let artifact_id = self
            .artifacts
            .conversations
            .get(thread)
            .and_then(|state| {
                state.items.iter().find(|item| {
                    item.latest().source_message_id.as_deref() == Some(source_message_id.as_str())
                })
            })
            .map(|item| item.id.clone());
        let request_id = self.artifact_request_id("save");
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.show_pane();
        state.mutation = Some(request_id.clone());
        state.error = None;
        cx.emit(ChatAction::Artifacts(ArtifactRequest::RegisterText {
            method: ArtifactMethod::Artifacts,
            request_id,
            thread_id: thread.into(),
            artifact_id,
            title,
            text,
            format: Some(ContentFormat::Markdown),
            source_message_id: Some(source_message_id),
            source_tool_call_id: None,
        }));
        cx.notify();
    }

    pub(crate) fn save_tool_artifact(
        &mut self,
        thread: &str,
        tool_id: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(tool) = self
            .chats
            .iter()
            .find(|chat| chat.id == thread)
            .and_then(|chat| chat.tools.iter().find(|tool| tool.id == tool_id))
        else {
            return;
        };
        let Some(document) = tool.document.clone() else {
            return;
        };
        let title = tool
            .chart
            .as_ref()
            .map(|chart| chart.title.clone())
            .unwrap_or_else(|| tool.title.clone());
        let artifact_id = self
            .artifacts
            .conversations
            .get(thread)
            .and_then(|state| {
                state
                    .items
                    .iter()
                    .find(|item| item.latest().source_tool_call_id.as_deref() == Some(tool_id))
            })
            .map(|item| item.id.clone());
        let request_id = self.artifact_request_id("save");
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.show_pane();
        state.error = None;
        state.mutation = Some(request_id.clone());
        cx.emit(ChatAction::Artifacts(ArtifactRequest::RegisterText {
            method: ArtifactMethod::Artifacts,
            request_id,
            thread_id: thread.into(),
            artifact_id,
            title,
            text: document.source().into(),
            format: Some(document.format),
            source_message_id: None,
            source_tool_call_id: Some(tool_id.into()),
        }));
        cx.notify();
    }

    pub(crate) fn register_artifact_path(&mut self, thread: &str, cx: &mut Context<Self>) {
        let path = self
            .artifacts
            .conversations
            .get(thread)
            .and_then(|state| state.path_input.as_ref())
            .map(|input| input.read(cx).value().trim().to_owned())
            .unwrap_or_default();
        if path.is_empty() {
            return;
        }
        let request_id = self.artifact_request_id("save");
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.mutation = Some(request_id.clone());
        state.error = None;
        cx.emit(ChatAction::Artifacts(ArtifactRequest::RegisterFile {
            method: ArtifactMethod::Artifacts,
            request_id,
            thread_id: thread.into(),
            artifact_id: None,
            title: None,
            presentation: None,
            related: Vec::new(),
            path,
            source_message_id: None,
            source_tool_call_id: None,
        }));
        cx.notify();
    }

    pub(crate) fn update_artifact_version(
        &mut self,
        thread: &str,
        id: &str,
        cx: &mut Context<Self>,
    ) {
        let Some(artifact) = self
            .artifacts
            .conversations
            .get(thread)
            .and_then(|state| state.items.iter().find(|item| item.id == id))
            .cloned()
        else {
            return;
        };
        let version = artifact.latest();
        if let ArtifactSource::File { path } = &version.source {
            let request_id = self.artifact_request_id("save");
            let state = self
                .artifacts
                .conversations
                .entry(thread.into())
                .or_default();
            state.mutation = Some(request_id.clone());
            state.error = None;
            cx.emit(ChatAction::Artifacts(ArtifactRequest::RegisterFile {
                method: ArtifactMethod::Artifacts,
                request_id,
                thread_id: thread.into(),
                artifact_id: Some(id.into()),
                title: Some(artifact.title.clone()),
                presentation: None,
                related: Vec::new(),
                path: path.clone(),
                source_message_id: version.source_message_id.clone(),
                source_tool_call_id: version.source_tool_call_id.clone(),
            }));
        } else if let Some(index) = version
            .source_message_id
            .as_deref()
            .and_then(|id| id.strip_prefix("message:"))
            .and_then(|index| index.parse().ok())
        {
            self.save_reply_artifact(thread, index, cx);
        } else if let Some(tool) = &version.source_tool_call_id {
            self.save_tool_artifact(thread, tool, cx);
        }
        cx.notify();
    }

    pub(crate) fn compose_artifact(&mut self, thread: &str, cx: &mut Context<Self>) {
        let Some((id, version)) = self
            .artifacts
            .conversations
            .get(thread)
            .and_then(|state| state.selected.clone())
        else {
            return;
        };
        let target = pero_contracts::session_artifact::ArtifactPreviewTarget {
            thread_id: thread.into(),
            artifact_id: id,
            version,
        };
        self.request_artifact_context(&target, String::new(), None, cx);
    }

    pub(crate) fn request_artifact_context(
        &mut self,
        target: &pero_contracts::session_artifact::ArtifactPreviewTarget,
        text: String,
        surface_request: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if self
            .artifacts
            .conversations
            .get(&target.thread_id)
            .is_some_and(|state| state.context.is_some())
        {
            if let Some(id) = surface_request {
                cx.emit(ChatAction::ArtifactComposeResult {
                    id,
                    error: Some("Artifact context is already loading".into()),
                });
            }
            return;
        }
        let request_id = self.artifact_request_id("context");
        let state = self
            .artifacts
            .conversations
            .entry(target.thread_id.clone())
            .or_default();
        state.context = Some(ArtifactPrompt {
            request_id: request_id.clone(),
            text,
            surface_request,
        });
        state.error = None;
        cx.emit(ChatAction::Artifacts(ArtifactRequest::Context {
            method: ArtifactMethod::Artifacts,
            request_id,
            thread_id: target.thread_id.clone(),
            artifact_id: target.artifact_id.clone(),
            version: target.version,
        }));
        cx.notify();
    }

    pub(crate) fn receive_artifacts(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if !matches!(
            event.kind.as_str(),
            "artifact_catalog"
                | "artifact_registered"
                | "artifact_document"
                | "artifact_context"
                | "artifact_error"
        ) {
            return false;
        }
        let Some(thread) = event.thread_id.as_deref() else {
            return true;
        };
        let can_present = self.visible
            && self
                .active_chat
                .and_then(|index| self.chats.get(index))
                .is_some_and(|chat| chat.id == thread && chat.busy());
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        match event.kind.as_str() {
            "artifact_catalog" => {
                #[derive(Deserialize)]
                struct Catalog {
                    artifacts: Vec<SessionArtifact>,
                }
                match serde_json::from_value::<Catalog>(event.data.clone()) {
                    Ok(catalog) => {
                        state.items = catalog.artifacts;
                        state.error = None;
                    }
                    Err(error) => state.error = Some(error.to_string()),
                }
                state.loading = false;
            }
            "artifact_registered" => {
                #[derive(Deserialize)]
                struct Registered {
                    artifact: SessionArtifact,
                    presentation: Option<ArtifactPresentation>,
                }
                match serde_json::from_value::<Registered>(event.data.clone()) {
                    Ok(Registered {
                        artifact,
                        presentation,
                    }) => {
                        let id = artifact.id.clone();
                        let version = artifact.latest().version;
                        let refresh_catalog = artifact.latest().related.iter().any(|link|
                            link.artifact_id != id && !state.items.iter().any(|item|
                                item.id == link.artifact_id && item.versions.iter().any(|version| version.version == link.version)));
                        if let Some(item) = state.items.iter_mut().find(|item| item.id == id) {
                            *item = artifact;
                        } else {
                            state.items.push(artifact);
                        }
                        let manual = (state.mutation.as_deref() == event.request_id.as_deref()
                            && state.mutation.is_some())
                            || event.request_id.as_deref() == Some("artifact-file-picker");
                        state.mutation = None;
                        state.path_open = false;
                        state.error = None;
                        if manual {
                            self.read_artifact(thread, &id, version, false, cx);
                        } else if let Some(presentation) = presentation.filter(|_| can_present) {
                            state.maximized = presentation == ArtifactPresentation::Expanded;
                            state.bottom = presentation == ArtifactPresentation::Below;
                            if presentation == ArtifactPresentation::Inline {
                                self.open_inline_artifact(thread, &id, version, cx);
                            } else {
                                self.open_delivered_artifact(thread, &id, version, cx);
                            }
                        }
                        if refresh_catalog {
                            self.refresh_artifacts(thread, cx);
                        }
                    }
                    Err(error) => state.error = Some(error.to_string()),
                }
            }
            "artifact_document" => {
                if state.pending.as_ref().is_some_and(|(request, _)| {
                    Some(request.as_str()) == event.request_id.as_deref()
                }) {
                    match serde_json::from_value::<DocumentHeader>(event.data.clone()) {
                        Ok(_) => {
                            state.chart =
                                crate::chart_view::ChartView::from_content(&event.text).ok();
                        }
                        Err(error) => state.error = Some(error.to_string()),
                    }
                    let compose = state.pending.take().is_some_and(|(_, compose)| compose);
                    if compose {
                        self.compose_artifact(thread, cx);
                    }
                }
            }
            "artifact_context" => {
                if state.context.as_ref().is_some_and(|prompt| {
                    Some(prompt.request_id.as_str()) == event.request_id.as_deref()
                }) {
                    let prompt = state.context.take().unwrap();
                    match serde_json::from_value::<ContextReference>(event.data.clone()) {
                        Ok(reference) => {
                            self.pending_prompts.push(ComposerInsertion {
                                thread_id: thread.into(),
                                text: prompt.text,
                                contexts: vec![reference],
                                replace: false,
                                surface_request: prompt.surface_request,
                            });
                        }
                        Err(error) => {
                            let error = error.to_string();
                            if let Some(id) = prompt.surface_request {
                                cx.emit(ChatAction::ArtifactComposeResult {
                                    id,
                                    error: Some(error),
                                });
                            } else {
                                state.error = Some(error);
                            }
                        }
                    };
                }
            }
            "artifact_error" => {
                let surface_request = if state.context.as_ref().is_some_and(|prompt| {
                    Some(prompt.request_id.as_str()) == event.request_id.as_deref()
                }) {
                    state
                        .context
                        .take()
                        .and_then(|prompt| prompt.surface_request)
                } else {
                    None
                };
                if let Some(id) = surface_request {
                    cx.emit(ChatAction::ArtifactComposeResult {
                        id,
                        error: Some(event.text.clone()),
                    });
                } else {
                    state.error = Some(event.text.clone());
                }
                state.loading = false;
                state.pending = None;
                state.mutation = None;
            }
            _ => {}
        }
        cx.notify();
        true
    }

    pub(crate) fn prepare_artifacts(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.sync_artifact_preview_target(cx);
        let Some(thread) = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.clone())
        else {
            return;
        };
        if !self
            .artifacts
            .conversations
            .get(&thread)
            .is_some_and(|state| state.requested)
        {
            self.refresh_artifacts(&thread, cx);
        }
        if let Some(chat) = self.chats.iter().find(|chat| chat.id == thread) {
            for index in 0..chat.messages.len() {
                self.artifacts
                    .bounds
                    .entry(format!("{thread}/save-reply:{index}"))
                    .or_default();
                self.artifacts
                    .anchors
                    .entry(format!("{thread}/message:{index}"))
                    .or_insert_with(|| ScrollAnchor::for_handle(self.chat_scroll.clone()));
            }
            for row in crate::chat::render_items(chat) {
                if let crate::chat::RenderItem::Process(group) = row {
                    self.artifacts
                        .bounds
                        .entry(format!("{thread}/process:{}", group.first().key()))
                        .or_default();
                }
            }
            for record in &chat.changes.records {
                for index in 0..record.files.len() {
                    self.artifacts
                        .bounds
                        .entry(format!("{thread}/change:{}:{index}", record.id))
                        .or_default();
                }
            }
            for tool in &chat.tools {
                self.artifacts
                    .bounds
                    .entry(format!("{thread}/save-tool:{}", tool.id))
                    .or_default();
                self.artifacts
                    .anchors
                    .entry(format!("{thread}/tool:{}", tool.id))
                    .or_insert_with(|| ScrollAnchor::for_handle(self.chat_scroll.clone()));
            }
        }
        for action in [
            "changes-current",
            "changes-toggle",
            "changes-history",
            "changes-layout",
            "changes-list",
            "toggle",
            "add-file",
            "path",
            "path-add",
            "refresh",
            "add-context",
            "source",
            "update",
            "previous",
            "next",
            "close",
            "expand",
            "chart-source",
        ] {
            self.artifacts
                .bounds
                .entry(format!("{thread}/{action}"))
                .or_default();
        }
        if let Some(state) = self.artifacts.conversations.get(&thread) {
            for item in &state.items {
                self.artifacts
                    .bounds
                    .entry(format!("{thread}/row:{}", item.id))
                    .or_default();
            }
        }
        let state = self.artifacts.conversations.entry(thread).or_default();
        if state.path_input.is_none() {
            state.path_input = Some(cx.new(|cx| {
                InputState::new(window, cx)
                    .placeholder(pero_contracts::i18n::text(&self.locale, "artifacts.path"))
            }));
        }
    }

    pub(crate) fn artifact_source_key(
        &self,
        thread: &str,
        id: &str,
        selected: u64,
    ) -> Option<String> {
        let item = self
            "bottom",
            .artifacts
            .conversations
            .get(thread)?
            .items
            .iter()
            .find(|item| item.id == id)?;
        let version = item
            .versions
            .iter()
            .find(|version| version.version == selected)?;
        version
            .source_message_id
            .clone()
            .or_else(|| {
                version
                    .source_tool_call_id
                    .as_ref()
                    .map(|id| format!("tool:{id}"))
            })
            .or_else(|| {
                self.chats
                    .iter()
                    .find(|chat| chat.id == thread)?
                    .tools
                    .iter()
                    .find(|tool| {
                        self.artifact_delivery(thread, tool)
                            .is_some_and(|(item, version)| {
                                item.id == id && version.version == selected
                            })
                    })
                    .map(|tool| format!("tool:{}", tool.id))
            })
    }

    pub(crate) fn reveal_artifact_source(
        &mut self,
        thread: &str,
        id: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let selected = self
            .artifacts
            .conversations
            .get(thread)
            .and_then(|state| state.selected.as_ref())
            .map(|(_, version)| *version);
        let source = selected.and_then(|version| self.artifact_source_key(thread, id, version));
        let Some(source) = source else {
            let error = self.t("artifacts.source_missing").to_owned();
            if let Some(state) = self.artifacts.conversations.get_mut(thread) {
                state.error = Some(error);
            }
            cx.notify();
            return;
        };
        if let Some(tool) = source.strip_prefix("tool:") {
            if let Some(chat) = self.chats.iter().find(|chat| chat.id == thread) {
                for entry in crate::chat::render_items(chat) {
                    if let crate::chat::RenderItem::Process(group) = entry {
                        if group.members().iter().any(|entry| matches!(entry, crate::process::ProcessEntry::Tool(index) if chat.tools[*index].id == tool)) {
                            self.expanded_tools.insert(format!("{thread}/process:{}", group.first().key()));
                            self.expanded_tools.insert(format!("{thread}/{tool}"));
                            break;
                        }
                    }
                }
            }
        }
        if let Some(state) = self.artifacts.conversations.get_mut(thread) {
            state.return_to_chat(self.artifacts.narrow);
        }
        self.chat_scroll.set_offset(point(px(0.), px(0.)));
        if let Some(anchor) = self.artifacts.anchors.get(&format!("{thread}/{source}")) {
            anchor.scroll_to(window, cx);
        }
        self.sync_follow(cx);
        cx.notify();
    }

    pub(crate) fn artifact_snapshot(&self, _cx: &App) -> Value {
        let thread = self
            .active_chat
            .and_then(|index| self.chats.get(index))
            .map(|chat| chat.id.as_str());
        thread.and_then(|thread|self.artifacts.conversations.get(thread).map(|state|json!({"thread_id":thread,"items":state.items,"open":state.open,"selected":state.selected,"loading":state.loading,"reading":state.pending.is_some(),"saving":state.mutation.is_some(),"error":state.error,"chart":state.chart.is_some(),"bounds":self.artifacts.bounds.iter().filter_map(|(key,bounds)|key.strip_prefix(&format!("{thread}/")).map(|key|(key.to_owned(),bounds.snapshot()))).collect::<std::collections::BTreeMap<_,_>>()}))).unwrap_or(Value::Null)
    }
}
