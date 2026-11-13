use super::*;

pub(crate) fn worker_status(worker: &Value) -> &'static str {
    if worker["enabled"].as_bool() == Some(false) {
        return "cloud.worker.disabled";
    }
    if string(worker, "current_run_status") == "reconcile" {
        return "cloud.worker.attention";
    }
    match string(&worker["presence"], "state") {
        "offline" => "cloud.worker.offline",
        "online" if worker["occupied"].as_bool() == Some(true) => "cloud.worker.busy",
        "online" => "cloud.worker.idle",
        _ => "cloud.worker.unknown",
    }
}

fn compatible(worker: &Value, task: &Value) -> bool {
    if worker["enabled"].as_bool() == Some(false) {
        return false;
    }
    let Some(projects) = worker["projects"].as_array() else {
        return false;
    };
    if !projects
        .iter()
        .any(|id| id.as_str() == Some(string(task, "project_id")))
    {
        return false;
    }
    // Legacy workers do not advertise exact capabilities; Cloud still owns admission.
    let caps = worker["capabilities"]
        .as_array()
        .filter(|caps| !caps.is_empty());
    caps.is_none_or(|caps| {
        caps.iter().any(|cap| {
            ["project_id", "workspace_key", "agent_id"]
                .iter()
                .all(|key| string(cap, key) == string(task, key))
        })
    })
}

impl Workbench {
    pub(crate) fn remote_target_worker(&self, task: &Value) -> Option<String> {
        self.remote
            .target_worker
            .as_ref()
            .filter(|id| {
                self.remote
                    .workers()
                    .iter()
                    .any(|w| string(w, "id") == id.as_str() && compatible(w, task))
            })
            .cloned()
    }

    pub(crate) fn remote_target_picker(
        &self,
        task: Option<&Value>,
        busy: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let selected = self.remote.target_worker.clone();
        let unavailable = task
            .is_some_and(|task| selected.is_some() && self.remote_target_worker(task).is_none());
        let workers = self
            .remote
            .workers()
            .iter()
            .filter(|worker| task.is_none_or(|task| compatible(worker, task)))
            .collect::<Vec<_>>();
        div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .child(section_title(
                p,
                self.t("remote.target"),
                pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption),
            ))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(6.))
                    .child(
                        Button::new("remote-target-any")
                            .ghost()
                            .small()
                            .label(self.t("remote.target_any"))
                            .toggled(selected.is_none())
                            .disabled(busy)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.remote.target_worker = None;
                                cx.notify();
                            })),
                    )
                    .children(workers.iter().enumerate().map(|(index, worker)| {
                        let id = string(worker, "id").to_string();
                        let cap = worker["capabilities"]
                            .as_array()
                            .and_then(|caps| caps.first())
                            .cloned();
                        let form = task.is_none();
                        Button::new(("remote-target", index))
                            .ghost()
                            .small()
                            .label(format!(
                                "{} · {}",
                                string(worker, "name"),
                                self.t(worker_status(worker))
                            ))
                            .toggled(selected.as_deref() == Some(id.as_str()))
                            .disabled(busy || worker["enabled"].as_bool() == Some(false))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.remote.target_worker = Some(id.clone());
                                if form {
                                    if let Some(cap) = &cap {
                                        this.remote.project.update(cx, |input, cx| {
                                            input.set_value(
                                                string(cap, "project_id").to_string(),
                                                window,
                                                cx,
                                            )
                                        });
                                        this.remote.workspace.update(cx, |input, cx| {
                                            input.set_value(
                                                string(cap, "workspace_key").to_string(),
                                                window,
                                                cx,
                                            )
                                        });
                                        this.remote.agent =
                                            Some(string(cap, "agent_id").to_string());
                                    }
                                }
                                cx.notify();
                            }))
                    })),
            )
            .when(task.is_none(), |el| {
                let caps = selected
                    .as_ref()
                    .and_then(|id| {
                        self.remote
                            .workers()
                            .iter()
                            .find(|w| string(w, "id") == id.as_str())
                    })
                    .and_then(|w| w["capabilities"].as_array())
                    .cloned()
                    .unwrap_or_default();
                let project = self.remote.project.read(cx).value().to_string();
                let workspace = self.remote.workspace.read(cx).value().to_string();
                let agent = self.remote_agent(cx);
                el.child(div().flex().flex_wrap().gap(px(6.)).children(
                    caps.into_iter().enumerate().map(|(index, cap)| {
                        Button::new(("remote-capability", index))
                            .ghost()
                            .small()
                            .label(format!(
                                "{} / {} / {}",
                                string(&cap, "project_id"),
                                string(&cap, "workspace_key"),
                                string(&cap, "agent_id")
                            ))
                            .toggled(
                                project == string(&cap, "project_id")
                                    && workspace == string(&cap, "workspace_key")
                                    && agent == string(&cap, "agent_id"),
                            )
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.remote.project.update(cx, |input, cx| {
                                    input.set_value(
                                        string(&cap, "project_id").to_string(),
                                        window,
                                        cx,
                                    )
                                });
                                this.remote.workspace.update(cx, |input, cx| {
                                    input.set_value(
                                        string(&cap, "workspace_key").to_string(),
                                        window,
                                        cx,
                                    )
                                });
                                this.remote.agent = Some(string(&cap, "agent_id").to_string());
                                cx.notify();
                            }))
                    }),
                ))
            })
            .when(workers.is_empty(), |el| {
                el.child(
                    div()
                        .text_color(p.text_muted)
                        .child(self.t("remote.no_compatible_worker")),
                )
            })
            .when(unavailable, |el| {
                el.child(
                    div()
                        .text_color(p.warning)
                        .child(self.t("remote.target_unavailable")),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::compatible;
    use serde_json::json;

    #[test]
    fn target_compatibility() {
        let task = json!({"project_id":"team","workspace_key":"repo","agent_id":"fixture"});
        for (worker, expected) in [
            (json!({"projects":["team"]}), true),
            (json!({"projects":["team"],"enabled":false}), false),
            (json!({"projects":["other"]}), false),
            (
                json!({"projects":["team"],"capabilities":[task.clone()]}),
                true,
            ),
            (
                json!({"projects":["team"],"capabilities":[{"project_id":"team","workspace_key":"repo","agent_id":"other"}]}),
                false,
            ),
        ] {
            assert_eq!(compatible(&worker, &task), expected, "{worker}");
        }
    }
}
