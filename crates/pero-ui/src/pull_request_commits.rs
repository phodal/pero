//! Commit subjects, messages and identities in a continuous reading list.
use crate::{app::Workbench, pull_requests::PullRequestContent};
use gpui_kit::{
    component::{avatar::Avatar, button::*, collapsible::Collapsible, *},
    prelude::*,
    *,
};

impl Workbench {
    pub(super) fn pull_request_commits(
        &self,
        view: &PullRequestContent,
        cx: &Context<Self>,
    ) -> AnyElement {
        let Some(snapshot) = &view.state.snapshot else {
            return div().into_any_element();
        };
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let mut list = div()
            .flex()
            .flex_col()
            .min_w_0()
            .text_size(chrome.text(pero_theme::TYPE_BODY))
            .font_weight(FontWeight::NORMAL);
        if snapshot.commits.items.is_empty() && snapshot.commits.error.is_none() {
            list = list.child(
                div()
                    .p(px(pero_theme::SPACE_20))
                    .text_color(p.text_muted)
                    .child(self.t("pr.no_commits")),
            );
        }
        for (index, commit) in snapshot.commits.items.iter().enumerate() {
            let (subject, details) = commit
                .message
                .split_once('\n')
                .unwrap_or((&commit.message, ""));
            let short_sha = commit.sha.chars().take(7).collect::<String>();
            let sha = commit.sha.clone();
            let details_sha = sha.clone();
            let reference = view.state.reference.clone();
            let details_open = view.commit_details_open.contains(&sha);
            let details_label = self.t(if details_open {
                "pr.hide_commit_message"
            } else {
                "pr.commit_message"
            });
            let avatar = Avatar::new().xsmall().name(commit.author.clone());
            list = list.child(
                div()
                    .flex()
                    .items_start()
                    .gap(px(pero_theme::SPACE_12))
                    .px(px(pero_theme::SPACE_20))
                    .py(px(pero_theme::SPACE_12))
                    .border_b_1()
                    .border_color(p.border)
                    .child(div().flex_shrink_0().child(avatar))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_w_0()
                            .gap(px(pero_theme::SPACE_4))
                            .child(
                                div()
                                    .flex()
                                    .items_start()
                                    .gap(px(pero_theme::SPACE_8))
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .font_weight(FontWeight::MEDIUM)
                                            .whitespace_normal()
                                            .child(subject.to_owned()),
                                    )
                                    .when(!details.trim().is_empty(), |el| {
                                        el.child(
                                            Button::new(("pr-commit-message", index))
                                                .ghost()
                                                .small()
                                                .p_0()
                                                .w(px(24.))
                                                .h(px(24.))
                                                .flex_shrink_0()
                                                .icon(
                                                    Icon::default().path(
                                                        pero_chat_ui::assets::UiIcon::named(
                                                            if details_open {
                                                                "chevron-down"
                                                            } else {
                                                                "chevron-right"
                                                            },
                                                        )
                                                        .path(),
                                                    ),
                                                )
                                                .accessibility_label(details_label)
                                                .tooltip(details_label)
                                                .child(
                                                    self.view_bounds
                                                        .pull_request
                                                        .probe(format!("commit-details-{index}")),
                                                )
                                                .on_click(cx.listener(move |this, _, _, cx| {
                                                    if let Some(view) =
                                                        this.pull_requests.iter_mut().find(|view| {
                                                            view.state.reference == reference
                                                        })
                                                    {
                                                        if !view
                                                            .commit_details_open
                                                            .remove(&details_sha)
                                                        {
                                                            view.commit_details_open
                                                                .insert(details_sha.clone());
                                                        }
                                                    }
                                                    cx.notify();
                                                })),
                                        )
                                    }),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap(px(pero_theme::SPACE_8))
                                    .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                                    .text_color(p.text_muted)
                                    .child(
                                        div()
                                            .min_w_0()
                                            .whitespace_normal()
                                            .child(commit.author.clone()),
                                    )
                                    .child(
                                        Button::new(("pr-copy-commit", index))
                                            .ghost()
                                            .small()
                                            .font_family(cx.theme().mono_font_family.clone())
                                            .label(short_sha)
                                            .icon(Icon::default().path(
                                                pero_chat_ui::assets::UiIcon::named("copy").path(),
                                            ))
                                            .accessibility_label(format!(
                                                "{} {}",
                                                self.t("pr.copy_sha"),
                                                commit.sha
                                            ))
                                            .tooltip(self.t("pr.copy_sha"))
                                            .on_click(move |_, _, cx| {
                                                cx.write_to_clipboard(ClipboardItem::new_string(
                                                    sha.clone(),
                                                ));
                                            }),
                                    ),
                            )
                            .when(!details.trim().is_empty(), |el| {
                                el.child(
                                    Collapsible::new().open(details_open).content(
                                        div()
                                            .pt(px(pero_theme::SPACE_8))
                                            .font_weight(FontWeight::NORMAL)
                                            .line_height(relative(1.5))
                                            .whitespace_normal()
                                            .child(details.trim().to_owned()),
                                    ),
                                )
                            }),
                    ),
            );
        }
        list.into_any_element()
    }
}
