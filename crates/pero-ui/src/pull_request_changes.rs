//! Continuous PR review uses Kit's retained, highlighted diff and an optional directory.
use crate::{app::Workbench, pull_requests::PullRequestContent};
use gpui_kit::{
    component::{
        button::*,
        checkbox::Checkbox,
        diff::{Diff, DiffAnnotation, DiffHunkSeparator},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::pull_request::*;
use pero_theme::{SPACE_4, SPACE_8, SPACE_16};

impl Workbench {
    pub(super) fn pull_request_change_tools(
        &self,
        view: &PullRequestContent,
        snapshot: &PullRequestSnapshot,
        cx: &Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::Chrome::from_app(cx).palette;
        let state = &view.state;
        let toggle_reference = state.reference.clone();
        let filter_reference = state.reference.clone();
        div()
            .ml_auto()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(SPACE_8))
            .child(
                div()
                    .text_color(p.success)
                    .child(format!("+{}", snapshot.additions)),
            )
            .child(
                div()
                    .text_color(p.error)
                    .child(format!("−{}", snapshot.deletions)),
            )
            .child(
                Checkbox::new("pr-soft-wrap")
                    .label(self.t("pr.soft_wrap"))
                    .checked(self.preferences.layout.diff_soft_wrap)
                    .child(self.view_bounds.pull_request.probe("soft-wrap".into()))
                    .on_click(cx.listener(|this, checked: &bool, _, cx| {
                        let mut preferences = this.preferences.clone();
                        preferences.layout.diff_soft_wrap = *checked;
                        this.save_preferences(preferences, cx);
                    })),
            )
            .child(
                Button::new("pr-hide-viewed")
                    .ghost()
                    .small()
                    .label(self.t(if state.hide_viewed {
                        "pr.show_viewed"
                    } else {
                        "pr.hide_viewed"
                    }))
                    .child(self.view_bounds.pull_request.probe("hide-viewed".into()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(view) = this
                            .pull_requests
                            .iter_mut()
                            .find(|view| view.state.reference == filter_reference)
                        {
                            view.state.hide_viewed = !view.state.hide_viewed;
                            view.diff.filter(&view.state, cx);
                        }
                        cx.notify();
                    })),
            )
            .child(
                Button::new("pr-files-toggle")
                    .ghost()
                    .small()
                    .selected(view.directory_open)
                    .label(self.t("pr.file_directory"))
                    .tooltip(self.t(if view.directory_open {
                        "pr.hide_files"
                    } else {
                        "pr.show_files"
                    }))
                    .child(self.view_bounds.pull_request.probe("files-toggle".into()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(view) = this
                            .pull_requests
                            .iter_mut()
                            .find(|view| view.state.reference == toggle_reference)
                        {
                            view.directory_open = !view.directory_open;
                        }
                        cx.notify();
                    })),
            )
            .into_any_element()
    }

    pub(super) fn pull_request_changes(
        &self,
        view: &PullRequestContent,
        snapshot: &PullRequestSnapshot,
        cx: &Context<Self>,
    ) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let state = &view.state;
        let reference = state.reference.clone();
        let files: Vec<_> = snapshot
            .files
            .items
            .iter()
            .filter(|file| state.shows_file(&file.filename))
            .collect();
        let mut directory = div()
            .id("pr-file-directory")
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(SPACE_8))
            .gap(px(SPACE_4))
            .bg(chrome.list());
        for (index, file) in files.iter().enumerate() {
            let path = file.filename.clone();
            let selected = state.selected_file.as_deref() == Some(&path);
            let directory_reference = reference.clone();
            directory = directory.child(
                Button::new(("pr-file", index))
                    .ghost()
                    .small()
                    .w_full()
                    .justify_start()
                    .selected(selected)
                    .label(path.clone())
                    .tooltip(path.clone())
                    .child(self.view_bounds.pull_request.probe(format!("file-{index}")))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(view) = this
                            .pull_requests
                            .iter_mut()
                            .find(|view| view.state.reference == directory_reference)
                        {
                            view.state.selected_file = Some(path.clone());
                            view.diff
                                .state
                                .update(cx, |diff, cx| diff.scroll_to_file(&path, cx));
                        }
                        this.queue_workspace_checkpoint(cx);
                        cx.notify();
                    })),
            );
        }
        let viewed_label = self.t("pr.viewed");
        let stale_label = self.t("pr.stale");
        let owner = cx.entity().downgrade();
        let reading = state.clone();
        let marks = self.view_bounds.pull_request.probe("diff".into());
        let notices: Vec<_> = view
            .diff
            .notices
            .iter()
            .filter(|(path, _)| state.shows_file(path))
            .map(|(path, key)| (path.clone(), self.t(key)))
            .collect();
        let mut annotations: Vec<_> = notices
            .iter()
            .enumerate()
            .map(|(index, (path, _))| DiffAnnotation::file(("pr-notice", index), path.clone()))
            .collect();
        annotations.extend(self.pull_request_discussion_annotations(view));
        let discussion_owner = owner.clone();
        let discussion_reference = reference.clone();
        let add_owner = owner.clone();
        let add_reference = reference.clone();
        let diff = Diff::new(&view.diff.state)
            .border_0()
            .size_full()
            .syntax_highlight(true)
            .hunk_separator(DiffHunkSeparator::LineInfo)
            .soft_wrap(self.preferences.layout.diff_soft_wrap)
            .annotations(annotations)
            .render_annotation(move |annotation, _, cx| {
                if let Ok(Some(content)) = discussion_owner.update(cx, |this, cx| {
                    let view = this
                        .pull_requests
                        .iter()
                        .find(|view| view.state.reference == discussion_reference)?;
                    this.render_pull_request_annotation(view, annotation, cx)
                }) {
                    return content;
                }
                let chrome = pero_theme::Chrome::from_app(cx);
                div()
                    .p(px(SPACE_16))
                    .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                    .text_color(chrome.palette.text_muted)
                    .child(
                        notices
                            .iter()
                            .find(|(path, _)| path == annotation.path().as_str())
                            .map(|(_, text)| *text)
                            .unwrap_or_default(),
                    )
                    .into_any_element()
            })
            .on_add_annotation(move |range, window, cx| {
                let _ = add_owner.update(cx, |this, cx| {
                    this.begin_pull_request_discussion(&add_reference, range.clone(), window, cx)
                });
            })
            .render_header_suffix(move |file, _, cx| {
                let chrome = pero_theme::Chrome::from_app(cx);
                let path = file.path().to_string();
                let viewed = reading.viewed_status(&path);
                let owner = owner.clone();
                let reference = reference.clone();
                let mut suffix = div()
                    .flex()
                    .items_center()
                    .gap(px(SPACE_8))
                    .text_size(chrome.text(pero_theme::TYPE_CAPTION));
                if viewed == ViewedStatus::Stale {
                    suffix = suffix.child(
                        div()
                            .text_color(chrome.palette.text_muted)
                            .child(stale_label),
                    );
                }
                suffix.child(
                    Checkbox::new(SharedString::from(format!("pr-viewed-{}", file.path())))
                        .label(viewed_label)
                        .checked(viewed == ViewedStatus::Viewed)
                        .on_click(move |checked, _, cx| {
                            let _ = owner.update(cx, |this, cx| {
                                if let Some(view) = this
                                    .pull_requests
                                    .iter_mut()
                                    .find(|view| view.state.reference == reference)
                                {
                                    if *checked {
                                        view.state.mark_viewed(&path);
                                    } else {
                                        view.state.unmark_viewed(&path);
                                    }
                                    if view.state.hide_viewed {
                                        view.diff.filter(&view.state, cx);
                                    }
                                }
                                this.queue_workspace_checkpoint(cx);
                                cx.notify();
                            });
                        }),
                )
            });
        // Kit scales its code font from a 16px rem. Use the shared compact/body
        // ratio so the default 14px code setting reads at 12px and user sizing scales it.
        let code = pero_theme::UiAppearance::global(cx).typography.code;
        let compact =
            (code * pero_theme::TYPE_CAPTION / pero_theme::TYPE_BODY).max(pero_theme::TYPE_CAPTION);
        let diffs = pero_theme::TypographyScope::new(px(16. * compact / code))
            .flex_1()
            .min_w_0()
            .min_h_0()
            .font_weight(FontWeight::NORMAL)
            .child(marks)
            .child(diff);
        let mut content = div()
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .when(self.layout.narrow, |el| el.flex_col());
        if view.directory_open {
            content = content.child(
                directory
                    .when(self.layout.narrow, |el| {
                        el.max_h(px(180.)).flex_shrink_0().border_b_1()
                    })
                    .when(!self.layout.narrow, |el| {
                        el.w(px(pero_theme::SIDEBAR_WIDTH))
                            .flex_shrink_0()
                            .border_r_1()
                    })
                    .border_color(p.border),
            );
        }
        content = content.child(diffs);
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .when_some(snapshot.discussions.error.as_ref(), |el, error| {
                el.child(pero_theme::feedback(
                    "pr-discussions-error",
                    self.t("pr.discussions_failed"),
                    error.clone(),
                    pero_theme::FeedbackKind::Warning,
                    chrome,
                ))
            })
            .when(
                snapshot.files.items.len() as u64 != snapshot.changed_files,
                |el| {
                    el.child(
                        div()
                            .px(px(SPACE_16))
                            .py(px(SPACE_8))
                            .child(self.t("pr.files_limited")),
                    )
                },
            )
            .when(files.is_empty() && snapshot.files.error.is_none(), |el| {
                el.child(div().p(px(SPACE_16)).text_color(p.text_muted).child(self.t(
                    if snapshot.changed_files == 0 {
                        "pr.no_changes"
                    } else {
                        "pr.all_viewed"
                    },
                )))
            })
            .child(content)
            .into_any_element()
    }
}
