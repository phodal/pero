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
    pub fn workers_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let workers = self.remote.workers();
        let caption = pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption);
        let rows = workers.iter().enumerate().map(|(i, worker)| {
            let current = self
                .remote
                .tasks()
                .iter()
                .find(|task| string(task, "id") == string(worker, "current_task_id"));
            div()
                .id(("worker", i))
                .flex()
                .flex_col()
                .gap(px(6.))
                .px(px(14.))
                .py(px(10.))
                .border_t_1()
                .border_color(p.border)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(12.))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(string(worker, "name").to_string()),
                        )
                        .child(phase_tag(
                            p,
                            self.t(worker_status(worker)),
                            if worker["occupied"].as_bool() == Some(true) {
                                Tone::Info
                            } else {
                                Tone::Muted
                            },
                        )),
                )
                .child(
                    div()
                        .text_size(caption)
                        .text_color(p.text_muted)
                        .whitespace_normal()
                        .child(format!(
                            "{} · {}",
                            self.t("cloud.col.projects"),
                            joined(&worker["projects"], "、")
                        )),
                )
                .when(worker["occupied"].as_bool() == Some(true), |el| {
                    el.child(
                        div().text_size(caption).whitespace_normal().child(format!(
                            "{} · {}",
                            self.t("cloud.col.current"),
                            current
                                .map(|task| string(task, "title"))
                                .unwrap_or(self.t(worker_status(worker)))
                        )),
                    )
                })
        });
        div()
            .id("workers")
            .flex()
            .flex_col()
            .child(
                div()
                    .px(px(16.))
                    .pt(px(12.))
                    .flex()
                    .items_start()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .whitespace_normal()
                            .text_size(caption)
                            .text_color(p.text_muted)
                            .child(self.t("cloud.workers_hint")),
                    )
                    .child(
                        Button::new("workers-refresh")
                            .ghost()
                            .small()
                            .self_start()
                            .label(self.t("remote.refresh"))
                            .disabled(self.remote.loading())
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.command(json!({"action":"remote_refresh"}), cx)
                            })),
                    ),
            )
            .child(
                div()
                    .px(px(16.))
                    .pt(px(12.))
                    .pb(px(8.))
                    .child(self.local_execution_setup_view(false, cx)),
            )
            .when(workers.is_empty(), |el| {
                el.child(
                    div()
                        .px(px(16.))
                        .py(px(8.))
                        .text_size(caption)
                        .text_color(p.text_muted)
                        .child(self.t("cloud.no_workers")),
                )
            })
            .when(!workers.is_empty(), |el| el.child(div().children(rows)))
    }
}
