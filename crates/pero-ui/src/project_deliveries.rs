use crate::{app::Workbench, cloud::Phase, remote::string};
use gpui_kit::{
    component::{
        Disableable, Sizable,
        button::*,
        input::{Input, InputEvent, InputState},
        menu::{DropdownMenu, PopupMenuItem},
    },
    prelude::*,
    *,
};
use pero_contracts::HostEvent;
use serde_json::{Value, json};

const STAGES: [(&str, &str, &str); 3] = [
    ("analysis", "delivery.analysis", "analysis_run"),
    (
        "implementation",
        "delivery.implementation",
        "implementation_run",
    ),
    ("verification", "delivery.verification", "verification_run"),
];
const EVIDENCE: [(&str, &str); 4] = [
    ("proposal", "delivery.proposal"),
    ("candidate", "delivery.candidate"),
    ("approval", "delivery.approval"),
    ("report", "delivery.report"),
];

pub(crate) struct DeliveryState {
    project: String,
    records: Vec<Value>,
    choices: Vec<DeliveryRunChoice>,
    selected: String,
    detail: Value,
    evidence: Value,
    error: String,
    next_cursor: String,
    pending: Option<String>,
    request: Option<String>,
    runs: [Option<DeliveryRunChoice>; 3],
    title: Entity<InputState>,
    baseline: Entity<InputState>,
    _inputs: Vec<Subscription>,
}

#[derive(Clone)]
struct DeliveryRunChoice {
    label: String,
    worker: String,
    reference: Value,
}

impl DeliveryState {
    pub(crate) fn new(window: &mut Window, cx: &mut Context<Workbench>) -> Self {
        let title = cx.new(|cx| InputState::new(window, cx));
        let baseline = cx.new(|cx| InputState::new(window, cx));
        let inputs = [&title, &baseline]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();
        Self {
            project: String::new(),
            records: vec![],
            choices: vec![],
            selected: String::new(),
            detail: Value::Null,
            evidence: Value::Null,
            error: String::new(),
            next_cursor: String::new(),
            pending: None,
            request: None,
            runs: Default::default(),
            title,
            baseline,
            _inputs: inputs,
        }
    }

    fn select_project(&mut self, project: String) {
        if self.project == project {
            return;
        }
        self.project = project;
        self.records.clear();
        self.choices.clear();
        self.selected.clear();
        self.detail = Value::Null;
        self.evidence = Value::Null;
        self.error.clear();
        self.next_cursor.clear();
        self.pending = None;
        self.request = None;
        self.runs = Default::default();
    }
}

impl Workbench {
    pub(crate) fn reset_project_deliveries(&mut self) {
        self.deliveries.select_project(String::new());
    }

    pub(crate) fn fail_delivery_request(&mut self, request: &str) {
        if self.deliveries.pending.as_deref() == Some(request) {
            self.deliveries.pending = None;
            self.deliveries.error = self.t("error.connection").to_owned();
        }
    }

    fn send_delivery(&mut self, mut command: Value, cx: &mut Context<Self>) {
        let id = uuid::Uuid::new_v4().to_string();
        command["response_id"] = json!(id);
        self.deliveries.pending = Some(id);
        self.command(command, cx);
    }

    pub(crate) fn load_project_deliveries(&mut self, cx: &mut Context<Self>) {
        if !self.remote.client() {
            return;
        }
        let Some(project) = self
            .current_project(cx)
            .and_then(|project| project.shared_id)
        else {
            return;
        };
        self.deliveries.select_project(project.clone());
        self.send_delivery(
            json!({"action":"remote_delivery_list","project":project}),
            cx,
        );
    }

