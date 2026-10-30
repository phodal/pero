use super::*;

fn joined(value: &Value, separator: &str) -> String {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(separator)
        })
        .unwrap_or_default()
}

impl Workbench {
    /// Cloud reports Worker identity and scope but no heartbeat, so a row
    /// shows only whether a loaded Task is running there.
    pub fn workers_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let workers = self.remote.workers();
        let running = |worker: &str| {
            self.remote.tasks().iter().find(|t| {
                string(&t["run"], "worker_id") == worker
                    && matches!(phase(t), Phase::Running | Phase::Stopping)
            })
        };
        let caption = pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption);
        let header = div()
            .flex()
            .px(px(14.))
            .py(px(8.))
            .bg(p.surface_muted)
            .text_size(caption)
            .font_weight(FontWeight::SEMIBOLD)
            .text_color(p.text_muted)
            .child(div().w(px(240.)).child(self.t("cloud.col.worker")))
            .child(div().w(px(110.)).child(self.t("cloud.col.status")))
            .child(div().flex_1().child(self.t("cloud.col.projects")))
            .child(div().w(px(240.)).child(self.t("cloud.col.current")));
        let rows = workers.iter().enumerate().map(|(i, w)| {
            let current = running(string(w, "id"));
            div()
                .id(("worker", i))
                .flex()
                .items_center()
                .px(px(14.))
                .py(px(10.))
                .border_t_1()
                .border_color(p.border)
                .child(
                    div()
                        .w(px(240.))
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .truncate()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(string(w, "name").to_string()),
                        )
                        .child(
                            div()
                                .truncate()
                                .text_size(caption)
                                .text_color(p.text_muted)
                                .child(joined(&w["labels"], " · ")),
                        ),
                )
                .child(div().w(px(110.)).child(phase_tag(
                    p,
                    self.t(if current.is_some() {
                        "cloud.worker.busy"
                    } else {
                        "cloud.worker.idle"
                    }),
                    if current.is_some() {
                        Tone::Info
                    } else {
                        Tone::Muted
                    },
                )))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(joined(&w["projects"], "、")),
                )
                .child(
                    div()
                        .w(px(240.))
                        .min_w_0()
                        .truncate()
                        .text_color(p.color(if current.is_some() {
                            "text"
                        } else {
                            "text-muted"
                        }))
                        .child(
                            current
                                .map(|t| string(t, "title").to_string())
                                .unwrap_or_else(|| self.t("cloud.worker.none").to_string()),
                        ),
                )
        });
        div()
            .id("workers")
            .flex_1()
            .min_w_0()
            .h_full()
            .overflow_y_scroll()
            .px(px(pero_theme::WorkbenchStyle::PAGE))
            .py(px(12.))
            .child(
                div()
                    .max_w(px(1000.))
                    .flex()
                    .flex_col()
                    .gap(px(14.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_1()
                                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Heading))
                                    .font_weight(FontWeight::BOLD)
                                    .child(self.t("nav.workers")),
                            )
                            .child(
                                Button::new("workers-refresh")
                                    .ghost()
                                    .small()
                                    .label(self.t("remote.refresh"))
                                    .disabled(self.remote.loading())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.command(json!({"action":"remote_refresh"}), cx)
                                    })),
                            ),
                    )
                    .child(self.local_execution_setup_view(false, cx))
                    .child(
                        div()
                            .whitespace_normal()
                            .text_color(p.text_muted)
                            .child(self.t("cloud.workers_hint")),
                    )
                    .when(workers.is_empty(), |el| {
                        el.child(
                            div()
                                .py(px(12.))
                                .text_color(p.text_muted)
                                .child(self.t("cloud.no_workers")),
                        )
                    })
                    .when(!workers.is_empty(), |el| {
                        el.child(
                            div()
                                .rounded(px(8.))
                                .border_1()
                                .border_color(p.border)
                                .overflow_hidden()
                                .child(header)
                                .children(rows),
                        )
                    }),
            )
    }
}
