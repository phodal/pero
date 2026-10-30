use super::*;
use crate::cloud::Stage;

impl Workbench {
    pub(crate) fn progress(&self, phase: Phase, cx: &App) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let (current, stopped) = phase.stage();
        let at = Stage::ALL.iter().position(|s| *s == current).unwrap_or(0);
        let done_all = matches!(phase, Phase::Succeeded);
        div()
            .id("remote-progress")
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(4.))
            .role(Role::List)
            .aria_label(self.t("cloud.progress"))
            .children(Stage::ALL.iter().enumerate().map(move |(i, stage)| {
                let done = i < at;
                let now = i == at && !done_all;
                let (mark, ring, fill, text) = if done {
                    ("✓", "success", "success", "text")
                } else if now && stopped {
                    ("!", "error", "error", "error")
                } else if now {
                    ("", "action", "surface", "text")
                } else {
                    ("", "input-border", "surface", "text-muted")
                };
                let state = self.t(if done {
                    "cloud.step_done"
                } else if now && stopped {
                    "cloud.step_stopped"
                } else if now {
                    "cloud.step_current"
                } else {
                    "cloud.step_pending"
                });
                div()
                    .id(("remote-stage", i))
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .role(Role::ListItem)
                    .aria_label(format!("{} · {state}", self.t(stage.label_key())))
                    .when(i > 0, |el| {
                        el.child(div().w(px(16.)).h(px(1.)).bg(p.border))
                    })
                    .child(
                        div()
                            .size(px(18.))
                            .rounded_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .border_1()
                            .when(now && !stopped, |el| el.border_2())
                            .border_color(p.color(ring))
                            .bg(p.color(fill))
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                            .font_weight(FontWeight::BOLD)
                            .text_color(p.color(if done || stopped && now {
                                "surface"
                            } else {
                                "action"
                            }))
                            .child(if mark.is_empty() {
                                (i + 1).to_string()
                            } else {
                                mark.to_string()
                            }),
                    )
                    .child(
                        div()
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                            .when(now, |el| el.font_weight(FontWeight::SEMIBOLD))
                            .text_color(p.color(text))
                            .child(self.t(stage.label_key())),
                    )
            }))
    }

    pub(crate) fn execution_card(
        &self,
        task: &Value,
        run: &Value,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let id = string(task, "id").to_string();
        let phase = phase(task);
        let operator = self.remote.operator();
        let client = self.remote.client();
        let mine = self.remote.mine(task);
        let claimed = !string(&task["claimed_by"], "id").is_empty();
        let closed = source_closed(task);
        let changed = source_changed(task);
        let busy = self.remote.loading();
        let can_dispatch =
            dispatchable(task) && !closed && !changed && (operator || (client && mine));
        let can_cancel =
            matches!(phase, Phase::Queued | Phase::Running) && (operator || (client && mine));
        let confirming = self.remote.confirm_cancel.as_deref() == Some(id.as_str());
        let workers = self.worker_count();
        let worker = self.worker_name(string(run, "worker_id"));
        let (border, bg) = match phase.tone() {
            Tone::Info => ("info", "surface"),
            Tone::Warning => ("warning", "warning-bg"),
            Tone::Success => ("success", "success-bg"),
            Tone::Danger => ("error", "error-bg"),
            Tone::Muted => ("border", "surface"),
        };
        let title = match phase {
            Phase::Running => self.t("cloud.card.running").replace("{worker}", &worker),
            _ => self
                .t(match phase {
                    Phase::Draft => "cloud.card.draft",
                    Phase::Queued => "cloud.card.queued",
                    Phase::Stopping => "cloud.card.stopping",
                    Phase::Succeeded => "cloud.card.succeeded",
                    Phase::Failed => "cloud.card.failed",
                    Phase::Reconcile => "cloud.card.reconcile",
                    Phase::Cancelled => "cloud.card.cancelled",
                    _ => "cloud.card.source_closed",
                })
                .to_string(),
        };
        let body = match phase {
            Phase::Draft | Phase::Cancelled if workers == 0 => {
                Some((self.t("cloud.body.no_worker"), "warning"))
            }
            Phase::Draft | Phase::Cancelled => Some((self.t("cloud.body.ready"), "text-muted")),
            Phase::Queued if workers == 0 => Some((self.t("cloud.body.no_worker"), "warning")),
            Phase::Queued => Some((self.t("remote.waiting_worker"), "text")),
            Phase::Running => Some((self.t("cloud.body.running"), "text-muted")),
            Phase::Stopping => Some((self.t("remote.stopping"), "text")),
            Phase::Succeeded => Some((self.t("remote.execution_only"), "text")),
            Phase::Failed | Phase::Reconcile => Some((self.t("remote.failure_recovery"), "text")),
            Phase::SourceClosed => Some((
                self.t(if string(observed_source(task), "state") == "missing" {
                    "remote.source_missing"
                } else if string(observed_source(task), "kind") == "roadmap" {
                    "remote.roadmap_checked_help"
                } else {
                    "remote.issue_closed"
                }),
                "text",
            )),
        };
        let facts = [
            (
                self.t("cloud.fact.agent"),
                string(task, "agent_id").to_string(),
            ),
            (
                self.t("cloud.fact.project"),
                string(task, "project_id").to_string(),
            ),
            (
                self.t("cloud.fact.workspace"),
                string(task, "workspace_key").to_string(),
            ),
            (
                self.t("cloud.fact.lease"),
                if matches!(phase, Phase::Running | Phase::Stopping) {
                    local_time(string(run, "lease_expires_at"))
                } else {
                    String::new()
                },
            ),
        ];
        div()
            .id("remote-execution")
            .p(px(14.))
            .rounded(px(8.))
            .border_1()
            .border_color(p.color(border))
            .bg(p.color(bg))
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .when(matches!(phase, Phase::Running), |el| {
                        el.child(div().size(px(8.)).rounded_full().bg(p.info))
                    })
                    .child(
                        div()
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(title),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap_x(px(18.))
                    .gap_y(px(4.))
                    .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                    .children(
                        facts
                            .into_iter()
                            .filter(|(_, v)| !v.is_empty())
                            .map(|(k, v)| {
                                div()
                                    .flex()
                                    .gap(px(4.))
                                    .child(div().text_color(p.text_muted).child(k))
                                    .child(div().font_weight(FontWeight::SEMIBOLD).child(v))
                            }),
                    ),
            )
            .when_some(body, |el, (text, color)| {
                el.child(
                    div()
                        .whitespace_normal()
                        .text_color(p.color(color))
                        .child(text),
                )
            })
            .when(changed && !closed, |el| {
                el.child(
                    div()
                        .whitespace_normal()
                        .text_color(p.warning)
                        .child(self.t(if !string(task, "current_run_id").is_empty() {
                            "remote.source_changed_ran"
                        } else if claimed {
                            "remote.source_changed_claimed"
                        } else {
                            "remote.source_changed"
                        })),
                )
            })
            .when(!string(run, "summary").is_empty(), |el| {
                el.child(
                    div()
                        .p(px(10.))
                        .rounded(px(6.))
                        .bg(p.surface)
                        .border_1()
                        .border_color(p.border)
                        .whitespace_normal()
                        .child(string(run, "summary").to_string()),
                )
            })
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .when(
                        matches!(phase, Phase::Draft | Phase::Queued | Phase::Cancelled)
                            && (operator || (client && mine)),
                        |el| {
                            let project_id = string(task, "project_id").to_string();
                            let workspace_key = string(task, "workspace_key").to_string();
                            let agent_id = string(task, "agent_id").to_string();
                            let path = self
                                .project_catalog(cx)
                                .into_iter()
                                .find(|project| project.contains_task(&project_id))
                                .and_then(|project| project.workspace)
                                .unwrap_or_default();
                            el.child(
                                Button::new("task-local-execution")
                                    .outline()
                                    .small()
                                    .label(self.t(
                                        if self.local_execution.setup.configuration.is_none() {
                                            "worker.local.enable"
                                        } else {
                                            "worker.local.title"
                                        },
                                    ))
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.navigate(WorkbenchPage::Workers, cx);
                                        if this.local_execution.setup.configuration.is_none() {
                                            this.local_execution.project_id = project_id.clone();
                                            this.local_execution.agent_id = agent_id.clone();
                                            this.local_execution.path = path.clone();
                                            this.local_execution.workspace_key.update(
                                                cx,
                                                |input, cx| {
                                                    input.set_value(
                                                        workspace_key.clone(),
                                                        window,
                                                        cx,
                                                    )
                                                },
                                            );
                                            this.local_execution.editing = true;
                                        }
                                        cx.notify();
                                    })),
                            )
                        },
                    )
                    .when(client && !claimed, |el| {
                        el.child(
                            Button::new("remote-claim")
                                .outline()
                                .small()
                                .label(self.t("remote.claim"))
                                .disabled(!dispatchable(task) || closed || busy)
                                .on_click(cx.listener({
                                    let id = id.clone();
                                    move |this, _, _, cx| {
                                        this.remote.filter = 1;
                                        this.command(
                                            json!({"action":"remote_claim","task_id":id}),
                                            cx,
                                        );
                                    }
                                })),
                        )
                    })
                    .when(client && mine && dispatchable(task), |el| {
                        el.child(
                            Button::new("remote-release")
                                .ghost()
                                .small()
                                .label(self.t("remote.release"))
                                .disabled(busy)
                                .on_click(cx.listener({
                                    let id = id.clone();
                                    move |this, _, _, cx| {
                                        this.remote.filter = 0;
                                        this.command(
                                            json!({"action":"remote_release","task_id":id}),
                                            cx,
                                        );
                                    }
                                })),
                        )
                    })
                    .when(dispatchable(task) && !closed, |el| {
                        el.child(
                            Button::new("remote-dispatch")
                                .when(matches!(phase, Phase::Succeeded), |b| b.outline())
                                .when(!matches!(phase, Phase::Succeeded), |b| b.primary())
                                .small()
                                .label(self.t(if matches!(phase, Phase::Draft) {
                                    "cloud.delegate"
                                } else {
                                    "cloud.redelegate"
                                }))
                                .disabled(!can_dispatch || busy)
                                .on_click(cx.listener({
                                    let id = id.clone();
                                    move |this, _, _, cx| {
                                        this.command(
                                            json!({"action":"remote_dispatch","task_id":id}),
                                            cx,
                                        )
                                    }
                                })),
                        )
                    })
                    .when(can_cancel && !confirming, |el| {
                        el.child(
                            Button::new("remote-cancel")
                                .outline()
                                .small()
                                .label(self.t("remote.cancel"))
                                .disabled(busy)
                                .on_click(cx.listener({
                                    let id = id.clone();
                                    move |this, _, _, cx| {
                                        this.remote.confirm_cancel = Some(id.clone());
                                        cx.notify();
                                    }
                                })),
                        )
                    })
                    .when(confirming, |el| {
                        el.child(div().child(self.t("remote.confirm_stop")))
                            .child(
                                Button::new("remote-confirm-cancel")
                                    .danger()
                                    .small()
                                    .label(self.t("remote.confirm_cancel"))
                                    .on_click(cx.listener({
                                        let id = id.clone();
                                        move |this, _, _, cx| {
                                            this.remote.confirm_cancel = None;
                                            this.command(
                                                json!({"action":"remote_cancel","task_id":id}),
                                                cx,
                                            );
                                        }
                                    })),
                            )
                            .child(
                                Button::new("remote-keep-running")
                                    .ghost()
                                    .small()
                                    .label(self.t("remote.keep_running"))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.remote.confirm_cancel = None;
                                        cx.notify();
                                    })),
                            )
                    }),
            )
    }

    pub(crate) fn remote_detail(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let detail = &self.remote.data["detail"];
        let task = &detail["task"];
        let run = &detail["run"];
        let id = string(task, "id").to_string();
        let selected = match self.navigation.current() {
            Some(WorkspaceItem::Task(id)) => id.as_str(),
            _ => "",
        };
        let active = !id.is_empty()
            && id == selected
            && self.remote.data["selected_task_id"].as_str() == Some(selected);
        let events = detail["events"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let phase = phase(task);
        let source = observed_source(task);
        let github = matches!(string(source, "kind"), "github" | "roadmap");
        let claimed = !string(&task["claimed_by"], "id").is_empty();
        div()
            .id("remote-detail")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_x_hidden()
            .overflow_y_scroll()
            .whitespace_normal()
            .when(narrow, |el| {
                el.child(
                    div().flex().px(px(12.)).pt(px(10.)).child(
                        Button::new("remote-back")
                            .ghost()
                            .small()
                            .icon(Icon::default().path("icons/arrow-left.svg"))
                            .label(self.t("remote.back"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.remote.creating = false;
                                this.command(json!({"action":"remote_select","task_id":null}), cx);
                            })),
                    ),
                )
            })
            .when(!active, |el| {
                el.child(
                    div()
                        .p(px(pero_theme::WorkbenchStyle::PAGE))
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Body)).font_weight(FontWeight::SEMIBOLD).child(self.t(
                            if selected.is_empty() { "cloud.select_title" } else { "remote.loading" },
                        )))
                        .when(selected.is_empty(), |el| {
                            el.child(div().text_color(p.text_muted).child(self.t("cloud.select_hint")))
                        }),
                )
            })
            .when(active, |el| {
                el.child(
                    div()
                        .px(px(pero_theme::WorkbenchStyle::PAGE))
                        .pt(px(20.))
                        .pb(px(28.))
                        .flex()
                        .flex_col()
                        .gap(px(16.))
                        .max_w(px(920.))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(
                                    div()
                                        .flex()
                                        .flex_wrap()
                                        .items_center()
                                        .gap(px(8.))
                                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                        .text_color(p.text_muted)
                                        .child(string(task, "project_id").to_string())
                                        .when(github, |el| {
                                            el.child("·").child(
                                                Button::new("remote-open-source")
                                                    .ghost()
                                                    .xsmall()
                                                    .icon(Icon::default().path("icons/external-link.svg"))
                                                    .label(source_label(task))
                                                    .on_click(cx.listener({
                                                        let id = id.clone();
                                                        move |this, _, _, cx| {
                                                            this.command(json!({"action":"remote_open_source","task_id":id}), cx)
                                                        }
                                                    })),
                                            )
                                        })
                                        .when(claimed, |el| {
                                            el.child("·").child(format!(
                                                "{} {}",
                                                self.t("remote.claimed_by"),
                                                string(&task["claimed_by"], "name")
                                            ))
                                        }),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_start()
                                        .gap(px(10.))
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Heading))
                                                .font_weight(FontWeight::BOLD)
                                                .child(string(task, "title").to_string()),
                                        )
                                        .child(div().pt(px(6.)).child(phase_tag(p, self.t(phase.label_key()), phase.tone()))),
                                )
                                .when(!source_context(task).is_empty(), |el| {
                                    el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(source_context(task)))
                                }),
                        )
                        .child(self.progress(phase, cx))
                        .child(self.execution_card(task, run, cx))
                        .when(!string(task, "parent_task_id").is_empty() || !task_tags(task).is_empty(), |el| {
                            el.child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .gap(px(6.))
                                    .when(!string(task, "parent_task_id").is_empty(), |el| {
                                        el.child(
                                            Button::new("remote-parent")
                                                .ghost()
                                                .xsmall()
                                                .label(self.t("remote.parent_task"))
                                                .on_click(cx.listener({
                                                    let parent = string(task, "parent_task_id").to_string();
                                                    move |this, _, _, cx| {
                                                        this.command(json!({"action":"remote_select","task_id":parent}), cx)
                                                    }
                                                })),
                                        )
                                    })
                                    .children(task_tags(task).iter().filter_map(Value::as_str).enumerate().map(|(i, tag)| {
                                        Button::new(("remote-tag", i))
                                            .outline()
                                            .xsmall()
                                            .label(format!("#{tag}"))
                                            .on_click(cx.listener({
                                                let tag = tag.to_string();
                                                move |this, _, _, cx| {
                                                    let kind = string(&this.remote.data, "source_kind").to_string();
                                                    this.command(json!({"action":"remote_filter","source_kind":kind,"tag":tag}), cx)
                                                }
                                            }))
                                    })),
                            )
                        })
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(section_title(p, self.t("remote.prompt"), pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)))
                                .child(div().child(string(task, "prompt").to_string())),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(6.))
                                .child(section_title(p, self.t("remote.acceptance"), pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)))
                                .child(div().child(string(task, "acceptance").to_string())),
                        )
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(4.))
                                .pt(px(12.))
                                .border_t_1()
                                .border_color(p.border)
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .child(section_title(p, self.t("remote.events"), pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)))
                                        .child(div().flex_1())
                                        .when(!run.is_null(), |el| {
                                            el.child(
                                                Button::new("remote-technical")
                                                    .ghost()
                                                    .xsmall()
                                                    .label(self.t(if self.remote.technical { "cloud.hide_technical" } else { "cloud.show_technical" }))
                                                    .on_click(cx.listener(|this, _, _, cx| {
                                                        this.remote.technical = !this.remote.technical;
                                                        cx.notify();
                                                    })),
                                            )
                                        }),
                                )
                                .when(self.remote.technical && !run.is_null(), |el| {
                                    el.child(
                                        div()
                                            .p(px(8.))
                                            .rounded(px(6.))
                                            .bg(p.surface_muted)
                                            .font_family("JetBrains Mono")
                                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                            .text_color(p.text_muted)
                                            .child(format!(
                                                "run {} · worker {} · generation {}",
                                                string(run, "id"),
                                                string(run, "worker_id"),
                                                run["generation"].as_u64().unwrap_or(0)
                                            )),
                                    )
                                })
                                .when(detail["events_truncated"].as_bool().unwrap_or(false), |el| {
                                    el.child(
                                        div()
                                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                            .text_color(p.text_muted)
                                            .child(self.t("remote.recent_events"))
                                            .when_some(
                                                detail["events_first_seq"].as_u64().zip(detail["events_last_seq"].as_u64()),
                                                |el, (first, last)| el.child(format!(" · {first}–{last}")),
                                            ),
                                    )
                                })
                                .when(events.is_empty(), |el| {
                                    el.child(div().py(px(8.)).text_color(p.text_muted).child(self.t("remote.no_events")))
                                })
                                .children(events.iter().rev().map(|event| {
                                    let summary = remote_event_summary(event);
                                    let kind = string(event, "kind").to_string();
                                    div()
                                        .flex()
                                        .gap(px(12.))
                                        .py(px(8.))
                                        .border_b_1()
                                        .border_color(p.border)
                                        .child(
                                            div()
                                                .w(px(32.))
                                                .flex_shrink_0()
                                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                                .text_color(p.text_muted)
                                                .child(event["seq"].as_u64().map(|n| format!("#{n}")).unwrap_or_default()),
                                        )
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .flex()
                                                .flex_col()
                                                .gap(px(2.))
                                                .child(if summary.is_empty() { kind.clone() } else { summary })
                                                .when(self.remote.technical, |el| {
                                                    el.child(div().text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption)).text_color(p.text_muted).child(kind))
                                                }),
                                        )
                                })),
                        ),
                )
            })
    }
}
