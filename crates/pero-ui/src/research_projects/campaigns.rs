use crate::{app::Workbench, projects::ProjectTab, workspace::WorkbenchPage};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::{HostEvent, project_source::SharedWebSourceTarget};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

#[derive(Default)]
pub(super) struct CampaignsView {
    target: Option<SharedWebSourceTarget>,
    inventory: Option<Vec<Summary>>,
    selected: Option<String>,
    detail: Option<Detail>,
    receipt: Option<Decision>,
    request: Option<(String, Request)>,
    poll: Option<Task<()>>,
    expanded: [bool; 2],
    error: Option<String>,
}

#[derive(Clone, Copy)]
enum Request {
    List,
    Read,
    Review(&'static str),
}

#[derive(Deserialize)]
struct Inventory {
    campaigns: Vec<Summary>,
}

#[derive(Deserialize)]
struct Summary {
    id: String,
    title: String,
}

#[derive(Deserialize, Serialize)]
struct Plan {
    id: String,
    project_id: String,
}

#[derive(Deserialize, Serialize)]
struct Detail {
    plan: Plan,
    phase: String,
    can_review: bool,
    trial_titles: Vec<String>,
    progress: Option<Progress>,
    result: Option<Progress>,
    decision: Option<Decision>,
}

#[derive(Deserialize, Serialize)]
struct Progress {
    outcome: Option<String>,
    trials: Vec<Trial>,
    #[serde(default)]
    evidence: Vec<Evidence>,
    review_gate: Option<Gate>,
}

#[derive(Deserialize, Serialize)]
struct Trial {
    status: String,
    run: Option<Run>,
}

#[derive(Deserialize, Serialize, PartialEq, Eq)]
struct Run {
    run_id: String,
    task_id: String,
    generation: u64,
}

#[derive(Deserialize, Serialize)]
struct Evidence {
    status: String,
    experiment: String,
    run: Run,
    digest: String,
    method_digest: String,
    environment_digest: Option<String>,
    checker_digest: String,
    result_digest: Option<String>,
    reason: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct Gate {
    id: String,
    plan_digest: String,
    evidence_digest: String,
    expires_at: String,
}

#[derive(Deserialize, Serialize)]
struct Decision {
    gate_id: String,
    choice: String,
    reviewer_id: String,
    decided_at: String,
    request_id: String,
}

impl Detail {
    fn progress(&self) -> Option<&Progress> {
        self.result.as_ref().or(self.progress.as_ref())
    }
    fn review_gate(&self) -> Option<&Gate> {
        if self.phase != "awaiting_review" || !self.can_review || self.decision.is_some() {
            return None;
        }
        let progress = self.progress()?;
        let gate = progress.review_gate.as_ref()?;
        progress
            .evidence
            .first()
            .filter(|e| e.status == "consistent" && e.digest == gate.evidence_digest)
            .map(|_| gate)
    }
}

impl Workbench {
    pub(crate) fn refresh_campaigns(&mut self, cx: &mut Context<Self>) {
        self.request_campaigns(Request::List, cx);
    }

    fn request_campaigns(&mut self, request: Request, cx: &mut Context<Self>) {
        let Some(target) = self.shared_web_source_target(cx) else {
            return;
        };
        let view = &mut self.research.campaigns;
        if view.target.as_ref() != Some(&target) {
            *view = CampaignsView {
                target: Some(target.clone()),
                ..Default::default()
            };
        }
        if view.request.is_some()
            && !matches!(
                (view.request.as_ref(), request),
                (Some((_, Request::Read)), Request::Review(_))
            )
        {
            return;
        }
        let payload = match request {
            Request::List => json!({"kind":"list","target":target}),
            Request::Read => {
                let Some(id) = view.selected.as_ref() else {
                    return;
                };
                json!({"kind":"read","target":target,"id":id})
            }
            Request::Review(choice) => {
                let Some(gate) = view.detail.as_ref().and_then(Detail::review_gate) else {
                    return;
                };
                if view.receipt.is_some() {
                    return;
                }
                json!({"kind":"review","target":target,"id":view.selected,"decision":{
                    "gate_id":gate.id,"plan_digest":gate.plan_digest,"evidence_digest":gate.evidence_digest,"choice":choice
                }})
            }
        };
        view.poll = None;
        self.next_request += 1;
        let id = format!("project-campaigns-{}", self.next_request);
        view.request = Some((id.clone(), request));
        self.command(
            json!({"method":"shared_project_campaigns","request_id":id,"request":payload}),
            cx,
        );
        cx.notify();
    }

