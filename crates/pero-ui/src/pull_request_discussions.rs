//! GitHub discussion cards share drafts and mutations between Changes and Reviews.
use crate::{
    app::Workbench,
    pull_request_diff::discussion_position,
    pull_requests::{PullRequestContent, pull_request_markdown},
};
use gpui_kit::{
    component::{
        button::*,
        diff::{
            Diff, DiffAnnotation, DiffFile, DiffLinePosition, DiffLineRange, DiffParseOptions,
            DiffSide, DiffState,
        },
        input::{Textarea, TextareaState},
        *,
    },
    prelude::*,
    *,
};
use pero_chat_ui::stream::StreamText;
use pero_contracts::{
    HostEvent, pull_request::*, workbench::RepositoryIdentity, workspace_path::WorkspacePath,
};
use serde_json::json;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct DiscussionViews {
    threads: BTreeMap<String, DiscussionEditor>,
    draft: Option<DiscussionDraft>,
}

struct DiscussionEditor {
    input: Entity<TextareaState>,
    bodies: Vec<Entity<StreamText>>,
    context: Entity<DiffState>,
    comments: Vec<PullRequestDiscussionComment>,
    pending: Option<DiscussionMutation>,
    error: Option<String>,
    notice: Option<&'static str>,
    _subscriptions: Vec<Subscription>,
}

struct DiscussionDraft {
    head_sha: String,
    range: DiffLineRange,
    editor: DiscussionEditor,
}

struct DiscussionMutation {
    request_id: String,
    submitted: Option<String>,
}

#[derive(Clone)]
enum DiscussionTarget {
    Thread(String),
    Draft,
}
impl DiscussionTarget {
    fn id(&self) -> &str {
        match self {
            Self::Thread(id) => id,
            Self::Draft => "new",
        }
    }
}
impl DiscussionViews {
    #[cfg(target_family = "wasm")]
    pub(super) fn snapshot(&self, cx: &App) -> serde_json::Value {
        let editor = |value: &DiscussionEditor| json!({"draft":value.input.read(cx).value().as_ref(),"error":value.error,"notice":value.notice,"pending":value.pending.as_ref().map(|pending|&pending.request_id)});
        json!({"threads":self.threads.iter().map(|(id,value)|(id.clone(),editor(value))).collect::<BTreeMap<_,_>>(),"draft":self.draft.as_ref().map(|draft|editor(&draft.editor))})
    }
    fn editor(&self, target: &DiscussionTarget) -> Option<&DiscussionEditor> {
        match target {
            DiscussionTarget::Thread(id) => self.threads.get(id),
            DiscussionTarget::Draft => self.draft.as_ref().map(|draft| &draft.editor),
        }
    }
    fn editor_mut(&mut self, target: &DiscussionTarget) -> Option<&mut DiscussionEditor> {
        match target {
            DiscussionTarget::Thread(id) => self.threads.get_mut(id),
            DiscussionTarget::Draft => self.draft.as_mut().map(|draft| &mut draft.editor),
        }
    }
}

impl Workbench {
    fn discussion_editor(&self, window: &mut Window, cx: &mut Context<Self>) -> DiscussionEditor {
        let input = cx.new(|cx| TextareaState::new(window, cx));
        let observer = cx.observe(&input, |_, _, cx| cx.notify());
        let context = cx.new(|cx| DiffState::new([], cx));
        let context_observer = cx.observe(&context, |_, _, cx| cx.notify());
        DiscussionEditor {
            input,
            bodies: vec![],
            context,
            comments: vec![],
            pending: None,
            error: None,
            notice: None,
            _subscriptions: vec![observer, context_observer],
        }
    }

