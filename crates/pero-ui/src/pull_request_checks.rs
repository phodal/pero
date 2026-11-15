//! Grouped check results retain every observed outcome, including skipped checks.
use crate::{app::Workbench, pull_requests::PullRequestContent};
use gpui_kit::{
    component::{button::*, collapsible::Collapsible, *},
    prelude::*,
    *,
};
use pero_contracts::pull_request::{CheckOutcome, CheckSummary};

impl Workbench {
    pub(super) fn pull_request_checks(
        &self,
        view: &PullRequestContent,
        cx: &Context<Self>,
    ) -> AnyElement {
        let chrome = pero_theme::Chrome::from_app(cx);
        let p = chrome.palette;
        let Some(snapshot) = &view.state.snapshot else {
            return div().into_any_element();
        };
        let checks = &snapshot.checks;
        if checks.items.is_empty() {
            return div()
                .p(px(pero_theme::SPACE_20))
                .when(checks.error.is_none(), |el| {
                    el.child(self.t("pr.no_checks"))
                })
                .into_any_element();
        }
        let summary = CheckSummary::from_checks(&checks.items);
        let mut groups = div().flex().flex_col().min_w_0();
        for outcome in CheckOutcome::ALL {
            let count = summary.count(outcome);
            if count == 0 {
                continue;
            }
            let index = outcome.index();
            let open = view.check_groups_open[index];
            let reference = view.state.reference.clone();
            let (icon, color) = match outcome {
                CheckOutcome::Attention => ("circle-x", p.error),
                CheckOutcome::Running => ("clock", p.info),
                CheckOutcome::Passed => ("check", p.success),
                CheckOutcome::Skipped => ("minus", p.text_muted),
                CheckOutcome::Neutral => ("circle-filled", p.text_muted),
                CheckOutcome::Unknown => ("circle-alert", p.warning),
            };
            let mut rows = div().flex().flex_col().min_w_0();
            for (check_index, check) in checks.items.iter().enumerate() {
                if check.outcome() != outcome {
                    continue;
                }
                let mut row = div()
                    .flex()
                    .items_start()
                    .gap(px(pero_theme::SPACE_12))
                    .px(px(pero_theme::SPACE_16))
                    .py(px(pero_theme::SPACE_8))
                    .border_b_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .flex_shrink_0()
                            .w(px(16.))
                            .pt(px(2.))
                            .child(self.icon(icon).size(px(16.)).text_color(color)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .line_height(relative(1.4))
                            .whitespace_normal()
                            .child(check.name.clone()),
                    )
                    .child(
                        div()
                            .flex_shrink_0()
                            .w(chrome.text(pero_theme::TYPE_CAPTION) * 8.)
                            .pt(px(2.))
                            .text_size(chrome.text(pero_theme::TYPE_CAPTION))
                            .text_color(p.text_muted)
                            .whitespace_normal()
                            .child(
                                check
                                    .conclusion
                                    .as_deref()
                                    .unwrap_or(&check.status)
                                    .replace('_', " "),
                            ),
                    );
                row = row.child(
                    div()
                        .flex_shrink_0()
                        .w(chrome.text(pero_theme::TYPE_CAPTION) * 5.)
                        .when_some(check.url.as_ref(), |el, url| {
                            let url = url.clone();
                            el.child(
                                Button::new(("pr-check", check_index))
                                    .ghost()
                                    .small()
                                    .label(self.t("pr.details"))
                                    .on_click(move |_, _, cx| cx.open_url(&url)),
                            )
                        }),
                );
                rows = rows.child(row);
            }
            groups = groups.child(
                Collapsible::new()
                    .open(open)
                    .child(
                        Button::new(("pr-check-group", index))
                            .ghost()
                            .small()
                            .w_full()
                            .justify_start()
                            .px(px(pero_theme::SPACE_16))
                            .h_auto()
                            .min_h(px(32.))
                            .py(px(pero_theme::SPACE_8))
                            .rounded_none()
                            .bg(p.surface_muted)
                            .child(
                                self.view_bounds
                                    .pull_request
                                    .probe(format!("check-group-{index}")),
                            )
                            .accessibility_label(format!("{}  {count}", self.t(outcome.key())))
                            .child(
                                div()
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .items_center()
                                    .gap(px(pero_theme::SPACE_8))
                                    .child(
                                        self.icon(if open {
                                            "chevron-down"
                                        } else {
                                            "chevron-right"
                                        })
                                        .size(px(14.)),
                                    )
                                    .child(self.t(outcome.key()))
                                    .child(div().text_color(p.text_muted).child(count.to_string())),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(view) = this
                                    .pull_requests
                                    .iter_mut()
                                    .find(|view| view.state.reference == reference)
                                {
                                    view.check_groups_open[index] = !view.check_groups_open[index];
                                }
                                cx.notify();
                            })),
                    )
                    .content(rows),
            );
        }
        groups.into_any_element()
    }
}
