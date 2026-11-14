//! Retained PR content views. Workspace navigation owns opening and closing.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_chat_ui::stream::StreamText;
use pero_contracts::{HostEvent, pane_tabs::OpenIntent, pull_request::*};
use serde_json::json;

pub(crate) struct PullRequestContent {
    pub state: PullRequestView,
    description: Entity<StreamText>,
    pub(super) reviews: Vec<Entity<StreamText>>,
    pub(super) commit_details_open: std::collections::BTreeSet<String>,
    pub(super) check_groups_open: [bool; 6],
    pub(super) scrolls: [ScrollHandle; 5],
    pub(super) directory_open: bool,
    pub(super) diff: crate::pull_request_diff::PullRequestDiff,
    pub(super) discussions: crate::pull_request_discussions::DiscussionViews,
    _links: Vec<Subscription>,
    _review_links: Vec<Subscription>,
}
impl Workbench {
    pub(crate) fn open_pull_request(
        &mut self,
        reference: PullRequestRef,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        self.ensure_pull_request(reference.clone(), window, cx);
        self.navigation
            .open_with_intent(WorkspaceItem::PullRequest(reference), OpenIntent::Preview);
        self.arm_pull_request_poll(cx);
        self.set_chat_dock(true, cx);
        self.sync_follow(cx);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    pub(crate) fn ensure_pull_request(
        &mut self,
        reference: PullRequestRef,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self
            .pull_requests
            .iter()
            .any(|view| view.state.reference == reference)
        {
            return;
        }
        let mut state = PullRequestView::new(reference.clone());
        if let Some(reading) = self
            .restored_pull_requests
            .iter()
            .find(|reading| reading.reference == reference)
            .cloned()
        {
            state.restore_reading(reading);
        }
        let (description, link) = pull_request_markdown("", window, cx);
        let diff = crate::pull_request_diff::PullRequestDiff::new(cx);
        let observer = cx.observe(&diff.state, |_, _, cx| cx.notify());
        self.pull_requests.push(PullRequestContent {
            state,
            description,
            reviews: Vec::new(),
            commit_details_open: Default::default(),
            check_groups_open: [true, true, true, false, false, true],
            scrolls: std::array::from_fn(|_| ScrollHandle::new()),
            directory_open: false,
            diff,
            discussions: Default::default(),
            _links: vec![link, observer],
            _review_links: Vec::new(),
        });
        self.refresh_pull_request(&reference, cx);
    }
    pub(crate) fn refresh_pull_request(
        &mut self,
        reference: &PullRequestRef,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self
            .pull_requests
            .iter_mut()
            .find(|view| &view.state.reference == reference)
        else {
            return;
        };
        if view.state.pending.is_some() {
            return;
        }
        self.next_request += 1;
        let request_id = format!("pull-request-{}", self.next_request);
        view.state.refresh(request_id.clone());
        self.command(json!({"method":"pull_requests","action":"load","request_id":request_id,"reference":reference}),cx);
    }
    pub(crate) fn refresh_observed_pull_request(
        &mut self,
        reference: &PullRequestRef,
        cx: &mut Context<Self>,
    ) {
        let Some(view) = self
            .pull_requests
            .iter_mut()
            .find(|view| &view.state.reference == reference)
        else {
            return;
        };
        if view.state.pending.is_some() {
            return;
        }
        self.next_request += 1;
        let request_id = format!("pull-request-{}", self.next_request);
        view.state.refresh_observed(request_id.clone());
        self.command(json!({"method":"pull_requests","action":"load","request_id":request_id,"reference":reference}),cx);
    }
    pub(crate) fn receive_pull_request(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.receive_pull_request_discussion(event, window, cx) {
            return true;
        }
        if self.receive_pull_request_list(event, cx) {
            return true;
        }
        if !matches!(
            event.kind.as_str(),
            "pull_request_loaded" | "pull_request_error" | "pull_request_discovered"
        ) {
            return false;
        }
        if event.kind == "pull_request_discovered" {
            if let Ok(reference) =
                serde_json::from_value::<PullRequestRef>(event.data["reference"].clone())
            {
                if self.discovered_pull_requests.insert(reference.clone()) {
                    self.ensure_pull_request(reference.clone(), window, cx);
                    self.navigation
                        .open_background(WorkspaceItem::PullRequest(reference));
                    self.queue_workspace_checkpoint(cx);
                    cx.notify();
                } else if self
                    .pull_requests
                    .iter()
                    .any(|view| view.state.reference == reference)
                {
                    self.refresh_pull_request(&reference, cx);
                }
            }
            return true;
        }
        let Some(request_id) = event.request_id.as_deref() else {
            return true;
        };
        let Some(index) = self
            .pull_requests
            .iter()
            .position(|view| view.state.pending.as_deref() == Some(request_id))
        else {
            return true;
        };
        let view = &mut self.pull_requests[index];
        let result = if event.kind == "pull_request_loaded" {
            serde_json::from_value::<PullRequestSnapshot>(event.data.clone())
                .map_err(|error| error.to_string())
        } else {
            Err(event.text.clone())
        };
        let summary = if view.state.receive(request_id, result) {
            let sections = view.state.sections;
            if sections.files && view.state.error.is_none() {
                view.diff.receive(&view.state, cx);
            }
            if let Some(snapshot) = &view.state.snapshot {
                if sections.body {
                    let body = snapshot.body.clone();
                    view.description
                        .update(cx, |view, cx| view.replace(&body, cx));
                }
                if sections.reviews {
                    view._review_links.clear();
                    view.reviews.clear();
                    for review in &snapshot.reviews.items {
                        let (body, link) = pull_request_markdown(&review.body, window, cx);
                        view.reviews.push(body);
                        view._review_links.push(link);
                    }
                }
            }
            view.state
                .snapshot
                .as_ref()
                .map(|snapshot| snapshot.summary())
        } else {
            None
        };
        if let Some(summary) = summary {
            self.chat
                .update(cx, |chat, _| chat.note_pull_request(summary));
        }
        self.sync_pull_request_discussions(index, window, cx);
        cx.notify();
        true
    }
    pub(crate) fn arm_pull_request_poll(&mut self, cx: &mut Context<Self>) {
        if self.pull_request_poll_armed {
            return;
        }
        self.pull_request_poll_armed = true;
        self.pull_request_poll += 1;
        let generation = self.pull_request_poll;
        cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor().timer(ACTIVE_REFRESH).await;
                let continue_poll = this
                    .update(cx, |this, cx| {
                        if this.pull_request_poll != generation {
                            return false;
                        }
                        let Some(WorkspaceItem::PullRequest(reference)) =
                            this.navigation.current().cloned()
                        else {
                            this.pull_request_poll_armed = false;
                            return false;
                        };
                        let pending = this
                            .pull_requests
                            .iter()
                            .find(|view| view.state.reference == reference)
                            .is_some_and(|view| view.state.pending.is_some());
                        if !pending {
                            this.refresh_observed_pull_request(&reference, cx);
                        }
                        true
                    })
                    .unwrap_or(false);
                if !continue_poll {
                    break;
                }
            }
        })
        .detach();
    }
    pub(crate) fn pull_request_content(
        &self,
        reference: &PullRequestRef,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(view) = self
            .pull_requests
            .iter()
            .find(|view| &view.state.reference == reference)
        else {
            return div().flex_1().into_any_element();
        };
        let state = &view.state;
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let mut header = div()
            .flex()
            .flex_col()
            .gap(px(pero_theme::SPACE_8))
            .px(px(pero_theme::SPACE_16))
            .pt(px(pero_theme::SPACE_12))
            .pb(px(pero_theme::SPACE_8));
        let refresh = reference.clone();
        let external = reference.url().to_owned();
        let actions = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .child(
                Button::new("pr-refresh")
                    .ghost()
                    .small()
                    .icon(IconName::RefreshCw)
                    .accessibility_label(self.t("pr.refresh"))
                    .tooltip(self.t("pr.refresh"))
                    .child(self.view_bounds.pull_request.probe("refresh".into()))
                    .disabled(state.pending.is_some())
                    .on_click(
                        cx.listener(move |this, _, _, cx| this.refresh_pull_request(&refresh, cx)),
                    ),
            )
            .child(
                Button::new("pr-external")
                    .ghost()
                    .small()
                    .icon(IconName::ExternalLink)
                    .accessibility_label(self.t("pr.external"))
                    .tooltip(self.t("pr.external"))
                    .on_click(move |_, _, cx| cx.open_url(&external)),
            );
        let actions = actions.when(
            self.layout.narrow && self.chat.read(cx).active_chat.is_some(),
            |el| {
                el.child(
                    Button::new("pr-conversation")
                        .ghost()
                        .small()
                        .label(self.t("workspace.conversation"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            let active = this.chat.read(cx).active_chat;
                            this.focus_chat(active, crate::workspace::ConversationTab::Chat, cx);
                        })),
                )
            },
        );
        if let Some(snapshot) = &state.snapshot {
            let status_color = match snapshot.status {
                PullRequestStatus::Merged => p.info,
                PullRequestStatus::Open => p.success,
                PullRequestStatus::Closed => p.error,
                PullRequestStatus::Draft => p.text_muted,
            };
            header = header
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            pero_theme::outline_badge(self.t(snapshot.status.key()), chrome)
                                .text_color(status_color)
                                .border_color(status_color),
                        )
                        .child(div().text_color(p.text_muted).child(format!(
                            "{}  ·  {} → {}",
                            reference.repository(),
                            snapshot.head,
                            snapshot.base
                        )))
                        .child(div().flex_1())
                        .child(actions),
                )
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_baseline()
                        .gap(px(pero_theme::SPACE_4))
                        .text_size(chrome.text(pero_theme::TYPE_HEADING))
                        .font_weight(FontWeight::SEMIBOLD)
                        .whitespace_normal()
                        .child(snapshot.title.clone())
                        .child(
                            div()
                                .text_color(p.text_muted)
                                .child(format!(" #{}", reference.number())),
                        ),
                );
        } else {
            header = header
                .child(div().child(format!(
                    "{} #{}",
                    reference.repository(),
                    reference.number()
                )))
                .child(actions);
        }
        let tabs = div()
            .flex()
            .items_center()
            .flex_wrap()
            .gap(px(4.))
            .px(px(12.))
            .py(px(8.))
            .border_b_1()
            .border_color(p.border)
            .children(
                PullRequestTab::ALL
                    .into_iter()
                    .enumerate()
                    .map(|(index, tab)| {
                        let reference = reference.clone();
                        Button::new(("pr-subview", index))
                            .ghost()
                            .small()
                            .label(match (tab, state.snapshot.as_ref()) {
                                (PullRequestTab::Checks, Some(snapshot))
                                    if snapshot.checks.error.is_none()
                                        && !snapshot.checks.items.is_empty() =>
                                {
                                    self.t(CheckSummary::from_checks(&snapshot.checks.items).key())
                                }
                                _ => self.t(tab.key()),
                            })
                            .when_some(
                                state.snapshot.as_ref().and_then(|snapshot| match tab {
                                    PullRequestTab::Changes => {
                                        Some(snapshot.changed_files as usize)
                                    }
                                    PullRequestTab::Commits => Some(snapshot.commits.items.len()),
                                    PullRequestTab::Checks => Some(snapshot.checks.items.len()),
                                    PullRequestTab::Reviews => Some(
                                        snapshot.reviews.items.len()
                                            + snapshot.discussions.items.len(),
                                    ),
                                    PullRequestTab::Description => None,
                                }),
                                |button, count| {
                                    button.child(
                                        div().text_color(p.text_muted).child(count.to_string()),
                                    )
                                },
                            )
                            .child(self.view_bounds.pull_request.probe(tab.key().into()))
                            .selected(state.tab == tab)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(view) = this
                                    .pull_requests
                                    .iter_mut()
                                    .find(|view| view.state.reference == reference)
                                {
                                    view.state.tab = tab;
                                }
                                this.queue_workspace_checkpoint(cx);
                                cx.notify();
                            }))
                    }),
            )
            .when(state.tab == PullRequestTab::Changes, |el| {
                el.when_some(state.snapshot.as_ref(), |el, snapshot| {
                    el.child(self.pull_request_change_tools(view, snapshot, cx))
                })
            });
        let mut body = div()
            .id(SharedString::from(format!("pr-body-{}", reference.url())))
            .flex_1()
            .min_h_0()
            .min_w_0()
            .when(state.tab != PullRequestTab::Changes, |el| {
                el.overflow_y_scroll()
                    .track_scroll(&view.scrolls[state.tab.index()])
            })
            .when(state.tab == PullRequestTab::Changes, |el| {
                el.flex().flex_col().overflow_hidden()
            });
        if let Some(error) = &state.error {
            body = body.child(pero_theme::feedback(
                "pr-error",
                self.t(if state.snapshot.is_some() {
                    "pr.refresh_failed"
                } else {
                    "pr.load_failed"
                }),
                error.clone(),
                pero_theme::FeedbackKind::Error,
                chrome,
            ));
        }
        if state.pending.is_some() {
            body = body.child(div().p(px(12.)).text_color(p.text_muted).child(self.t(
                if state.snapshot.is_some() {
                    "pr.refreshing"
                } else {
                    "pr.loading"
                },
            )));
        }
        if let Some(snapshot) = &state.snapshot {
            let section_error = match state.tab {
                PullRequestTab::Changes => &snapshot.files.error,
                PullRequestTab::Commits => &snapshot.commits.error,
                PullRequestTab::Checks => &snapshot.checks.error,
                PullRequestTab::Reviews => &snapshot.reviews.error,
                PullRequestTab::Description => &None,
            };
            if let Some(error) = section_error {
                body = body.child(pero_theme::feedback(
                    "pr-section-error",
                    self.t("pr.section_failed"),
                    error.clone(),
                    pero_theme::FeedbackKind::Warning,
                    chrome,
                ));
            }
            match state.tab {
                PullRequestTab::Description => {
                    body = body.child(
                        div()
                            .p(px(20.))
                            .when(snapshot.body.is_empty(), |el| {
                                el.child(self.t("pr.no_description"))
                            })
                            .child(view.description.clone()),
                    );
                }
                PullRequestTab::Reviews => {
                    body = body
                        .child(self.pull_request_reviews(view, cx))
                        .child(self.pull_request_discussion_list(view, cx));
                }
                PullRequestTab::Commits => {
                    body = body.child(self.pull_request_commits(view, cx));
                }
                PullRequestTab::Checks => {
                    body = body.child(self.pull_request_checks(view, cx));
                }
                PullRequestTab::Changes => {
                    body = body.child(self.pull_request_changes(view, snapshot, cx));
                }
            }
        }
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .bg(p.surface)
            .text_color(p.text)
            .text_size(chrome.text(pero_theme::TYPE_BODY))
            .font_weight(FontWeight::NORMAL)
            .child(header)
            .child(tabs)
            .child(body)
            .into_any_element()
    }
}

/// PR prose shares the workspace link owner, including each independent review body.
pub(super) fn pull_request_markdown(
    text: &str,
    window: &mut Window,
    cx: &mut Context<Workbench>,
) -> (Entity<StreamText>, Subscription) {
    let body = cx.new(|cx| StreamText::new(text, cx));
    body.update(cx, |view, _| view.capture_links = true);
    let link = cx.subscribe_in(
        &body,
        window,
        |this, _, link: &pero_chat_ui::stream::MarkdownLink, window, cx| {
            this.follow_link(
                &link.href,
                pero_contracts::workbench::LinkClick {
                    middle: link.middle,
                    primary_modifier: link.primary_modifier,
                },
                window,
                cx,
            );
        },
    );
    (body, link)
}