    pub(crate) fn receive_project_delivery(
        &mut self,
        event: &HostEvent,
        cx: &mut Context<Self>,
    ) -> bool {
        if event.kind != "project_delivery" {
            return false;
        }
        if self.deliveries.pending.is_none() || event.request_id != self.deliveries.pending {
            return true;
        }
        self.deliveries.pending = None;
        self.deliveries.error = string(&event.data, "error").to_owned();
        let value = &event.data["value"];
        if self.deliveries.error.is_empty() {
            match string(&event.data, "action") {
                "remote_delivery_list" => {
                    self.deliveries.records =
                        value["deliveries"].as_array().cloned().unwrap_or_default();
                    self.deliveries.next_cursor = string(value, "next_cursor").to_owned();
                    self.deliveries.choices = value["runs"].as_array().into_iter().flatten().map(|run| {
                        let title = string(run, "title");
                        let worker = string(run, "worker_name").to_owned();
                        let generation = run["generation"].as_i64().unwrap_or_default();
                        let id = string(run, "run_id");
                        let display_id = id.trim_start_matches("run_").chars().take(10).collect::<String>();
                        let label = if worker.is_empty() {
                            format!("{title} · #{generation} · {display_id}")
                        } else {
                            format!("{title} · {worker} · #{generation} · {display_id}")
                        };
                        DeliveryRunChoice {
                            label, worker,
                            reference: json!({"task_id":run["task_id"],"run_id":run["run_id"],"generation":run["generation"]}),
                        }
                    }).collect();
                    if !self.deliveries.selected.is_empty() {
                        self.open_delivery(self.deliveries.selected.clone(), cx);
                    }
                }
                "remote_delivery_more" => {
                    self.deliveries.next_cursor = string(value, "next_cursor").to_owned();
                    self.deliveries.records.extend(
                        value["deliveries"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .cloned(),
                    );
                }
                "remote_delivery_create" => {
                    self.deliveries.request = None;
                    let id = string(value, "id").to_owned();
                    if !self
                        .deliveries
                        .records
                        .iter()
                        .any(|record| string(record, "id") == id)
                    {
                        self.deliveries.records.insert(0, value.clone());
                    }
                    self.open_delivery(id, cx);
                }
                "remote_delivery_read" if string(value, "id") == self.deliveries.selected => {
                    self.deliveries.detail = value.clone();
                }
                "remote_delivery_evidence"
                    if string(&event.data, "id") == self.deliveries.selected =>
                {
                    self.deliveries.evidence = value.clone();
                }
                _ => {}
            }
        }
        cx.notify();
        true
    }

    fn open_delivery(&mut self, id: String, cx: &mut Context<Self>) {
        if self.deliveries.selected != id {
            self.deliveries.selected = id.clone();
            self.deliveries.detail = Value::Null;
            self.deliveries.evidence = Value::Null;
        }
        self.send_delivery(
            json!({"action":"remote_delivery_read","project":self.deliveries.project,"id":id}),
            cx,
        );
        cx.notify();
    }

    pub(crate) fn coding_delivery_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = pero_theme::UiAppearance::global(cx).palette.clone();
        let ready = self
            .current_project(cx)
            .and_then(|project| project.shared_id)
            .is_some_and(|project| project == self.deliveries.project && self.remote.client());
        div()
            .id("project-deliveries")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px(px(pero_theme::WorkbenchStyle::PAGE))
            .py(px(18.))
            .child(
                div()
                    .max_w(px(880.))
                    .flex()
                    .flex_col()
                    .gap(px(12.))
                    .when(!ready, |el| {
                        el.child(
                            div()
                                .text_color(palette.text_muted)
                                .child(self.t("delivery.connect")),
                        )
                    })
                    .when(ready, |el| {
                        el.child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(8.))
                                .child(
                                    Button::new("delivery-refresh")
                                        .ghost()
                                        .small()
                                        .label(self.t("remote.refresh"))
                                        .relative()
                                        .child(
                                            self.view_bounds
                                                .projects
                                                .probe("delivery:refresh".into()),
                                        )
                                        .disabled(self.deliveries.pending.is_some())
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.load_project_deliveries(cx)
                                        })),
                                )
                                .child(
                                    Button::new("delivery-create")
                                        .primary()
                                        .small()
                                        .label(self.t("delivery.link"))
                                        .disabled(self.deliveries.pending.is_some())
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.deliveries.request =
                                                Some(uuid::Uuid::new_v4().to_string());
                                            this.deliveries.runs = Default::default();
                                            this.deliveries.title.update(cx, |input, cx| {
                                                input.set_value("", window, cx)
                                            });
                                            this.deliveries.baseline.update(cx, |input, cx| {
                                                input.set_value("", window, cx)
                                            });
                                            this.deliveries.selected.clear();
                                            this.deliveries.detail = Value::Null;
                                            this.deliveries.evidence = Value::Null;
                                            cx.notify();
                                        })),
                                ),
                        )
                        .when(!self.deliveries.error.is_empty(), |el| {
                            el.child(
                                div()
                                    .text_color(palette.error)
                                    .child(self.deliveries.error.clone()),
                            )
                        })
                        .when(self.deliveries.pending.is_some(), |el| {
                            el.child(
                                div()
                                    .text_color(palette.text_muted)
                                    .child(self.t("remote.loading")),
                            )
                        })
                        .when(self.deliveries.request.is_some(), |el| {
                            el.child(self.delivery_form(cx))
                        })
                        .when(self.deliveries.request.is_none(), |el| {
                            el.when(
                                self.deliveries.records.is_empty()
                                    && self.deliveries.pending.is_none()
                                    && self.deliveries.error.is_empty(),
                                |el| {
                                    el.child(
                                        div()
                                            .relative()
                                            .child(
                                                self.view_bounds
                                                    .projects
                                                    .probe("delivery:empty".into()),
                                            )
                                            .text_color(palette.text_muted)
                                            .child(self.t("delivery.empty")),
                                    )
                                },
                            )
                            .child(div().flex().flex_col().children(
                                self.deliveries.records.iter().enumerate().map(
                                    |(index, record)| {
                                        let id = string(record, "id").to_owned();
                                        Button::new(("delivery-record", index))
                                            .ghost()
                                            .small()
                                            .justify_start()
                                            .label(string(record, "title").to_owned())
                                            .toggled(id == self.deliveries.selected)
                                            .disabled(self.deliveries.pending.is_some())
                                            .relative()
                                            .child(
                                                self.view_bounds
                                                    .projects
                                                    .probe(format!("delivery:record:{id}")),
                                            )
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.open_delivery(id.clone(), cx)
                                            }))
                                    },
                                ),
                            ))
                            .when(!self.deliveries.next_cursor.is_empty(), |el| {
                                el.child(Button::new("more-deliveries").ghost().small()
                                    .label(self.t("project.show_more")).disabled(self.deliveries.pending.is_some())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.send_delivery(json!({"action":"remote_delivery_more",
                                            "project":this.deliveries.project,"before":this.deliveries.next_cursor}), cx);
                                        cx.notify();
                                    })))
                            })
                            .when(self.deliveries.detail.is_object(), |el| {
                                el.child(self.delivery_detail(cx))
                            })
                        })
                    }),
            )
    }

    fn delivery_form(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let title = self.deliveries.title.read(cx).value().trim().to_owned();
        let base = self.deliveries.baseline.read(cx).value().trim().to_owned();
        let valid_base = matches!(base.len(), 40 | 64)
            && base
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c));
        let disabled = self.deliveries.pending.is_some()
            || title.is_empty()
            || !valid_base
            || self.deliveries.runs[0].is_none();
        let choices = &self.deliveries.choices;
        let workbench = cx.entity().downgrade();
        div().id("project-delivery-form").flex().flex_col().gap(px(10.)).p(px(12.))
            .border_1().border_color(p.border).rounded(px(8.))
            .child(div().child(self.t("remote.title")))
            .child(pero_theme::WorkbenchStyle::input(Input::new(&self.deliveries.title), cx).aria_label(self.t("remote.title")))
            .child(div().child(self.t("delivery.baseline")))
            .child(pero_theme::WorkbenchStyle::input(Input::new(&self.deliveries.baseline), cx).aria_label(self.t("delivery.baseline")))
            .when(choices.is_empty(), |el| el.child(div().text_color(p.text_muted).child(self.t("delivery.no_runs"))))
            .child(div().flex().flex_wrap().gap(px(8.)).children(STAGES.into_iter().enumerate().map(|(slot, (_, label, _))| {
                let choices = choices.to_vec();
                let workbench = workbench.clone();
                let current = self.deliveries.runs[slot].as_ref();
                let selected = current.map(|choice| choice.label.clone()).unwrap_or_else(|| self.t(label).to_owned());
                let clear = self.t("delivery.clear");
                let busy = self.deliveries.pending.is_some();
                Button::new(("delivery-stage-choice", slot)).outline().small()
                    .label(selected).accessibility_label(self.t(label))
                    .dropdown_caret(true).disabled(busy || choices.is_empty())
                    .dropdown_menu_with_anchor(Anchor::BottomLeft, move |mut menu, _, _| {
                        let target = workbench.clone();
                        menu = menu.min_w(px(220.)).item(PopupMenuItem::new(clear).on_click(move |_, _, cx| {
                            let _ = target.update(cx, |this, cx| {
                                this.deliveries.runs[slot] = None;
                                cx.notify();
                            });
                        }));
                        for choice in &choices {
                            let (choice, target) = (choice.clone(), workbench.clone());
                            menu = menu.item(PopupMenuItem::new(choice.label.clone()).on_click(move |_, _, cx| {
                                let _ = target.update(cx, |this, cx| {
                                    for run in &mut this.deliveries.runs {
                                        if run.as_ref().is_some_and(|run| run.reference == choice.reference) {
                                            *run = None;
                                        }
                                    }
                                    this.deliveries.runs[slot] = Some(choice.clone());
                                    cx.notify();
                                });
                            }));
                        }
                        menu
                    })
            })))
            .child(div().flex().gap(px(6.))
                .child(Button::new("save-delivery-link").primary().small().label(self.t("delivery.save"))
                    .disabled(disabled)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let Some(request) = this.deliveries.request.as_ref() else { return; };
                        let mut manifest = json!({"title":title,"base_sha":base});
                        for (index, (key, _, _)) in STAGES.iter().enumerate() {
                            if let Some(choice) = &this.deliveries.runs[index] {
                                manifest[*key] = choice.reference.clone();
                            }
                        }
                        this.send_delivery(json!({"action":"remote_delivery_create","project":this.deliveries.project,"request_id":request,"manifest":manifest}), cx);
                        cx.notify();
                    })))
                .child(Button::new("cancel-delivery-link").ghost().small().label(self.t("delivery.cancel"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.deliveries.request = None;
                        cx.notify();
                    }))))
    }

    fn delivery_detail(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let detail = &self.deliveries.detail;
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let base = string(detail, "base_sha").to_owned();
        div().id("project-delivery-detail").flex().flex_col().gap(px(7.)).p(px(12.))
            .border_1().border_color(p.border).rounded(px(8.))
            .child(div().flex().items_center().gap(px(4.)).text_color(p.text_muted)
                .child(self.t("delivery.baseline"))
                .child(Button::new("copy-delivery-baseline").ghost().xsmall()
                    .label(base.chars().take(12).collect::<String>())
                    .tooltip(self.t("pr.copy_sha"))
                    .accessibility_label(format!("{} {base}", self.t("pr.copy_sha")))
                    .on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(base.clone())))))
            .when(!string(detail, "campaign_id").is_empty(), |el| el.child(div().child(format!(
                "{} · {}", self.t("delivery.campaign"), string(detail,"campaign_id")
            ))))
            .children(STAGES.into_iter().flat_map(|(_, label, key)| {
                let first = [(key, label)];
                first.into_iter().chain((key == "analysis_run").then_some(("analysis_retry_run", "delivery.retry")))
            }).filter_map(|(key, label)| {
                let run = detail.get(key)?.as_object()?;
                let value = |name| run.get(name).and_then(Value::as_str).unwrap_or("");
                let worker = self.remote.workers().iter()
                    .find(|worker| string(worker, "id") == value("worker_id"))
                    .map(|worker| string(worker,"name"))
                    .or_else(|| self.deliveries.choices.iter().find(|choice| string(&choice.reference, "run_id") == value("run_id")).map(|choice| choice.worker.as_str()))
                    .unwrap_or_else(|| value("worker_id"));
                let phase = Phase::of(value("status"), false);
                let status = if run.get("reconciliation").is_some_and(Value::is_object) {
                    self.t("delivery.reconciled")
                } else {
                    self.t(phase.label_key())
                };
                let id = value("run_id").to_owned();
                let short_id = id.trim_start_matches("run_").chars().take(10).collect::<String>();
                let machine = [worker, value("agent_id")].into_iter().filter(|label| !label.is_empty()).collect::<Vec<_>>().join(" · ");
                Some(div().flex().flex_col().gap(px(3.)).pt(px(7.)).border_t_1().border_color(p.border)
                    .child(div().relative().font_weight(FontWeight::MEDIUM)
                        .child(self.view_bounds.projects.probe(format!("delivery:status:{id}:{}", value("status"))))
                        .child(format!("{} · {status}", self.t(label))))
                    .child(div().text_color(p.text_muted).child(machine))
                    .child(div().flex().items_center().gap(px(4.)).text_color(p.text_muted)
                        .child(format!("{} {}", self.t("delivery.generation"), run["generation"]))
                        .child(Button::new(format!("copy-delivery-run-{key}")).ghost().xsmall()
                            .label(short_id)
                            .relative()
                            .child(self.view_bounds.projects.probe(format!("delivery:run:{id}")))
                            .tooltip(self.t("delivery.copy_run"))
                            .accessibility_label(format!("{} {id}", self.t("delivery.copy_run")))
                            .on_click(move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(id.clone()))))))

            }))
            .when(EVIDENCE.iter().any(|(key, _)| detail[*key].is_object()), |el| el
                .child(div().flex().flex_wrap().gap(px(6.)).children(EVIDENCE.into_iter().enumerate().filter_map(|(index, (key,label))| {
                    if !detail[key].is_object() { return None; }
                    Some(Button::new(("delivery-evidence", index)).outline().small().label(self.t(label))
                        .disabled(self.deliveries.pending.is_some())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.deliveries.evidence = Value::Null;
                            this.send_delivery(json!({"action":"remote_delivery_evidence","project":this.deliveries.project,"id":this.deliveries.selected,"kind":key}), cx);
                            cx.notify();
                        })))
                }))))
            .when(self.deliveries.evidence.is_object(), |el| el.child(div().flex().flex_col().gap(px(6.)).p(px(9.))
                .bg(p.surface_muted).rounded(px(6.))
                .child(div().font_weight(FontWeight::SEMIBOLD).child(string(&self.deliveries.evidence,"path").to_owned()))
                .child(div().whitespace_normal().font_family("JetBrains Mono").child(string(&self.deliveries.evidence,"content").to_owned()))))
    }
}
