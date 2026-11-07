//! Citations open an existing owner. They do not create a page per source kind.
use crate::{
    app::Workbench,
    workspace::{ConversationTab, WorkspaceItem},
};
use gpui::*;
use pero_contracts::{
    content_link::WorkspaceLink,
    source_target::{FileCitation, PlanRef, SourceTarget, line_span, relative_path_of},
    workbench::LinkClick,
};
use std::path::PathBuf;

pub(crate) struct PendingCitation {
    pub citation: FileCitation,
    pub preview: bool,
}

impl Workbench {
    pub(crate) fn follow_link(
        &mut self,
        href: &str,
        click: LinkClick,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(target) = SourceTarget::parse(href) {
            self.open_source(target.resolve_remote(false), click, window, cx);
            return;
        }
        if let Some(target) = WorkspaceLink::parse(href) {
            self.open_link_target(target, click, window, cx);
        }
    }

    pub(crate) fn open_source(
        &mut self,
        target: SourceTarget,
        click: LinkClick,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match target {
            SourceTarget::PullRequest(reference) => {
                if self.preferences.layout.link_surface.opens_externally(click) {
                    cx.open_url(reference.url());
                } else {
                    self.open_pull_request(reference, window, cx);
                }
            }
            SourceTarget::File(citation) => self.open_cited_file(citation, window, cx),
            SourceTarget::Plan(plan) => self.open_cited_file(plan.citation(), window, cx),
            SourceTarget::Output { thread_id, tool_id } => {
                let found = self.chat.update(cx, |chat, cx| {
                    chat.reveal_tool(&thread_id, &tool_id, cx)
                });
                if found {
                    let index = self
                        .chat
                        .read(cx)
                        .chats
                        .iter()
                        .position(|chat| chat.id == thread_id);
                    self.focus_chat(index, ConversationTab::Chat, cx);
                    self.set_chat_dock(true, cx);
                } else {
                    self.error = Some(self.t("source.unavailable").into());
                }
            }
            SourceTarget::Terminal { id } => {
                if !self.reveal_terminal(id, window, cx) {
                    self.error = Some(self.t("source.unavailable").into());
                }
            }
            SourceTarget::Changes {
                thread_id,
                scope,
                path,
            } => {
                let found = self.chat.update(cx, |chat, cx| {
                    chat.reveal_change(&thread_id, scope, path.as_deref(), cx)
                });
                if found {
                    let index = self
                        .chat
                        .read(cx)
                        .chats
                        .iter()
                        .position(|chat| chat.id == thread_id);
                    self.focus_chat(index, ConversationTab::Chat, cx);
                    self.set_chat_dock(true, cx);
                } else if let Some(path) = path.and_then(|path| FileCitation::parse(&path)) {
                    self.open_cited_file(path, window, cx);
                } else {
                    self.error = Some(self.t("source.unavailable").into());
                }
            }
            SourceTarget::AgentFile { path, .. } | SourceTarget::Unavailable { path } => {
                let _ = path;
                self.error = Some(self.t("source.unavailable").into());
            }
        }
        cx.notify();
    }

    fn open_cited_file(
        &mut self,
        citation: FileCitation,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(path) = absolute_citation(&self.workspace, &citation) else {
            self.error = Some(self.t("source.unavailable").into());
            return;
        };
        self.next_request += 1;
        let request_id = format!("source-{}", self.next_request);
        self.pending_citations.push((
            request_id.clone(),
            PendingCitation {
                citation,
                preview: true,
            },
        ));
        self.command(
            serde_json::json!({"method":"documents","action":"open","request_id":request_id,"path":path}),
            cx,
        );
    }

    pub(crate) fn take_pending_citation(&mut self, request_id: &str) -> Option<PendingCitation> {
        self.pending_citations
            .iter()
            .position(|(id, _)| id == request_id)
            .map(|index| self.pending_citations.remove(index).1)
    }

    pub(crate) fn reveal_cited_lines(
        &mut self,
        source: &str,
        citation: &FileCitation,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(line) = citation.line else {
            return;
        };
        let Some(span) = line_span(source, line, citation.end_line) else {
            return;
        };
        let Some(item) = self.navigation.current().cloned() else {
            return;
        };
        let Some(view) = self.active_document_view(&item) else {
            return;
        };
        view.update(cx, |view, cx| {
            let mut state = view.reading_state(cx);
            state.selection = span;
            state.source = true;
            view.restore_reading_state(state, window, cx);
        });
    }

    pub(crate) fn execute_plan(&mut self, path: &str, cx: &mut Context<Self>) {
        let Some(plan) = PlanRef::from_file(&self.workspace, path).or_else(|| PlanRef::parse(path))
        else {
            return;
        };
        if let Some((_, thread)) = self
            .plan_sessions
            .iter()
            .find(|(saved, _)| saved == plan.path())
        {
            let thread = thread.clone();
            if let Some(index) = self
                .chat
                .read(cx)
                .chats
                .iter()
                .position(|chat| chat.id == thread)
            {
                self.focus_chat(Some(index), ConversationTab::Chat, cx);
                return;
            }
        }
        let item = self.navigation.current().cloned();
        let text = item
            .as_ref()
            .and_then(|item| self.active_document_view(item))
            .map(|view| {
                let reader = view.read(cx);
                reader
                    .draft(cx)
                    .unwrap_or_else(|| reader.document.source().to_owned())
            })
            .unwrap_or_default();
        let prompt = plan.prompt(&text);
        let path = plan.path().to_owned();
        self.new_chat(cx);
        let submitted = self
            .chat
            .update(cx, |panel, cx| panel.submit_prompt(prompt, vec![], cx));
        if !submitted {
            return;
        }
        let thread = {
            let chat = self.chat.read(cx);
            chat.active_chat
                .and_then(|index| chat.chats.get(index))
                .map(|chat| chat.id.clone())
        };
        if let Some(thread) = thread {
            self.plan_sessions.push((path, thread));
        }
    }

    pub(crate) fn plan_bar(&self, path: &str, cx: &mut Context<Self>) -> AnyElement {
        let path = path.to_owned();
        let connected = self.connected;
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .px(px(12.))
            .py(px(8.))
            .border_b_1()
            .border_color(pero_theme::UiAppearance::global(cx).palette.border)
            .child(
                div()
                    .flex_1()
                    .child(self.t("plan.title")),
            )
            .child(
                gpui_kit::component::button::Button::new("plan-execute")
                    .small()
                    .label(self.t("plan.execute"))
                    .disabled(!connected)
                    .on_click(cx.listener(move |this, _, _, cx| this.execute_plan(&path, cx))),
            )
            .into_any_element()
    }
}

fn absolute_citation(workspace: &str, citation: &FileCitation) -> Option<String> {
    if relative_path_of(workspace, &citation.path).as_deref() != Some(citation.path.as_str()) {
        return None;
    }
    let mut out = PathBuf::from(workspace);
    if workspace.is_empty() || !out.is_absolute() {
        return None;
    }
    for part in citation.path.split('/') {
        out.push(part);
    }
    Some(out.to_string_lossy().into_owned())
}