    pub(crate) fn receive_campaigns(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind != "project_campaigns_result" {
            return false;
        }
        let target = self.shared_web_source_target(cx);
        let invalid = self.t("campaign.unavailable").to_string();
        let view = &mut self.research.campaigns;
        if target.is_none() || target != view.target {
            *view = Default::default();
            return true;
        }
        let Some((expected, request)) = &view.request else {
            return true;
        };
        if event.request_id.as_deref() != Some(expected) {
            return true;
        }
        let request = *request;
        view.request = None;
        if event.data["ok"] != true {
            view.error = Some(
                event.data["error"]
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or(invalid),
            );
            cx.notify();
            return true;
        }
        let value = event.data["value"].clone();
        view.error = None;
        match request {
            Request::List => match serde_json::from_value::<Inventory>(value) {
                Ok(Inventory { campaigns }) => {
                    if !campaigns
                        .iter()
                        .any(|item| Some(&item.id) == view.selected.as_ref())
                    {
                        view.selected = campaigns.first().map(|item| item.id.clone());
                        view.detail = None;
                        view.receipt = None;
                        view.expanded = [false; 2];
                    }
                    view.inventory = Some(campaigns);
                    self.request_campaigns(Request::Read, cx);
                }
                Err(_) => view.error = Some(invalid),
            },
            Request::Read => match serde_json::from_value::<Detail>(value) {
                Ok(detail)
                    if Some(&detail.plan.id) == view.selected.as_ref()
                        && Some(detail.plan.project_id.as_str())
                            == target.as_ref().map(|value| value.project_id.as_str()) =>
                {
                    let live = detail.result.is_none();
                    view.detail = Some(detail);
                    if live {
                        self.schedule_campaign_poll(cx);
                    }
                }
                _ => view.error = Some(invalid),
            },
            Request::Review(_) => match serde_json::from_value(value) {
                Ok(receipt) => {
                    view.receipt = Some(receipt);
                    self.request_campaigns(Request::Read, cx);
                }
                Err(_) => view.error = Some(invalid),
            },
        }
        cx.notify();
        true
    }

    fn schedule_campaign_poll(&mut self, cx: &mut Context<Self>) {
        if self.project_tab != ProjectTab::Campaigns
            || self.navigation.page() != WorkbenchPage::Tasks
        {
            return;
        }
        let timer = cx.background_executor().timer(Duration::from_secs(3));
        self.research.campaigns.poll = Some(cx.spawn(async move |this, cx| {
            timer.await;
            let _ = this.update(cx, |this, cx| {
                if this.project_tab == ProjectTab::Campaigns
                    && this.navigation.page() == WorkbenchPage::Tasks
                {
                    this.request_campaigns(Request::Read, cx);
                }
            });
        }));
    }

    pub(crate) fn campaign_snapshot(&self, cx: &App) -> Value {
        let view = &self.research.campaigns;
        if view.target.is_none() || view.target != self.shared_web_source_target(cx) {
            return Value::Null;
        }
        json!({"detail":view.detail,"receipt":view.receipt,"expanded":view.expanded,"error":view.error})
    }

