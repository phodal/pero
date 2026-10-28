//! Cloud-owned tasks. The main-process adapter owns HTTP and credentials.
use crate::app::Workbench;
use gpui_kit::{
    component::{
        button::*,
        input::{Editor, EditorState, Input, InputEvent, InputState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::HostEvent;
use serde_json::{Value, json};

pub(crate) struct RemoteState {
    pub data: Value,
    pub connection: crate::remote_connection::ConnectionForm,
    seen_connection: bool,
    pub creating: bool,
    submitting: bool,
    pub title: Entity<InputState>,
    pub prompt: Entity<EditorState>,
    pub acceptance: Entity<EditorState>,
    pub project: Entity<InputState>,
    pub workspace: Entity<InputState>,
    agent: Option<String>,
    confirm_cancel: Option<String>,
    form_error: Option<&'static str>,
    filter: usize,
    _subscriptions: Vec<Subscription>,
}

impl RemoteState {
    pub fn new(window: &mut Window, cx: &mut Context<Workbench>) -> Self {
        let title = cx.new(|cx| InputState::new(window, cx));
        let prompt = cx.new(|cx| {
            EditorState::new(window, cx)
                .line_number(false)
                .soft_wrap(true)
        });
        let acceptance = cx.new(|cx| {
            EditorState::new(window, cx)
                .line_number(false)
                .soft_wrap(true)
        });
        let project = cx.new(|cx| InputState::new(window, cx).default_value("default"));
        let workspace = cx.new(|cx| InputState::new(window, cx).default_value("default"));
        let mut subscriptions = vec![];
        for input in [&title, &project, &workspace] {
            subscriptions.push(cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()));
        }
        for input in [&prompt, &acceptance] {
            subscriptions.push(cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()));
        }
        Self {
            connection: crate::remote_connection::ConnectionForm::new(window, cx),
            seen_connection: false,
            data: json!({"configured":false,"loading":false,"tasks":[],"workers":[],"detail":null}),
            creating: false,
            submitting: false,
            title,
            prompt,
            acceptance,
            project,
            workspace,
            agent: None,
            confirm_cancel: None,
            form_error: None,
            filter: 0,
            _subscriptions: subscriptions,
        }
    }
    fn loading(&self) -> bool {
        self.data["loading"].as_bool().unwrap_or(false)
    }
    fn configured(&self) -> bool {
        self.data["configured"].as_bool().unwrap_or(false)
    }
    fn tasks(&self) -> &[Value] {
        self.data["tasks"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    fn workers(&self) -> &[Value] {
        self.data["workers"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    fn operator(&self) -> bool {
        string(&self.data["identity"], "role") == "operator"
    }
    fn client(&self) -> bool {
        string(&self.data["identity"], "role") == "client"
    }
    fn mine(&self, task: &Value) -> bool {
        let principal = string(&self.data["identity"], "id");
        !principal.is_empty() && string(&task["claimed_by"], "id") == principal
    }
    fn repositories(&self) -> &[Value] {
        self.data["github"]["repositories"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    fn task_visible(&self, task: &Value) -> bool {
        if !self.client() {
            return true;
        }
        match self.filter {
            0 => {
                string(&task["claimed_by"], "id").is_empty()
                    && dispatchable(task)
                    && !source_closed(task)
            }
            1 => self.mine(task),
            _ => true,
        }
    }
    pub fn snapshot(&self, cx: &App) -> Value {
        json!({"state":self.data,"creating":self.creating,"confirm_cancel":self.confirm_cancel,
            "connection_editing":self.connection.editing,"connection_url":self.connection.url.read(cx).value().as_ref(),
            "connection_mode":self.connection.mode,
            "title":self.title.read(cx).value().as_ref(),"prompt":self.prompt.read(cx).value().as_ref(),
            "acceptance":self.acceptance.read(cx).value().as_ref(),
            "project":self.project.read(cx).value().as_ref(),"workspace":self.workspace.read(cx).value().as_ref(),
            "agent":self.agent,"form_error":self.form_error,"filter":self.filter})
    }
}

fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

fn observed_source(task: &Value) -> &Value {
    if task["latest_source"].is_object() {
        &task["latest_source"]
    } else {
        &task["source"]
    }
}
fn source_closed(task: &Value) -> bool {
    matches!(string(observed_source(task), "state"), "closed" | "missing")
}
fn source_changed(task: &Value) -> bool {
    let frozen = string(&task["source"], "revision");
    let latest = string(observed_source(task), "revision");
    !frozen.is_empty() && !latest.is_empty() && frozen != latest
}
fn source_label(task: &Value) -> String {
    let source = observed_source(task);
    match string(source, "kind") {
        "github" => format!(
            "{} #{}",
            string(source, "repository"),
            source["issue_number"].as_u64().unwrap_or(0)
        ),
        "roadmap" => format!("ROADMAP · L{}", source["line"].as_u64().unwrap_or(0)),
        _ => String::new(),
    }
}
fn source_context(task: &Value) -> String {
    observed_source(task)["headings"]
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(" / ")
        })
        .unwrap_or_default()
}
fn task_tags(task: &Value) -> &[Value] {
    observed_source(task)["tags"]
        .as_array()
        .or_else(|| task["tags"].as_array())
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
fn dispatchable(task: &Value) -> bool {
    matches!(
        string(task, "state"),
        "draft" | "succeeded" | "failed" | "cancelled"
    )
}

/// Display the observed event content without promoting Agent output to acceptance.
fn remote_event_summary(event: &Value) -> String {
    let data = &event["data"];
    for text in [
        string(event, "text"),
        string(data, "text"),
        string(&data["content"], "text"),
        string(data, "summary"),
    ] {
        if !text.is_empty() {
            return text.to_string();
        }
    }
    match (string(data, "title"), string(data, "status")) {
        ("", status) => status.to_string(),
        (title, "") => title.to_string(),
        (title, status) => format!("{title} · {status}"),
    }
}

impl Workbench {
    pub fn receive_remote(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "remote_open" {
            if event.text == "desktop_login" {
                self.navigation = 3;
                self.sync_follow(cx);
            } else {
                self.open_remote(cx);
            }
            return true;
        }
        if event.kind != "remote_state" {
            return false;
        }
        let was_authenticating = self.remote.data["connection"]["authenticating"].as_bool().unwrap_or(false);
        self.remote.data = event.data.clone();
        if was_authenticating && !self.remote.data["connection"]["authenticating"].as_bool().unwrap_or(false)
            && self.remote.configured() && self.remote.data["error"].is_null() && self.remote.data["identity"].is_object() {
            self.remote.connection.editing = false;
        }
        if !self.remote.seen_connection && self.remote.configured() {
            self.remote.seen_connection = true;
            self.navigation = 3;
            self.sync_follow(cx);
        }
        if !self.remote.loading() && self.remote.connection.submitting {
            self.remote.connection.submitting = false;
            if self.remote.data["error"].is_null()
                && self.remote.configured()
                && self.remote.data["identity"].is_object()
            {
                self.remote.connection.editing = false;
            }
        }
        if !self.remote.loading() && self.remote.submitting {
            self.remote.submitting = false;
            if self.remote.data["error"].is_null() {
                self.remote.creating = false;
            }
        }
        let selected = self.remote.data["selected_task_id"].as_str();
        if self
            .remote
            .confirm_cancel
            .as_deref()
            .is_some_and(|id| Some(id) != selected)
        {
            self.remote.confirm_cancel = None;
        }
        cx.notify();
        true
    }
    pub fn open_remote(&mut self, cx: &mut Context<Self>) {
        self.navigation = 3;
        self.sync_follow(cx);
        self.command(json!({"action":"remote_refresh"}), cx);
    }
    fn remote_agent(&self) -> String {
        self.remote
            .agent
            .clone()
            .or_else(|| self.agents.get(self.agent_index).map(|a| a.id.clone()))
            .unwrap_or_else(|| "codex".into())
    }
    fn create_remote(&mut self, cx: &mut Context<Self>) {
        if !self.remote.configured()
            || !self.remote.operator()
            || self.remote.loading()
            || self.remote.submitting
        {
            return;
        }
        let title = self.remote.title.read(cx).value().trim().to_string();
        let prompt = self.remote.prompt.read(cx).value().trim().to_string();
        let acceptance = self.remote.acceptance.read(cx).value().trim().to_string();
        let project = self.remote.project.read(cx).value().trim().to_string();
        let workspace = self.remote.workspace.read(cx).value().trim().to_string();
        if title.is_empty()
            || prompt.is_empty()
            || acceptance.is_empty()
            || project.is_empty()
            || workspace.is_empty()
        {
            self.remote.form_error = Some("remote.required");
            cx.notify();
            return;
        }
        if title.chars().count() > 200
            || prompt.chars().count() > 64000
            || acceptance.chars().count() > 16000
            || project.len() > 128
            || workspace.len() > 128
        {
            self.remote.form_error = Some("remote.too_long");
            cx.notify();
            return;
        }
        self.remote.form_error = None;
        self.remote.submitting = true;
        self.command(
            json!({"action":"remote_create","title":title,"prompt":prompt,"acceptance":acceptance,
            "project_id":project,"workspace_key":workspace,"agent_id":self.remote_agent()}),
            cx,
        );
    }
    fn remote_status(&self, state: &str) -> String {
        let key = match state {
            "draft" => "remote.state.draft",
            "queued" => "remote.state.queued",
            "running" => "remote.state.running",
            "cancel_requested" => "remote.state.cancelling",
            "cancelled" => "remote.state.cancelled",
            "succeeded" => "remote.state.succeeded",
            "failed" => "remote.state.failed",
            "reconcile" => "remote.state.needs_attention",
            _ => return state.to_string(),
        };
        self.t(key).to_string()
    }
    fn remote_task_status(&self, task: &Value) -> String {
        if string(task, "current_run_id").is_empty() {
            let source = observed_source(task);
            if string(source, "state") == "missing" {
                return self.t("remote.source_missing").to_string();
            }
            if string(source, "kind") == "roadmap" && string(source, "state") == "closed" {
                return self.t("remote.roadmap_checked").to_string();
            }
        }
        self.remote_status(string(task, "state"))
    }
    pub fn remote_view(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
        let selected = self.remote.data["selected_task_id"].as_str().unwrap_or("");
        let detail_visible = self.remote.creating || !selected.is_empty();
        let loading = self.remote.loading();
        let configured = self.remote.configured();
        div().flex_1().min_w_0().h_full().flex().flex_col()
            .child(div().px(px(20.)).h(px(58.)).flex_shrink_0().flex().items_center().gap(px(10.)).border_b_1().border_color(p.color("border"))
                .child(div().flex_1().min_w_0().text_size(px(20.)).font_weight(FontWeight::BOLD).child(self.t("nav.tasks")))
                .child(Button::new("remote-connector").outline().small().label(self.t("connector.title")).disabled(loading)
                    .on_click(cx.listener(|this,_,window,cx|this.open_remote_connection(window,cx))))
                .when(self.remote.operator() && self.remote.data["github"]["configured"].as_bool().unwrap_or(false),|el|el.child(
                    Button::new("remote-sync").outline().small().label(self.t(if self.remote.data["github"]["running"].as_bool().unwrap_or(false){"remote.syncing_issues"}else{"remote.sync_issues"})).disabled(loading||self.remote.data["github"]["running"].as_bool().unwrap_or(false))
                        .on_click(cx.listener(|this,_,_,cx|this.command(json!({"action":"remote_sync_issues"}),cx)))))
                .child(Button::new("remote-refresh").outline().small().label(self.t(if loading{"remote.refreshing"}else{"remote.refresh"}))
                    .disabled(loading).on_click(cx.listener(|this,_,_,cx|this.command(json!({"action":"remote_refresh"}),cx))))
                .when(self.remote.operator(),|el|el.child(Button::new("remote-new").primary().small().label(self.t("remote.new")).disabled(!configured||loading)
                    .on_click(cx.listener(|this,_,window,cx|{
                        this.remote.title.update(cx, |input,cx| input.set_value("",window,cx));
                        this.remote.prompt.update(cx, |input,cx| input.set_value("",window,cx));
                        this.remote.acceptance.update(cx, |input,cx| input.set_value("",window,cx));
                        this.remote.creating=true;
                        this.remote.submitting=false;
                        this.remote.form_error=None;
                        this.remote.confirm_cancel=None;
                        let focus=this.remote.title.focus_handle(cx);window.focus(&focus, cx);cx.notify();})))))
            .when(self.remote.data["error"].is_string(),|el|el.child(div().id("remote-error").role(Role::Alert)
                .aria_label(string(&self.remote.data,"error").to_string())
                .w_full().min_w_0().whitespace_normal().px(px(20.)).py(px(10.)).border_b_1().border_color(p.color("border"))
                .text_color(p.color("error")).child(string(&self.remote.data,"error").to_string())))
            .when(self.remote.operator() && !self.remote.data["error"].is_string() && (
                self.remote.data["github"]["errors"].as_array().is_some_and(|errors|!errors.is_empty()) ||
                self.remote.repositories().iter().any(|repo|repo["partial"].as_bool().unwrap_or(false)||!string(repo,"error").is_empty())),|el|el.child(
                    div().id("remote-source-error").role(Role::Alert).aria_label(self.t("remote.sync_incomplete"))
                        .w_full().min_w_0().whitespace_normal().px(px(20.)).py(px(10.)).border_b_1().border_color(p.color("border"))
                        .text_color(p.color("warning")).child(self.t("remote.sync_incomplete"))))
            .when(!configured||self.remote.connection.editing,|el|el.child(self.remote_connection_view(cx)))
            .when(configured&&!self.remote.connection.editing,|el|el
                .child(div().flex_1().min_h_0().flex()
                    .when(!narrow||!detail_visible,|el|el.child(self.remote_list(narrow,cx)))
                    .when(!narrow||detail_visible,|el|el.child(div().flex_1().min_w_0().flex().flex_col()
                        .when(narrow&&detail_visible,|el|el.child(Button::new("remote-back").ghost().small().label(self.t("remote.back"))
                            .on_click(cx.listener(|this,_,_,cx|{this.remote.creating=false;this.remote.data["selected_task_id"]=Value::Null;
                                this.command(json!({"action":"remote_select","task_id":null}),cx);}))))
                        .when(self.remote.creating,|el|el.child(self.remote_form(cx)))
                        .when(!self.remote.creating,|el|el.child(self.remote_detail(cx)))))))
    }
    fn remote_list(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
        let selected = self.remote.data["selected_task_id"].as_str().unwrap_or("");
        let visible_tasks = self
            .remote
            .tasks()
            .iter()
            .filter(|task| self.remote.task_visible(task))
            .collect::<Vec<_>>();
        let grouped = string(&self.remote.data, "source_kind") == "roadmap";
        div()
            .id("remote-list")
            .h_full()
            .min_h_0()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .when(narrow, |el| el.flex_1())
            .when(!narrow, |el| {
                el.w(px(280.)).border_r_1().border_color(p.color("border"))
            })
            .child(
                div()
                    .px(px(16.))
                    .py(px(12.))
                    .text_color(p.color("text-muted"))
                    .child(format!(
                        "{} {} · {} {}",
                        self.remote
                            .tasks()
                            .iter()
                            .filter(|task| self.remote.task_visible(task))
                            .count(),
                        self.t("remote.tasks"),
                        self.remote.workers().len(),
                        self.t("remote.workers")
                    )),
            )
            .when(self.remote.client(), |el| {
                el.child(
                    div().px(px(8.)).pb(px(8.)).flex().gap(px(4.)).children(
                        ["remote.available", "remote.mine", "filter.all"]
                            .into_iter()
                            .enumerate()
                            .map(|(i, key)| {
                                Button::new(("remote-filter", i))
                                    .ghost()
                                    .small()
                                    .label(self.t(key))
                                    .toggled(self.remote.filter == i)
                                    .bg(p.color(if self.remote.filter == i {
                                        "accent-soft"
                                    } else {
                                        "surface"
                                    }))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.remote.filter = i;
                                        cx.notify();
                                    }))
                            }),
                    ),
                )
            })
            .when(self.remote.data["github"]["configured"].as_bool().unwrap_or(false),|el|el.child(
                div().px(px(16.)).pb(px(6.)).text_size(px(12.)).text_color(p.color("text-muted")).whitespace_normal()
                    .children(self.remote.repositories().iter().map(|repo|div().child(format!("{}/{}",string(repo,"owner"),string(repo,"repo")))))))
            .when(!self.remote.repositories().is_empty(),|el|el.child(
                div().px(px(8.)).pb(px(8.)).flex().gap(px(4.)).children(
                    [("","filter.all"),("github","remote.issues"),("roadmap","remote.roadmap")].into_iter().enumerate().map(|(i,(kind,key))|
                        Button::new(("remote-source-filter",i)).ghost().small().label(self.t(key)).disabled(self.remote.loading())
                            .toggled(string(&self.remote.data,"source_kind")==kind)
                            .bg(p.color(if string(&self.remote.data,"source_kind")==kind{"accent-soft"}else{"surface"}))
                            .on_click(cx.listener(move|this,_,_,cx|this.command(json!({"action":"remote_filter","source_kind":kind,"tag":""}),cx)))))))
            .when(!string(&self.remote.data,"tag").is_empty(),|el|el.child(
                div().px(px(16.)).pb(px(8.)).child(Button::new("remote-clear-tag").outline().small()
                    .label(format!("#{} ×",string(&self.remote.data,"tag"))).accessibility_label(self.t("remote.clear_tag"))
                    .on_click(cx.listener(|this,_,_,cx|this.command(json!({"action":"remote_filter","source_kind":string(&this.remote.data,"source_kind"),"tag":""}),cx))))))
            .when(
                self.remote.client() && self.remote.data["has_more"].as_bool().unwrap_or(false),
                |el| {
                    el.child(
                        div()
                            .px(px(16.))
                            .pb(px(8.))
                            .text_size(px(12.))
                            .text_color(p.color("text-muted"))
                            .child(self.t("remote.loaded_only")),
                    )
                },
            )
            .child(
                div()
                    .id("remote-task-scroll")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .px(px(8.))
                    .when(
                        !self
                            .remote
                            .tasks()
                            .iter()
                            .any(|task| self.remote.task_visible(task)),
                        |el| {
                            el.child(div().p(px(12.)).text_color(p.color("text-muted")).child(
                                self.t(if self.remote.loading() {
                                    "remote.loading"
                                } else if self.remote.client() {
                                    "remote.no_matching_tasks"
                                } else {
                                    "remote.empty"
                                }),
                            ))
                        },
                    )
                    .children(
                        visible_tasks.iter().enumerate()
                            .map(|(i, task)| {
                                let id = string(task, "id").to_string();
                                let title = string(task, "title").to_string();
                                let status = self.remote_task_status(task);
                                let source = observed_source(task);
                                let source_label = source_label(task);
                                let context = source_context(task);
                                let group_start=grouped && (i==0 || source_context(visible_tasks[i-1])!=context || string(observed_source(visible_tasks[i-1]),"repository")!=string(source,"repository") || string(observed_source(visible_tasks[i-1]),"path")!=string(source,"path"));
                                let claimed = if self.remote.mine(task) {
                                    self.t("remote.mine").to_string()
                                } else {
                                    string(&task["claimed_by"], "name").to_string()
                                };
                                let metadata = [status, source_label, claimed]
                                    .into_iter()
                                    .filter(|text| !text.is_empty())
                                    .collect::<Vec<_>>()
                                    .join(" · ");
                                let chosen = id == selected && !self.remote.creating;
                                let depth=source["depth"].as_u64().unwrap_or(0).min(4);
                                let tags=task_tags(task).iter().filter_map(Value::as_str).take(3).map(|tag|format!("#{tag}")).filter(|tag|!title.contains(tag)).collect::<Vec<_>>().join(" ");
                                let secondary=[if grouped {String::new()}else{context.clone()},tags].into_iter().filter(|text|!text.is_empty()).collect::<Vec<_>>().join(" · ");
                                let label=if secondary.is_empty(){format!("{title}\n{metadata}")}else{format!("{title}\n{metadata}\n{secondary}")};
                                div().w_full().min_w_0().when(group_start,|el|el.child(div().px(px(8.)).pt(px(10.)).pb(px(4.)).text_size(px(12.)).font_weight(FontWeight::BOLD).text_color(p.color("text-muted")).whitespace_normal()
                                    .child(if context.is_empty(){string(source,"path").to_string()}else{context})))
                                .child(div().w_full().min_w_0().py(px(4.)).pl(px(depth as f32*10.)).child(
                                    Button::new(("remote-task", i))
                                        .ghost()
                                        .w_full()
                                        .h(px(if secondary.is_empty(){68.}else{88.}))
                                        .bg(p.color(if chosen { "accent-soft" } else { "surface" }))
                                        .accessibility_label(label)
                                        .toggled(chosen)
                                        .child(div().w_full().min_w_0().flex().flex_col().items_start().gap(px(2.)).overflow_hidden()
                                            .child(div().w_full().truncate().child(title))
                                            .child(div().w_full().truncate().text_size(px(12.)).text_color(p.color("text-muted")).child(metadata))
                                            .when(!secondary.is_empty(),|el|el.child(div().w_full().truncate().text_size(px(12.)).text_color(p.color("text-muted")).child(secondary))))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.remote.creating = false;
                                            this.remote.confirm_cancel = None;
                                            this.remote.data["selected_task_id"] = json!(id);
                                            this.command(
                                                json!({"action":"remote_select","task_id":id}),
                                                cx,
                                            );
                                        })),
                                ))
                            }),
                    ),
            )
            .when(
                self.remote.data["has_more"].as_bool().unwrap_or(false),
                |el| {
                    el.child(
                        div()
                            .p(px(8.))
                            .border_t_1()
                            .border_color(p.color("border"))
                            .child(
                                Button::new("remote-more")
                                    .outline()
                                    .small()
                                    .w_full()
                                    .label(self.t("remote.more"))
                                    .disabled(self.remote.loading())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.command(json!({"action":"remote_more"}), cx);
                                    })),
                            ),
                    )
                },
            )
    }
    fn remote_form(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
        let busy = self.remote.loading() || self.remote.submitting;
        let agent = self.remote_agent();
        div()
            .id("remote-form")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(20.))
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(
                div()
                    .text_size(px(18.))
                    .font_weight(FontWeight::BOLD)
                    .child(self.t("remote.new")),
            )
            .child(self.t("remote.title"))
            .child(
                Input::new(&self.remote.title)
                    .aria_label(self.t("remote.title"))
                    .accessibility_id("remote.title")
                    .disabled(busy),
            )
            .child(self.t("remote.prompt"))
            .child(
                Editor::new(&self.remote.prompt)
                    .h(px(132.))
                    .aria_label(self.t("remote.prompt"))
                    .disabled(busy),
            )
            .child(self.t("remote.acceptance"))
            .child(
                Editor::new(&self.remote.acceptance)
                    .h(px(88.))
                    .aria_label(self.t("remote.acceptance"))
                    .disabled(busy),
            )
            .child(
                div()
                    .flex()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(self.t("remote.project"))
                            .child(
                                Input::new(&self.remote.project)
                                    .aria_label(self.t("remote.project"))
                                    .disabled(busy),
                            ),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(self.t("remote.workspace"))
                            .child(
                                Input::new(&self.remote.workspace)
                                    .aria_label(self.t("remote.workspace"))
                                    .disabled(busy),
                            ),
                    ),
            )
            .child(div().mt(px(4.)).child(self.t("remote.agent")))
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .gap(px(6.))
                    .when(self.agents.is_empty(), |el| el.child(agent.clone()))
                    .children(self.agents.iter().enumerate().map(|(i, a)| {
                        let id = a.id.clone();
                        Button::new(("remote-agent", i))
                            .outline()
                            .small()
                            .label(a.name.clone())
                            .bg(p.color(if agent == a.id {
                                "accent-soft"
                            } else {
                                "surface"
                            }))
                            .disabled(busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.remote.agent = Some(id.clone());
                                cx.notify();
                            }))
                    })),
            )
            .when(self.remote.form_error.is_some(), |el| {
                el.child(
                    div()
                        .id("remote-form-error")
                        .role(Role::Alert)
                        .aria_label(self.t(self.remote.form_error.unwrap()))
                        .whitespace_normal()
                        .text_color(p.color("error"))
                        .child(self.t(self.remote.form_error.unwrap())),
                )
            })
            .child(
                div()
                    .mt(px(8.))
                    .flex()
                    .items_center()
                    .gap(px(10.))
                    .child(
                        Button::new("remote-create")
                            .primary()
                            .label(self.t(if busy {
                                "remote.creating"
                            } else {
                                "remote.create"
                            }))
                            .disabled(busy)
                            .on_click(cx.listener(|this, _, _, cx| this.create_remote(cx))),
                    )
                    .child(
                        Button::new("remote-discard")
                            .ghost()
                            .label(self.t("remote.close_form"))
                            .disabled(busy)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.remote.creating = false;
                                cx.notify();
                            })),
                    ),
            )
            .child(
                div()
                    .text_size(px(12.))
                    .text_color(p.color("text-muted"))
                    .child(self.t("remote.draft_hint")),
            )
    }
    fn remote_detail(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
        let detail = &self.remote.data["detail"];
        let task = &detail["task"];
        let id = string(task, "id").to_string();
        let selected = self.remote.data["selected_task_id"].as_str().unwrap_or("");
        let active = !id.is_empty() && id == selected;
        let state = string(task, "state");
        let run = &detail["run"];
        let operator = self.remote.operator();
        let client = self.remote.client();
        let mine = self.remote.mine(task);
        let claimed = !string(&task["claimed_by"], "id").is_empty();
        let closed = source_closed(task);
        let idle = dispatchable(task);
        let can_dispatch =
            idle && !closed && !source_changed(task) && (operator || (client && mine));
        let can_cancel = matches!(state, "queued" | "running") && (operator || (client && mine));
        let source = observed_source(task);
        let github = matches!(string(source, "kind"), "github" | "roadmap");
        let roadmap = string(source, "kind") == "roadmap";
        let repository = string(source, "repository");
        let policy = self.remote.repositories().iter().find(|repo| {
            format!("{}/{}", string(repo, "owner"), string(repo, "repo")) == repository
        });
        let events = detail["events"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let confirming = self.remote.confirm_cancel.as_deref() == Some(id.as_str());
        let busy = self.remote.loading();
        div().id("remote-detail").flex_1().min_w_0().min_h_0().overflow_x_hidden().overflow_y_scroll().whitespace_normal().p(px(20.))
            .when(!active,|el|el.child(div().py(px(24.)).text_color(p.color("text-muted"))
                .child(self.t(if selected.is_empty(){"remote.select"}else{"remote.loading"}))))
            .when(!active&&!self.remote.repositories().is_empty(),|el|el.child(div().mt(px(16.)).flex().flex_col().gap(px(10.))
                .child(div().font_weight(FontWeight::BOLD).child(self.t("remote.issue_sources")))
                .children(self.remote.repositories().iter().map(|repo|div().whitespace_normal()
                    .child(format!("{}/{} · {}",string(repo,"owner"),string(repo,"repo"),self.t(if repo["auto_dispatch"].as_bool().unwrap_or(false){"remote.auto_enabled"}else{"remote.manual_dispatch"})))
                    .when(!string(repo,"required_label").is_empty(),|el|el.child(format!(" · {}",string(repo,"required_label"))))
                    .when(!string(repo,"error").is_empty(),|el|el.child(div().text_color(p.color("warning")).child(string(repo,"error").to_string())))))))
            .when(client && !string(&self.remote.data["identity"],"name").is_empty(),|el|el.child(div().mb(px(10.)).text_size(px(12.)).text_color(p.color("text-muted"))
                .child(format!("{} · {}",self.t("remote.identity"),string(&self.remote.data["identity"],"name")))))
            .when(active,|el|el
                .child(div().flex().items_start().gap(px(12.))
                    .child(div().flex_1().min_w_0().text_size(px(20.)).font_weight(FontWeight::BOLD).child(string(task,"title").to_string()))
                    .child(div().text_color(p.color("text-muted")).child(self.remote_task_status(task))))
                .when(github,|el|el.child(div().mt(px(8.)).flex().flex_wrap().items_center().gap(px(8.))
                    .child(Button::new("remote-open-source").ghost().small().label(if roadmap {format!("{} · {}:L{}",repository,string(source,"path"),source["line"].as_u64().unwrap_or(0))}else{source_label(task)})
                        .on_click(cx.listener({let id=id.clone();move|this,_,_,cx|this.command(json!({"action":"remote_open_source","task_id":id}),cx)})))
                    .when_some(policy,|el,repo|el.child(div().text_size(px(12.)).text_color(p.color("text-muted"))
                        .child(self.t(if repo["auto_dispatch"].as_bool().unwrap_or(false){"remote.auto_enabled"}else{"remote.manual_dispatch"}))))))
                .when(!source_context(task).is_empty(),|el|el.child(div().mt(px(6.)).text_size(px(12.)).text_color(p.color("text-muted")).child(source_context(task))))
                .when(!string(task,"parent_task_id").is_empty(),|el|el.child(div().flex().child(Button::new("remote-parent").ghost().small().label(self.t("remote.parent_task"))
                    .on_click(cx.listener({let parent=string(task,"parent_task_id").to_string();move|this,_,_,cx|this.command(json!({"action":"remote_select","task_id":parent}),cx)})))))
                .when(!task_tags(task).is_empty(),|el|el.child(div().mt(px(6.)).flex().flex_wrap().gap(px(4.)).children(
                    task_tags(task).iter().filter_map(Value::as_str).enumerate().map(|(i,tag)|Button::new(("remote-tag",i)).outline().small().label(format!("#{tag}"))
                        .on_click(cx.listener({let tag=tag.to_string();move|this,_,_,cx|this.command(json!({"action":"remote_filter","source_kind":string(&this.remote.data,"source_kind"),"tag":tag}),cx)}))))))
                .when(github||client||claimed,|el|el.child(div().mt(px(8.)).text_size(px(12.)).text_color(p.color("text-muted"))
                    .child(if claimed{format!("{} · {}",self.t("remote.claimed_by"),string(&task["claimed_by"],"name"))}else{self.t("remote.unclaimed").to_string()})))
                .when(closed,|el|el.child(div().mt(px(8.)).text_color(p.color("warning")).child(self.t(if string(source,"state")=="missing"{"remote.source_missing"}else if roadmap{"remote.roadmap_checked_help"}else{"remote.issue_closed"}))))
                .when(source_changed(task)&&!closed,|el|el.child(div().mt(px(8.)).text_color(p.color("warning"))
                    .child(self.t(if !string(task,"current_run_id").is_empty(){"remote.source_changed_ran"}else if claimed{"remote.source_changed_claimed"}else{"remote.source_changed"}))))
                .child(div().mt(px(10.)).flex().flex_wrap().gap(px(8.))
                    .when(client&&!claimed,|el|el.child(Button::new("remote-claim").primary().small().label(self.t("remote.claim"))
                        .disabled(!idle||closed||busy).on_click(cx.listener({let id=id.clone();move|this,_,_,cx|{this.remote.filter=1;this.command(json!({"action":"remote_claim","task_id":id}),cx);}}))))
                    .when(client&&mine,|el|el.child(Button::new("remote-release").outline().small().label(self.t("remote.release"))
                        .disabled(!idle||busy).on_click(cx.listener({let id=id.clone();move|this,_,_,cx|{this.remote.filter=0;this.command(json!({"action":"remote_release","task_id":id}),cx);}}))))
                    .child(Button::new("remote-dispatch").primary().small().label(self.t(if client{"remote.execute"}else{"remote.dispatch"})).disabled(!can_dispatch||busy)
                        .on_click(cx.listener({let id=id.clone();move|this,_,_,cx|this.command(json!({"action":"remote_dispatch","task_id":id}),cx)})))
                    .when(can_cancel,|el|el.child(Button::new("remote-cancel").outline().small().label(self.t("remote.cancel")).disabled(busy)
                        .on_click(cx.listener({let id=id.clone();move|this,_,_,cx|{this.remote.confirm_cancel=Some(id.clone());cx.notify();}})))))
                .when(confirming,|el|el.child(div().mt(px(12.)).p(px(12.)).border_1().border_color(p.color("input-border"))
                    .child(self.t("remote.confirm_stop"))
                    .child(div().mt(px(8.)).flex().gap(px(8.))
                        .child(Button::new("remote-confirm-cancel").outline().small().label(self.t("remote.confirm_cancel"))
                            .on_click(cx.listener({let id=id.clone();move|this,_,_,cx|{this.remote.confirm_cancel=None;
                                this.command(json!({"action":"remote_cancel","task_id":id}),cx);}})))
                        .child(Button::new("remote-keep-running").ghost().small().label(self.t("remote.keep_running"))
                            .on_click(cx.listener(|this,_,_,cx|{this.remote.confirm_cancel=None;cx.notify();}))))))
                .child(div().mt(px(16.)).text_size(px(12.)).text_color(p.color("text-muted"))
                    .child(format!("{} · {} · {}",string(task,"project_id"),string(task,"workspace_key"),string(task,"agent_id"))))
                .when(state=="queued",|el|el.child(div().mt(px(12.)).child(self.t("remote.waiting_worker"))))
                .when(state=="cancel_requested",|el|el.child(div().mt(px(12.)).child(self.t("remote.stopping"))))
                .when(matches!(state,"succeeded"|"failed"|"reconcile"),|el|el.child(div().mt(px(12.)).text_color(p.color("text-muted"))
                    .child(self.t(if state=="succeeded"{"remote.execution_only"}else{"remote.failure_recovery"}))))
                .child(div().mt(px(20.)).font_weight(FontWeight::BOLD).child(self.t("remote.prompt")))
                .child(div().w_full().min_w_0().whitespace_normal().mt(px(6.)).child(string(task,"prompt").to_string()))
                .child(div().mt(px(16.)).font_weight(FontWeight::BOLD).child(self.t("remote.acceptance")))
                .child(div().w_full().min_w_0().whitespace_normal().mt(px(6.)).child(string(task,"acceptance").to_string()))
                .when(!run.is_null(),|el|el
                    .child(div().mt(px(20.)).pt(px(12.)).border_t_1().border_color(p.color("border")).font_weight(FontWeight::BOLD).child(self.t("remote.run")))
                    .child(div().mt(px(6.)).text_size(px(12.)).text_color(p.color("text-muted"))
                        .child(format!("{} · {}",string(run,"id"),string(run,"worker_id"))))
                    .when(!string(run,"summary").is_empty(),|el|el.child(div().w_full().min_w_0().whitespace_normal().mt(px(8.)).child(string(run,"summary").to_string()))))
                .child(div().mt(px(20.)).pt(px(12.)).border_t_1().border_color(p.color("border")).font_weight(FontWeight::BOLD).child(self.t("remote.events")))
                .when(detail["events_truncated"].as_bool().unwrap_or(false),|el|el.child(div().mt(px(8.)).text_size(px(12.)).text_color(p.color("text-muted"))
                    .child(self.t("remote.recent_events"))
                    .when_some(detail["events_first_seq"].as_u64().zip(detail["events_last_seq"].as_u64()), |el,(first,last)|el.child(format!(" · {first}–{last}")))))
                .when(events.is_empty(),|el|el.child(div().mt(px(8.)).text_color(p.color("text-muted")).child(self.t("remote.no_events"))))
                .children(events.iter().map(|event|{
                    let kind=string(event,"kind");
                    let payload=remote_event_summary(event);
                    div().w_full().min_w_0().whitespace_normal().py(px(8.)).border_b_1().border_color(p.color("border"))
                        .child(div().text_size(px(12.)).text_color(p.color("text-muted")).child(kind.to_string()))
                        .when(!payload.is_empty(),|el|el.child(div().w_full().min_w_0().whitespace_normal().mt(px(4.)).child(payload.to_string())))
                })))
    }
}