    pub(super) fn sync_pull_request_discussions(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(snapshot) = self.pull_requests[index].state.snapshot.as_ref() else {
            return;
        };
        let discussions = snapshot.discussions.items.clone();
        self.pull_requests[index]
            .diff
            .receive_discussion_anchors(&discussions, cx);
        for discussion in discussions {
            if !self.pull_requests[index]
                .discussions
                .threads
                .contains_key(&discussion.id)
            {
                let editor = self.discussion_editor(window, cx);
                self.pull_requests[index]
                    .discussions
                    .threads
                    .insert(discussion.id.clone(), editor);
            }
            let editor = self.pull_requests[index]
                .discussions
                .threads
                .get_mut(&discussion.id)
                .unwrap();
            if editor.comments == discussion.comments {
                continue;
            }
            editor.bodies.clear();
            // Input and retained Diff notify this render owner; later subscriptions own prose links.
            editor._subscriptions.truncate(2);
            for comment in &discussion.comments {
                let (body, link) = pull_request_markdown(&comment.body, window, cx);
                editor.bodies.push(body);
                editor._subscriptions.push(link);
            }
            let patch = discussion
                .comments
                .first()
                .map(|comment| comment.diff_hunk.as_str())
                .unwrap_or_default();
            let old = serde_json::to_string(&format!("a/{}", discussion.path)).unwrap();
            let new = serde_json::to_string(&format!("b/{}", discussion.path)).unwrap();
            let text = format!("diff --git {old} {new}\n--- {old}\n+++ {new}\n{patch}\n");
            let files = DiffFile::parse_with(&text, DiffParseOptions::new().truncated_hunks(true))
                .unwrap_or_default();
            editor
                .context
                .update(cx, |state, cx| state.set_files(files, cx));
            editor.comments = discussion.comments;
        }
    }

    pub(super) fn pull_request_discussion_annotations(
        &self,
        view: &PullRequestContent,
    ) -> Vec<DiffAnnotation> {
        let mut annotations = Vec::new();
        if let Some(snapshot) = &view.state.snapshot {
            for discussion in &snapshot.discussions.items {
                if !view.state.shows_file(&discussion.path) {
                    continue;
                }
                let id = SharedString::from(format!("pr-discussion-{}", discussion.id));
                annotations.push(
                    if let Some(position) = discussion_position(discussion).filter(|position| {
                        !discussion.outdated && view.diff.contains_discussion_line(position)
                    }) {
                        DiffAnnotation::line(id, position)
                    } else {
                        // An old revision's line is never presented as a current-head coordinate.
                        DiffAnnotation::file(id, discussion.path.clone())
                    },
                );
            }
        }
        if let Some(draft) = &view.discussions.draft {
            if view.state.shows_file(draft.range.path()) {
                annotations.push(
                    if view
                        .state
                        .snapshot
                        .as_ref()
                        .is_some_and(|snapshot| snapshot.head_sha != draft.head_sha)
                    {
                        DiffAnnotation::file("pr-discussion-new", draft.range.path().clone())
                    } else {
                        DiffAnnotation::line(
                            "pr-discussion-new",
                            DiffLinePosition::new(
                                draft.range.path().clone(),
                                draft.range.end_side(),
                                draft.range.end(),
                            ),
                        )
                    },
                );
            }
        }
        annotations
    }

    pub(super) fn render_pull_request_annotation(
        &self,
        view: &PullRequestContent,
        annotation: &DiffAnnotation,
        cx: &Context<Self>,
    ) -> Option<AnyElement> {
        if annotation.id() == &ElementId::from("pr-discussion-new") {
            return Some(self.pull_request_discussion_card(
                view,
                DiscussionTarget::Draft,
                view.discussions.draft.as_ref().is_some_and(|draft| {
                    view.state
                        .snapshot
                        .as_ref()
                        .is_some_and(|snapshot| snapshot.head_sha != draft.head_sha)
                }),
                cx,
            ));
        }
        let snapshot = view.state.snapshot.as_ref()?;
        let discussion = snapshot.discussions.items.iter().find(|discussion| {
            annotation.id()
                == &ElementId::from(SharedString::from(format!(
                    "pr-discussion-{}",
                    discussion.id
                )))
        })?;
        Some(self.pull_request_discussion_card(
            view,
            DiscussionTarget::Thread(discussion.id.clone()),
            annotation.position().is_none(),
            cx,
        ))
    }

    pub(super) fn begin_pull_request_discussion(
        &mut self,
        reference: &PullRequestRef,
        range: DiffLineRange,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(index) = self
            .pull_requests
            .iter()
            .position(|view| &view.state.reference == reference)
        else {
            return;
        };
        if let Some(draft) = &self.pull_requests[index].discussions.draft {
            // Keep a pending or unsent draft in place when another line is selected.
            draft
                .editor
                .input
                .update(cx, |input, cx| input.focus(window, cx));
            return;
        }
        let Some(head_sha) = self.pull_requests[index]
            .state
            .snapshot
            .as_ref()
            .map(|snapshot| snapshot.head_sha.clone())
        else {
            return;
        };
        let editor = self.discussion_editor(window, cx);
        let files = self.pull_requests[index]
            .state
            .snapshot
            .as_ref()
            .into_iter()
            .flat_map(|snapshot| snapshot.files.items.iter())
            .filter(|file| file.filename == range.path().as_str())
            .map(|file| crate::pull_request_diff::parse_file(file).0)
            .collect::<Vec<_>>();
        editor
            .context
            .update(cx, |state, cx| state.set_files(files, cx));
        editor.input.update(cx, |input, cx| input.focus(window, cx));
        self.pull_requests[index].discussions.draft = Some(DiscussionDraft {
            head_sha,
            range,
            editor,
        });
        cx.notify();
    }