    pub(crate) fn campaign_view(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        let theme = pero_theme::UiAppearance::global(cx);
        let p = &theme.palette.clone();
        let chrome = pero_theme::Chrome::from_app(cx);
        let view = &self.research.campaigns;
        let current = view.target.is_some() && view.target == self.shared_web_source_target(cx);
        let pending = current && view.request.is_some();
        let review_pending = current
            && matches!(
                view.request.as_ref(),
                Some((_, Request::List | Request::Review(_)))
            );
        let detail = view.detail.as_ref().filter(|_| current);
        let progress = detail.and_then(Detail::progress);
        let receipt = detail
            .and_then(|d| d.decision.as_ref())
            .or(view.receipt.as_ref().filter(|_| current));
        let phase = detail.and_then(|d| {
            progress
                .and_then(|r| r.outcome.as_deref())
                .or(Some(&d.phase))
        });
        let header = div()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(12.))
            .child(
                div()
                    .id("campaign-phase")
                    .role(Role::Status)
                    .text_size(chrome.text(pero_theme::TYPE_BODY))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(phase.map_or_else(
                        || self.t("campaign.title"),
                        |phase| self.campaign_status(phase),
                    )),
            )
            .child(
                Button::new("campaign-refresh")
                    .small()
                    .ghost()
                    .icon(Icon::default().path("icons/refresh.svg"))
                    .accessibility_label(self.t("remote.refresh"))
                    .tooltip(self.t("remote.refresh"))
                    .disabled(pending)
                    .on_click(cx.listener(|this, _, _, cx| this.refresh_campaigns(cx))),
            );
        let inventory = view.inventory.as_deref().filter(|_| current);
        div()
            .id("project-campaigns")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
            .flex()
            .flex_col()
            .gap(px(16.))
            .child(header)
            .when_some(view.error.as_ref().filter(|_| current), |el, error| {
                el.child(
                    div()
                        .id("campaign-error")
                        .role(Role::Alert)
                        .text_color(p.error)
                        .whitespace_normal()
                        .child(error.clone()),
                )
            })
            .when(pending && detail.is_none(), |el| {
                el.child(
                    div()
                        .id("campaign-loading")
                        .role(Role::Status)
                        .text_color(p.text_muted)
                        .child(self.t("campaign.loading")),
                )
            })
            .when(inventory.is_some_and(<[_]>::is_empty) && !pending, |el| {
                el.child(
                    div()
                        .text_color(p.text_muted)
                        .child(self.t("campaign.empty")),
                )
            })
            .when(!current && !pending, |el| {
                el.child(
                    div()
                        .text_color(p.text_muted)
                        .child(self.t("campaign.unavailable")),
                )
            })
            .when_some(inventory.filter(|items| items.len() > 1), |el, items| {
                el.child(div().flex().flex_wrap().gap(px(6.)).children(
                    items.iter().enumerate().map(|(i, item)| {
                        let id = item.id.clone();
                        Button::new(("campaign-item", i))
                            .small()
                            .ghost()
                            .label(item.title.clone())
                            .selected(view.selected.as_ref() == Some(&id))
                            .disabled(pending)
                            .tooltip(format!("{} · {}", item.title, item.id))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                let view = &mut this.research.campaigns;
                                view.selected = Some(id.clone());
                                view.detail = None;
                                view.receipt = None;
                                view.expanded = [false; 2];
                                this.request_campaigns(Request::Read, cx);
                            }))
                    }),
                ))
            })
            .when_some(detail, |el, detail| {
                el.child(
                    div()
                        .flex()
                        .when(!narrow, |row| row.items_start())
                        .when(narrow, |row| row.flex_col())
                        .gap(px(12.))
                        .children(detail.trial_titles.iter().take(2).enumerate().map(
                            |(i, title)| {
                                let trial = progress.and_then(|p| p.trials.get(i));
                                let evidence = trial.and_then(|t| t.run.as_ref()).and_then(|run| {
                                    progress?.evidence.iter().find(|e| &e.run == run)
                                });
                                self.round_card(
                                    i,
                                    title,
                                    trial,
                                    evidence,
                                    view.expanded[i],
                                    progress.is_some(),
                                    cx,
                                )
                            },
                        )),
                )
            })
            .when_some(receipt, |el, receipt| {
                el.child(
                    div()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(5.))
                        .p(px(14.))
                        .rounded_md()
                        .bg(p.surface_muted)
                        .child(
                            div()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(self.t("campaign.receipt")),
                        )
                        .child(div().child(self.t(if receipt.choice == "approve" {
                            "campaign.approved"
                        } else {
                            "campaign.rejected"
                        })))
                        .child(
                            div()
                                .text_color(p.text_muted)
                                .whitespace_normal()
                                .child(format!("{} · {}", receipt.reviewer_id, receipt.decided_at)),
                        )
                        .child(
                            div()
                                .text_color(p.text_muted)
                                .whitespace_normal()
                                .child(format!(
                                    "{} · {}",
                                    self.t("campaign.receipt_id"),
                                    receipt.request_id
                                )),
                        ),
                )
            })
            .when_some(
                detail.filter(|d| d.phase == "awaiting_review" && receipt.is_none()),
                |el, detail| {
                    el.child(
                        div()
                            .id("campaign-approval")
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(8.))
                            .p(px(14.))
                            .rounded_md()
                            .border_1()
                            .border_color(p.border)
                            .child(
                                div()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(self.t("campaign.decision")),
                            )
                            .when_some(detail.review_gate(), |panel, gate| {
                                panel
                                    .child(
                                        div()
                                            .whitespace_normal()
                                            .text_color(p.text_muted)
                                            .child(self.t("campaign.review_instruction")),
                                    )
                                    .child(div().text_color(p.text_muted).child(format!(
                                        "{}  {}",
                                        self.t("campaign.deadline"),
                                        gate.expires_at
                                    )))
                                    .child(
                                        div().flex().flex_wrap().gap(px(8.)).children(
                                            [
                                                ("approve", "campaign.approve"),
                                                ("reject", "campaign.reject"),
                                            ]
                                            .into_iter()
                                            .map(
                                                |(choice, key)| {
                                                    Button::new(key)
                                                        .label(self.t(key))
                                                        .when(choice == "approve", |button| {
                                                            button.primary()
                                                        })
                                                        .when(choice == "reject", |button| {
                                                            button.outline()
                                                        })
                                                        .disabled(review_pending)
                                                        .relative()
                                                        .child(
                                                            self.view_bounds.projects.probe(
                                                                format!("campaign:{choice}"),
                                                            ),
                                                        )
                                                        .on_click(cx.listener(
                                                            move |this, _, _, cx| {
                                                                this.request_campaigns(
                                                                    Request::Review(choice),
                                                                    cx,
                                                                )
                                                            },
                                                        ))
                                                },
                                            ),
                                        ),
                                    )
                            })
                            .when(detail.review_gate().is_none(), |panel| {
                                panel.child(
                                    div()
                                        .text_color(p.text_muted)
                                        .child(self.t("campaign.review_unavailable")),
                                )
                            }),
                    )
                },
            )
            .into_any_element()
    }

    fn round_card(
        &self,
        index: usize,
        title: &str,
        trial: Option<&Trial>,
        evidence: Option<&Evidence>,
        expanded: bool,
        observed: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(14.))
            .rounded_md()
            .border_1()
            .border_color(p.border)
            .child(div().text_color(p.text_muted).child(self.t(if index == 0 {
                "campaign.round_one"
            } else {
                "campaign.round_two"
            })))
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .whitespace_normal()
                    .child(title.to_owned()),
            )
            .child(div().child(format!(
                "{} · {}",
                self.t("campaign.execution"),
                self.campaign_status(
                    trial.map_or(if observed { "not_started" } else { "unknown" }, |trial| {
                        trial.status.as_str()
                    })
                )
            )))
            .child(
                div()
                    .text_color(if evidence.is_some_and(|e| e.status == "consistent") {
                        p.success
                    } else {
                        p.text_muted
                    })
                    .child(format!(
                        "{} · {}",
                        self.t("campaign.check"),
                        self.campaign_status(evidence.map_or("not_checked", |e| e.status.as_str()))
                    )),
            )
            .when_some(trial.and_then(|r| r.run.as_ref()), |el, run| {
                el.child(
                    div()
                        .text_color(p.text_muted)
                        .whitespace_normal()
                        .child(format!(
                            "{} · {} {}",
                            run.run_id,
                            self.t("campaign.generation"),
                            run.generation
                        )),
                )
            })
            .when_some(evidence, |el, evidence| {
                el.when_some(
                    evidence.reason.as_ref().filter(|reason| !reason.is_empty()),
                    |el, reason| {
                        el.child(
                            div()
                                .text_color(p.text_muted)
                                .whitespace_normal()
                                .child(reason.clone()),
                        )
                    },
                )
                .child(
                    Button::new(("campaign-evidence", index))
                        .small()
                        .ghost()
                        .label(self.t(if expanded {
                            "campaign.hide_evidence"
                        } else {
                            "campaign.show_evidence"
                        }))
                        .relative()
                        .child(
                            self.view_bounds
                                .projects
                                .probe(format!("campaign:evidence:{index}")),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.research.campaigns.expanded[index] = !expanded;
                            cx.notify();
                        })),
                )
                .when(expanded, |panel| {
                    panel.child(
                        div()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .p(px(8.))
                            .bg(p.surface_muted)
                            .rounded_md()
                            .children(
                                [
                                    ("campaign.method", Some(evidence.method_digest.as_str())),
                                    (
                                        "campaign.environment",
                                        evidence.environment_digest.as_deref(),
                                    ),
                                    ("campaign.checker", Some(evidence.checker_digest.as_str())),
                                    ("campaign.result_digest", evidence.result_digest.as_deref()),
                                    ("campaign.evidence_digest", Some(evidence.digest.as_str())),
                                    ("campaign.task_id", Some(evidence.run.task_id.as_str())),
                                ]
                                .into_iter()
                                .filter_map(|(label, value)| {
                                    Some(
                                        div()
                                            .min_w_0()
                                            .flex()
                                            .flex_col()
                                            .gap(px(3.))
                                            .child(
                                                div().text_color(p.text_muted).child(self.t(label)),
                                            )
                                            .child(
                                                div()
                                                    .text_size(px(11.))
                                                    .whitespace_normal()
                                                    .child(value?.to_owned()),
                                            ),
                                    )
                                }),
                            ),
                    )
                })
            })
            .into_any_element()
    }

    fn campaign_status(&self, name: &str) -> &'static str {
        self.t(match name {
            "awaiting_review" => "campaign.review",
            "execution_completed" => "campaign.completed",
            "succeeded" => "campaign.succeeded",
            "consistent" => "campaign.consistent",
            "failed" | "execution_failed" | "rejected" => "campaign.failed",
            "verification_failed" | "needs_review" => "campaign.check_failed",
            "not_started" => "campaign.not_started",
            "not_checked" => "campaign.not_checked",
            "unknown" => "campaign.unknown",
            "missing" => "campaign.missing",
            "cancelled" => "campaign.cancelled",
            "cancel_requested" | "cancelling" => "campaign.cancelling",
            "pending_reconciliation" | "reconcile" => "campaign.reconcile",
            "reconciled" => "campaign.reconciled",
            "review_expired" => "campaign.expired",
            "review_rejected" => "campaign.rejected",
            "skipped" => "campaign.skipped",
            "unavailable" => "campaign.unavailable",
            "queued" | "starting" | "dispatching" => "campaign.queued",
            "verifying" => "campaign.verifying",
            _ => "campaign.in_progress",
        })
    }
}
