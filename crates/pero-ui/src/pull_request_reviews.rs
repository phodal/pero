//! Individual review entries retain their Markdown and link behavior.
use crate::{app::Workbench, pull_requests::PullRequestContent};
use gpui_kit::{
    component::{Sizable, avatar::Avatar},
    prelude::*,
    *,
};

impl Workbench {
    pub(super) fn pull_request_reviews(
        &self,
        view: &PullRequestContent,
        cx: &Context<Self>,
    ) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let Some(snapshot) = &view.state.snapshot else {
            return div().into_any_element();
        };
        if snapshot.reviews.items.is_empty() && snapshot.discussions.items.is_empty() {
            return div()
                .px(chrome.geo(pero_theme::SPACE_24))
                .py(chrome.geo(pero_theme::SPACE_20))
                .text_color(p.text_muted)
                .when(snapshot.reviews.error.is_none(), |el| {
                    el.child(self.t("pr.no_reviews"))
                })
                .into_any_element();
        }
        let mut timeline = div()
            .w_full()
            .max_w(chrome.geo(pero_theme::READER_MAX_WIDTH))
            .min_w_0()
            .px(chrome.geo(pero_theme::SPACE_24))
            .py(chrome.geo(pero_theme::SPACE_20))
            .text_size(chrome.text(pero_theme::TYPE_BODY))
            .font_weight(FontWeight::NORMAL);
        for (index, review) in snapshot.reviews.items.iter().enumerate() {
            let (label, color) = match review.state.as_str() {
                "APPROVED" => (self.t("pr.approved").to_owned(), p.success),
                "CHANGES_REQUESTED" => (self.t("pr.changes_requested").to_owned(), p.error),
                "COMMENTED" => (self.t("pr.commented").to_owned(), p.text_muted),
                "PENDING" => (self.t("pr.review_pending").to_owned(), p.text_muted),
                "DISMISSED" => (self.t("pr.review_dismissed").to_owned(), p.text_muted),
                _ => (review.state.clone(), p.text_muted),
            };
            let face = Avatar::new().xsmall().name(review.author.clone());
            let last = index + 1 == snapshot.reviews.items.len();
            let rail = div()
                .flex()
                .flex_col()
                .items_center()
                .flex_shrink_0()
                .w(chrome.geo(pero_theme::SPACE_24))
                .child(face)
                .when(!last, |el| {
                    el.child(
                        div()
                            .flex_1()
                            .min_h(chrome.geo(pero_theme::SPACE_16))
                            .w(px(1.))
                            .mt(chrome.geo(pero_theme::SPACE_8))
                            .bg(p.border),
                    )
                });
            let entry = div()
                .flex_1()
                .min_w_0()
                .pb(chrome.geo(pero_theme::SPACE_24))
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .items_center()
                        .min_h(chrome.geo(pero_theme::SPACE_24))
                        .gap(chrome.geo(pero_theme::SPACE_8))
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .whitespace_normal()
                                .child(review.author.clone()),
                        )
                        .when(!label.is_empty(), |el| {
                            el.child(
                                div()
                                    .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                                    .text_color(color)
                                    .child(label),
                            )
                        }),
                )
                .when(!review.body.trim().is_empty(), |el| {
                    el.when_some(view.reviews.get(index).cloned(), |el, body| {
                        el.child(
                            div()
                                .min_w_0()
                                .mt(chrome.geo(pero_theme::SPACE_8))
                                .p(chrome.geo(pero_theme::SPACE_16))
                                .border_1()
                                .border_color(p.border)
                                .rounded(chrome.geo(pero_theme::RADIUS_PANEL))
                                .bg(p.surface)
                                .font_weight(FontWeight::NORMAL)
                                .child(body),
                        )
                    })
                });
            timeline = timeline.child(
                div()
                    .flex()
                    .min_w_0()
                    .gap(chrome.geo(pero_theme::SPACE_12))
                    .child(rail)
                    .child(entry),
            );
        }
        timeline.into_any_element()
    }
}