    pub(super) fn pull_request_discussion_list(
        &self,
        view: &PullRequestContent,
        cx: &Context<Self>,
    ) -> AnyElement {
        let Some(snapshot) = &view.state.snapshot else {
            return div().into_any_element();
        };
        let chrome = pero_theme::Chrome::from_app(cx);
        let mut list = div()
            .flex()
            .flex_col()
            .min_w_0()
            .gap(px(pero_theme::SPACE_16))
            .px(px(pero_theme::SPACE_24))
            .pb(px(pero_theme::SPACE_24));
        if let Some(error) = &snapshot.discussions.error {
            list = list.child(pero_theme::feedback(
                "pr-discussions-error",
                self.t("pr.discussions_failed"),
                error.clone(),
                pero_theme::FeedbackKind::Warning,
                chrome,
            ));
        }
        for discussion in &snapshot.discussions.items {
            list = list.child(self.pull_request_discussion_card(
                view,
                DiscussionTarget::Thread(discussion.id.clone()),
                true,
                cx,
            ));
        }
        if view.discussions.draft.is_some() {
            list = list.child(self.pull_request_discussion_card(
                view,
                DiscussionTarget::Draft,
                false,
                cx,
            ));
        }
        list.into_any_element()
    }

    fn pull_request_discussion_card(
        &self,
        view: &PullRequestContent,
        target: DiscussionTarget,
        show_context: bool,
        cx: &Context<Self>,
    ) -> AnyElement {
        let Some(editor) = view.discussions.editor(&target) else {
            return div().into_any_element();
        };
        let Some(snapshot) = &view.state.snapshot else {
            return div().into_any_element();
        };
        let discussion = match &target {
            DiscussionTarget::Thread(id) => snapshot
                .discussions
                .items
                .iter()
                .find(|discussion| &discussion.id == id),
            DiscussionTarget::Draft => None,
        };
        let draft = if matches!(target, DiscussionTarget::Draft) {
            view.discussions.draft.as_ref()
        } else {
            None
        };
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let busy = editor.pending.is_some();
        let id = target.id().to_owned();
        let reference = view.state.reference.clone();
        let path = discussion
            .map(|discussion| discussion.path.clone())
            .or_else(|| draft.map(|draft| draft.range.path().to_string()))
            .unwrap_or_default();
        let line = discussion
            .and_then(|discussion| discussion.display_anchor().line)
            .map(|line| line as usize)
            .or_else(|| draft.map(|draft| draft.range.end()));
        let side = discussion
            .map(|discussion| match discussion.side {
                DiscussionSide::Left => self.t("pr.original"),
                DiscussionSide::Right => self.t("pr.modified"),
            })
            .or_else(|| {
                draft.map(|draft| {
                    if draft.range.end_side() == DiffSide::Original {
                        self.t("pr.original")
                    } else {
                        self.t("pr.modified")
                    }
                })
            })
            .unwrap_or_default();
        let mut header = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(pero_theme::SPACE_8))
            .font_weight(FontWeight::MEDIUM)
            .child(format!(
                "{path}{} · {side}",
                line.map(|line| format!(":{line}")).unwrap_or_default()
            ));
        if let Some(discussion) = discussion {
            header = header.child(pero_theme::outline_badge(
                self.t(if discussion.resolved {
                    "pr.discussion_resolved"
                } else {
                    "pr.discussion_open"
                }),
                chrome,
            ));
            if discussion.outdated {
                header = header.child(
                    pero_theme::outline_badge(self.t("pr.discussion_outdated"), chrome)
                        .text_color(p.text_muted),
                );
            }
        } else {
            header = header.child(pero_theme::outline_badge(
                self.t(
                    if draft.is_some_and(|draft| draft.head_sha != snapshot.head_sha) {
                        "pr.discussion_outdated"
                    } else {
                        "pr.new_discussion"
                    },
                ),
                chrome,
            ));
        }
        let mut card = div()
            .id(SharedString::from(format!("pr-thread-{id}")))
            .relative()
            .flex()
            .flex_col()
            .min_w_0()
            .p(px(pero_theme::SPACE_16))
            .gap(px(pero_theme::SPACE_12))
            .bg(p.surface)
            .border_1()
            .border_color(p.border)
            .rounded(px(pero_theme::RADIUS_PANEL))
            .font_weight(FontWeight::NORMAL)
            .child(
                self.view_bounds
                    .pull_request
                    .probe(format!("discussion-{id}")),
            )
            .child(header);
        if show_context && !editor.context.read(cx).files().is_empty() {
            card = card.child(
                div()
                    .h(px(160.))
                    .min_w_0()
                    .border_1()
                    .border_color(p.border)
                    .child(
                        Diff::new(&editor.context)
                            .size_full()
                            .syntax_highlight(true)
                            .soft_wrap(true),
                    ),
            );
        }
        if let Some(discussion) = discussion {
            for (index, comment) in discussion.comments.iter().enumerate() {
                let url = comment.url.clone();
                let mut row = div()
                    .flex()
                    .flex_col()
                    .min_w_0()
                    .gap(px(pero_theme::SPACE_4))
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap(px(pero_theme::SPACE_8))
                            .child(
                                div()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(comment.author.clone()),
                            )
                            .child(
                                div()
                                    .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                                    .text_color(p.text_muted)
                                    .child(comment.created_at.clone()),
                            )
                            .child(
                                Button::new(SharedString::from(format!(
                                    "pr-comment-link-{}",
                                    comment.id
                                )))
                                .ghost()
                                .small()
                                .icon(IconName::ExternalLink)
                                .accessibility_label(self.t("pr.external"))
                                .on_click(move |_, _, cx| cx.open_url(&url)),
                            ),
                    );
                if let Some(body) = editor.bodies.get(index) {
                    row = row.child(body.clone());
                }
                card = card.child(row);
            }
        }
        let can_reply = discussion.is_none_or(|discussion| discussion.can_reply);
        if can_reply {
            let label = self.t(if draft.is_some() {
                "pr.discussion_comment"
            } else {
                "pr.discussion_reply"
            });
            card = card.child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(pero_theme::SPACE_4))
                    .child(label)
                    .child(
                        div()
                            .relative()
                            .child(
                                self.view_bounds
                                    .pull_request
                                    .probe(format!("discussion-{id}-reply")),
                            )
                            .child(
                                Textarea::new(&editor.input)
                                    .h(px(80.))
                                    .aria_label(label)
                                    .disabled(busy),
                            ),
                    ),
            );
        }
        if let Some(error) = &editor.error {
            card = card.child(
                div()
                    .id("pr-discussion-error")
                    .role(Role::Alert)
                    .text_color(p.error)
                    .whitespace_normal()
                    .child(error.clone()),
            );
        }
        if let Some(notice) = editor.notice {
            card = card.child(
                div()
                    .id("pr-discussion-notice")
                    .role(Role::Status)
                    .text_color(p.text_muted)
                    .whitespace_normal()
                    .child(self.t(notice)),
            );
        }
        let mut actions = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(pero_theme::SPACE_8));
        if can_reply {
            let reference = reference.clone();
            let target = target.clone();
            actions = actions.child(
                Button::new(SharedString::from(format!("pr-reply-{id}")))
                    .primary()
                    .small()
                    .label(self.t(if busy {
                        "pr.discussion_saving"
                    } else if draft.is_some() {
                        "pr.discussion_publish"
                    } else {
                        "pr.discussion_reply"
                    }))
                    .disabled(busy || editor.input.read(cx).value().trim().is_empty())
                    .child(
                        self.view_bounds
                            .pull_request
                            .probe(format!("discussion-{id}-send")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.publish_pull_request_discussion(&reference, target.clone(), None, cx)
                    })),
            );
        }
        if let Some(discussion) = discussion {
            if if discussion.resolved {
                discussion.can_unresolve
            } else {
                discussion.can_resolve
            } {
                let reference = reference.clone();
                let target = target.clone();
                let resolved = !discussion.resolved;
                actions = actions.child(
                    Button::new(SharedString::from(format!("pr-resolve-{id}")))
                        .ghost()
                        .small()
                        .label(self.t(if resolved {
                            "pr.discussion_resolve"
                        } else {
                            "pr.discussion_unresolve"
                        }))
                        .disabled(busy)
                        .child(
                            self.view_bounds
                                .pull_request
                                .probe(format!("discussion-{id}-resolve")),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.publish_pull_request_discussion(
                                &reference,
                                target.clone(),
                                Some(resolved),
                                cx,
                            )
                        })),
                );
            }
            let reference = reference.clone();
            let discussion_id = discussion.id.clone();
            let workspace_ok = self.discussion_workspace_matches(&reference);
            actions = actions.child(
                Button::new(SharedString::from(format!("pr-fix-{id}")))
                    .ghost()
                    .small()
                    .label(self.t("pr.fix_agent"))
                    .disabled(busy || !self.connected || !workspace_ok)
                    .child(
                        self.view_bounds
                            .pull_request
                            .probe(format!("discussion-{id}-fix")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.fix_pull_request_discussion(&reference, &discussion_id, cx)
                    })),
            );
            if !workspace_ok {
                card = card.child(
                    div()
                        .text_color(p.text_muted)
                        .whitespace_normal()
                        .child(self.t("pr.fix_workspace")),
                );
                actions = actions.child(
                    Button::new(SharedString::from(format!("pr-discussion-workspace-{id}")))
                        .ghost()
                        .small()
                        .label(self.t("project.open_folder"))
                        .child(
                            self.view_bounds
                                .pull_request
                                .probe(format!("discussion-{id}-workspace")),
                        )
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.command(json!({"action":"choose_workspace"}), cx)
                        })),
                );
            }
        } else {
            let reference = reference.clone();
            actions = actions.child(
                Button::new("pr-discussion-cancel")
                    .ghost()
                    .small()
                    .label(self.t("pr.discussion_cancel"))
                    .disabled(busy)
                    .child(
                        self.view_bounds
                            .pull_request
                            .probe("discussion-new-cancel".into()),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(view) = this
                            .pull_requests
                            .iter_mut()
                            .find(|view| view.state.reference == reference)
                        {
                            view.discussions.draft = None;
                        }
                        cx.notify();
                    })),
            );
        }
        card.child(actions).into_any_element()
    }

    fn publish_pull_request_discussion(
        &mut self,
        reference: &PullRequestRef,
        target: DiscussionTarget,
        resolved: Option<bool>,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self
            .pull_requests
            .iter_mut()
            .find(|view| &view.state.reference == reference)
        else {
            return;
        };
        let Some(editor) = view.discussions.editor(&target) else {
            return;
        };
        if editor.pending.is_some() {
            return;
        }
        let body = editor.input.read(cx).value().to_string();
        self.next_request += 1;
        let request_id = format!("pr-discussion-{}", self.next_request);
        let mut command = match (&target, resolved) {
            (DiscussionTarget::Thread(id), Some(resolved)) => {
                json!({"action":"set_resolved","discussion_id":id,"resolved":resolved})
            }
            (DiscussionTarget::Thread(id), None) => {
                json!({"action":"reply","discussion_id":id,"body":body})
            }
            (DiscussionTarget::Draft, _) => {
                let draft = view.discussions.draft.as_ref().unwrap();
                let range = &draft.range;
                let (start, end) = if range.side() == range.end_side() {
                    (
                        range.start().min(range.end()),
                        range.start().max(range.end()),
                    )
                } else {
                    (range.start(), range.end())
                };
                json!({"action":"add_discussion","head_sha":draft.head_sha,"path":range.path().as_str(),"side":discussion_side(range.end_side()),"line":end,
                    "start_line":(start != end || range.side() != range.end_side()).then_some(start),"start_side":(start != end || range.side() != range.end_side()).then_some(discussion_side(range.side())),"body":body})
            }
        };
        let editor = view.discussions.editor_mut(&target).unwrap();
        editor.error = None;
        editor.notice = None;
        editor.pending = Some(DiscussionMutation {
            request_id: request_id.clone(),
            submitted: resolved.is_none().then_some(body),
        });
        command["method"] = json!("pull_requests");
        command["request_id"] = json!(request_id);
        command["reference"] = json!(reference);
        self.command(command, cx);
        cx.notify();
    }

    pub(super) fn receive_pull_request_discussion(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if !matches!(
            event.kind.as_str(),
            "pull_request_discussion_updated"
                | "pull_request_discussion_published"
                | "pull_request_error"
        ) {
            return false;
        }
        let Some(request_id) = event.request_id.as_deref() else {
            return false;
        };
        let Some((index, target)) =
            self.pull_requests
                .iter()
                .enumerate()
                .find_map(|(index, view)| {
                    let target = if view.discussions.draft.as_ref().is_some_and(|draft| {
                        draft
                            .editor
                            .pending
                            .as_ref()
                            .is_some_and(|pending| pending.request_id == request_id)
                    }) {
                        Some(DiscussionTarget::Draft)
                    } else {
                        view.discussions
                            .threads
                            .iter()
                            .find(|(_, editor)| {
                                editor
                                    .pending
                                    .as_ref()
                                    .is_some_and(|pending| pending.request_id == request_id)
                            })
                            .map(|(id, _)| DiscussionTarget::Thread(id.clone()))
                    };
                    target.map(|target| (index, target))
                })
        else {
            return false;
        };
        let view = &mut self.pull_requests[index];
        let editor = view.discussions.editor_mut(&target).unwrap();
        let pending = editor.pending.take().unwrap();
        if event.kind == "pull_request_error" {
            editor.error = Some(event.text.clone());
            cx.notify();
            return true;
        }
        if event.kind == "pull_request_discussion_published" {
            let reference = view.state.reference.clone();
            if matches!(target, DiscussionTarget::Draft) {
                view.discussions.draft = None;
            } else {
                editor
                    .input
                    .update(cx, |input, cx| input.set_value("", window, cx));
                editor.notice = Some("pr.discussion_published_refresh");
            }
            self.refresh_pull_request(&reference, cx);
            cx.notify();
            return true;
        }
        let result = serde_json::from_value::<PullRequestDiscussionUpdated>(event.data.clone());
        match result {
            Ok(updated) if updated.reference == view.state.reference => {
                if let Some(snapshot) = &mut view.state.snapshot {
                    if let Some(discussion) = snapshot
                        .discussions
                        .items
                        .iter_mut()
                        .find(|discussion| discussion.id == updated.discussion.id)
                    {
                        *discussion = updated.discussion;
                    } else {
                        snapshot.discussions.items.push(updated.discussion);
                    }
                }
                if matches!(target, DiscussionTarget::Draft) {
                    view.discussions.draft = None;
                } else if let Some(editor) = view.discussions.editor_mut(&target) {
                    if pending.submitted.as_deref() == Some(editor.input.read(cx).value().as_ref())
                    {
                        editor
                            .input
                            .update(cx, |input, cx| input.set_value("", window, cx));
                    }
                    editor.notice = Some("pr.discussion_saved");
                }
                self.sync_pull_request_discussions(index, window, cx);
            }
            Ok(_) => {
                view.discussions.editor_mut(&target).unwrap().error =
                    Some(pero_contracts::i18n::text(&self.locale, "pr.discussion_mismatch").into())
            }
            Err(error) => {
                view.discussions.editor_mut(&target).unwrap().error = Some(error.to_string())
            }
        }
        cx.notify();
        true
    }

    fn discussion_workspace_matches(&self, reference: &PullRequestRef) -> bool {
        let expected = RepositoryIdentity::from_git_remote(&format!(
            "https://github.com/{}",
            reference.repository()
        ));
        self.workspace_repositories.iter().any(|entry| {
            WorkspacePath(&entry.workspace).matches(&self.workspace)
                && expected.as_ref() == Some(&entry.repository)
        })
    }

    fn fix_pull_request_discussion(
        &mut self,
        reference: &PullRequestRef,
        discussion_id: &str,
        cx: &mut Context<Self>,
    ) {
        if !self.discussion_workspace_matches(reference) {
            return;
        }
        let context = self
            .pull_requests
            .iter()
            .find(|view| &view.state.reference == reference)
            .and_then(|view| view.state.snapshot.as_ref())
            .and_then(|snapshot| snapshot.discussion_context(discussion_id));
        let Some(context) = context else {
            return;
        };
        let text = self.t("pr.fix_prompt").to_owned();
        let workspace = self.workspace.clone();
        self.set_chat_dock(true, cx);
        self.chat.update(cx, |panel, cx| {
            panel.set_scope(None, cx);
            if !panel
                .active_chat
                .and_then(|index| panel.chats.get(index))
                .is_some_and(|chat| {
                    chat.scope.is_none() && WorkspacePath(&chat.workspace).matches(&workspace)
                })
            {
                panel.new_chat_in_scope(None, cx);
            }
            panel.compose_with_context(text, vec![context], cx);
        });
        cx.notify();
    }
}

fn discussion_side(side: DiffSide) -> DiscussionSide {
    match side {
        DiffSide::Original => DiscussionSide::Left,
        DiffSide::Modified => DiscussionSide::Right,
    }
}
