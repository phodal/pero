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
    reviews: Entity<StreamText>,
    scroll: ScrollHandle,
    _links: Vec<Subscription>,
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
        let description = cx.new(|cx| StreamText::new("", cx));
        let reviews = cx.new(|cx| StreamText::new("", cx));
        let links: Vec<_> = [&description, &reviews]
            .into_iter()
            .map(|view| {
                view.update(cx, |view, _| view.capture_links = true);
                cx.subscribe_in(
                    view,
                    &mut *window,
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
                )
            })
            .collect();
        self.pull_requests.push(PullRequestContent {
            state,
            description,
            reviews,
            scroll: ScrollHandle::new(),
            _links: links,
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
    pub(crate) fn receive_pull_request(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
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
        let Some(view) = self
            .pull_requests
            .iter_mut()
            .find(|view| view.state.pending.as_deref() == Some(request_id))
        else {
            return true;
        };
        let result = if event.kind == "pull_request_loaded" {
            serde_json::from_value::<PullRequestSnapshot>(event.data.clone())
                .map_err(|error| error.to_string())
        } else {
            Err(event.text.clone())
        };
        let summary = if view.state.receive(request_id, result) {
            if let Some(snapshot) = &view.state.snapshot {
                view.description
                    .update(cx, |view, cx| view.replace(&snapshot.body, cx));
                let text = snapshot
                    .reviews
                    .items
                    .iter()
                    .map(|review| {
                        format!(
                            "### {} · {}\n\n{}\n",
                            review.author, review.state, review.body
                        )
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                view.reviews.update(cx, |view, cx| view.replace(&text, cx));
            }
            view.state.snapshot.as_ref().map(|snapshot| snapshot.summary())
        } else {
            None
        };
        if let Some(summary) = summary {
            self.chat
                .update(cx, |chat, _| chat.note_pull_request(summary));
        }
        let _ = window;
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
                            this.refresh_pull_request(&reference, cx);
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
            .gap(px(8.))
            .p(px(16.))
            .border_b_1()
            .border_color(p.border);
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
                    .label(self.t("pr.refresh"))
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
                    .label(self.t("pr.external"))
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
                            "{} · {} → {}",
                            reference.repository(),
                            snapshot.head,
                            snapshot.base
                        )))
                        .child(actions),
                )
                .child(
                    div()
                        .text_size(chrome.text(pero_theme::TYPE_HEADING))
                        .font_weight(FontWeight::SEMIBOLD)
                        .whitespace_normal()
                        .child(format!("{} #{}", snapshot.title, reference.number())),
                )
                .child(
                    div()
                        .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                        .text_color(p.text_muted)
                        .child(format!(
                            "{} · {} {}  +{} −{}",
                            snapshot.author,
                            snapshot.changed_files,
                            self.t("pr.files"),
                            snapshot.additions,
                            snapshot.deletions
                        )),
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
                            .label(self.t(tab.key()))
                            .child(self.view_bounds.pull_request.probe(tab.key().into()))
                            .selected(state.tab == tab)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(view) = this
                                    .pull_requests
                                    .iter_mut()
                                    .find(|view| view.state.reference == reference)
                                {
                                    view.state.tab = tab;
                                    view.scroll.set_offset(point(px(0.), px(0.)));
                                }
                                this.queue_workspace_checkpoint(cx);
                                cx.notify();
                            }))
                    }),
            );
        let mut body = div()
            .id(SharedString::from(format!("pr-body-{}", reference.url())))
            .flex_1()
            .min_h_0()
            .min_w_0()
            .overflow_y_scroll()
            .track_scroll(&view.scroll);
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
                    if snapshot.reviews.items.is_empty() && snapshot.reviews.error.is_none() {
                        body = body.child(div().p(px(20.)).child(self.t("pr.no_reviews")));
                    } else {
                        body = body.child(div().p(px(20.)).child(view.reviews.clone()));
                    }
                }
                PullRequestTab::Commits => {
                    if snapshot.commits.items.is_empty() && snapshot.commits.error.is_none() {
                        body = body.child(div().p(px(20.)).child(self.t("pr.no_commits")));
                    }
                    for commit in &snapshot.commits.items {
                        body = body.child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(4.))
                                .p(px(16.))
                                .border_b_1()
                                .border_color(p.border)
                                .child(
                                    div()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .whitespace_normal()
                                        .child(commit.message.clone()),
                                )
                                .child(div().text_color(p.text_muted).child(format!(
                                    "{} · {}",
                                    commit.sha.chars().take(8).collect::<String>(),
                                    commit.author
                                ))),
                        );
                    }
                }
                PullRequestTab::Checks => {
                    if snapshot.checks.items.is_empty() && snapshot.checks.error.is_none() {
                        body = body.child(div().p(px(20.)).child(self.t("pr.no_checks")));
                    }
                    for (index, check) in snapshot.checks.items.iter().enumerate() {
                        let mut row = div()
                            .flex()
                            .flex_wrap()
                            .gap(px(12.))
                            .p(px(16.))
                            .border_b_1()
                            .border_color(p.border)
                            .child(div().flex_1().whitespace_normal().child(check.name.clone()))
                            .child(
                                div().text_color(p.text_muted).child(
                                    check
                                        .conclusion
                                        .as_deref()
                                        .unwrap_or(&check.status)
                                        .to_owned(),
                                ),
                            );
                        if let Some(url) = &check.url {
                            let url = url.clone();
                            row = row.child(
                                Button::new(("pr-check", index))
                                    .ghost()
                                    .small()
                                    .label(self.t("pr.details"))
                                    .on_click(move |_, _, cx| cx.open_url(&url)),
                            );
                        }
                        body = body.child(row);
                    }
                }
                PullRequestTab::Changes => {
                    if snapshot.files.items.len() as u64 != snapshot.changed_files {
                        body = body.child(div().p(px(12.)).child(self.t("pr.files_limited")));
                    }
                    let mut files = div().id("pr-file-list").max_h(px(180.)).overflow_y_scroll();
                    for (index, file) in snapshot.files.items.iter().enumerate() {
                        let selected = state.selected_file.as_deref() == Some(&file.filename);
                        let name = file.filename.clone();
                        let reference = reference.clone();
                        files = files.child(
                            Button::new(("pr-file", index))
                                .ghost()
                                .small()
                                .w_full()
                                .justify_start()
                                .label({
                                    let mark = match state.viewed_status(&file.filename) {
                                        ViewedStatus::Viewed => self.t("pr.viewed"),
                                        ViewedStatus::Stale => self.t("pr.stale"),
                                        ViewedStatus::Unseen => "",
                                    };
                                    let prefix = if mark.is_empty() {
                                        String::new()
                                    } else {
                                        format!("{mark} ")
                                    };
                                    format!(
                                        "{prefix}{}  +{} −{}  {}",
                                        file.filename, file.additions, file.deletions, file.status
                                    )
                                })
                                .selected(selected)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    if let Some(view) = this
                                        .pull_requests
                                        .iter_mut()
                                        .find(|view| view.state.reference == reference)
                                    {
                                        view.state.selected_file = Some(name.clone());
                                        view.state.mark_viewed(&name);
                                    }
                                    this.queue_workspace_checkpoint(cx);
                                    cx.notify();
                                })),
                        );
                    }
                    body = body.child(files);
                    if let Some(file) = snapshot
                        .files
                        .items
                        .iter()
                        .find(|file| Some(&file.filename) == state.selected_file.as_ref())
                    {
                        let viewed = state.viewed_status(&file.filename);
                        let mark_reference = reference.clone();
                        let mark_name = file.filename.clone();
                        body = body.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .p(px(12.))
                                .child(
                                    div()
                                        .flex_1()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .whitespace_normal()
                                        .child(file.filename.clone()),
                                )
                                .child(
                                    Button::new("pr-viewed")
                                        .ghost()
                                        .small()
                                        .label(self.t(if viewed == ViewedStatus::Unseen {
                                            "pr.mark_viewed"
                                        } else {
                                            "pr.unmark_viewed"
                                        }))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            if let Some(view) = this.pull_requests.iter_mut().find(|view| view.state.reference == mark_reference) {
                                                if view.state.viewed_status(&mark_name) == ViewedStatus::Unseen {
                                                    view.state.mark_viewed(&mark_name);
                                                } else {
                                                    view.state.unmark_viewed(&mark_name);
                                                }
                                            }
                                            this.queue_workspace_checkpoint(cx);
                                            cx.notify();
                                        })),
                                ),
                        );
                        if let Some(previous) = &file.previous_filename {
                            body = body.child(
                                div()
                                    .p(px(12.))
                                    .text_color(p.text_muted)
                                    .child(format!("{previous} → {}", file.filename)),
                            );
                        }
                        if let Some(patch) = &file.patch {
                            body = body.child(pero_chat_ui::comparison::unified_comparison(
                                &pero_contracts::workspace_changes::FileComparison::Text {
                                    patch: patch.clone(),
                                },
                                self.t("pr.diff_limited"),
                                cx,
                            ));
                        } else {
                            body =
                                body.child(div().p(px(20.)).child(self.t("pr.patch_unavailable")));
                        }
                    }
                    if snapshot.changed_files == 0 && snapshot.files.error.is_none() {
                        body = body.child(div().p(px(20.)).child(self.t("pr.no_changes")));
                    }
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
            .child(header)
            .child(tabs)
            .child(body)
            .into_any_element()
    }
}
