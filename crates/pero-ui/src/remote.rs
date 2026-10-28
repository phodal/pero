//! Cloud-owned tasks. The main-process adapter owns HTTP and credentials.
use crate::app::Workbench;
use gpui_kit::{
    component::input::{EditorState, InputEvent, InputState},
    *,
};
use pero_contracts::HostEvent;
use serde_json::{Value, json};

pub(crate) struct RemoteState {
    pub data: Value,
    pub connection: crate::remote_connection::ConnectionForm,
    seen_connection: bool,
    pub creating: bool,
    pub(crate) submitting: bool,
    pub title: Entity<InputState>,
    pub prompt: Entity<EditorState>,
    pub acceptance: Entity<EditorState>,
    pub project: Entity<InputState>,
    pub workspace: Entity<InputState>,
    pub(crate) agent: Option<String>,
    pub(crate) confirm_cancel: Option<String>,
    pub(crate) form_error: Option<&'static str>,
    pub(crate) filter: usize,
    pub(crate) technical: bool,
    pub(crate) public_contributions: bool,
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
            technical: false,
            public_contributions: false,
            _subscriptions: subscriptions,
        }
    }
    pub(crate) fn loading(&self) -> bool {
        self.data["loading"].as_bool().unwrap_or(false)
    }
    pub(crate) fn configured(&self) -> bool {
        self.data["configured"].as_bool().unwrap_or(false)
    }
    pub(crate) fn tasks(&self) -> &[Value] {
        self.data["tasks"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    pub(crate) fn workers(&self) -> &[Value] {
        self.data["workers"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    pub(crate) fn operator(&self) -> bool {
        string(&self.data["identity"], "role") == "operator"
    }
    pub(crate) fn client(&self) -> bool {
        string(&self.data["identity"], "role") == "client"
    }
    pub(crate) fn mine(&self, task: &Value) -> bool {
        let principal = string(&self.data["identity"], "id");
        !principal.is_empty() && string(&task["claimed_by"], "id") == principal
    }
    pub(crate) fn repositories(&self) -> &[Value] {
        self.data["github"]["repositories"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    pub(crate) fn task_visible(&self, task: &Value) -> bool {
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

pub(crate) fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

pub(crate) fn observed_source(task: &Value) -> &Value {
    if task["latest_source"].is_object() {
        &task["latest_source"]
    } else {
        &task["source"]
    }
}
pub(crate) fn source_closed(task: &Value) -> bool {
    matches!(string(observed_source(task), "state"), "closed" | "missing")
}
pub(crate) fn source_changed(task: &Value) -> bool {
    let frozen = string(&task["source"], "revision");
    let latest = string(observed_source(task), "revision");
    !frozen.is_empty() && !latest.is_empty() && frozen != latest
}
pub(crate) fn source_label(task: &Value) -> String {
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
pub(crate) fn source_context(task: &Value) -> String {
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
pub(crate) fn task_tags(task: &Value) -> &[Value] {
    observed_source(task)["tags"]
        .as_array()
        .or_else(|| task["tags"].as_array())
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
pub(crate) fn dispatchable(task: &Value) -> bool {
    matches!(
        string(task, "state"),
        "draft" | "succeeded" | "failed" | "cancelled"
    )
}

/// Display the observed event content without promoting Agent output to acceptance.
pub(crate) fn remote_event_summary(event: &Value) -> String {
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
        let was_authenticating = self.remote.data["connection"]["authenticating"]
            .as_bool()
            .unwrap_or(false);
        self.remote.data = event.data.clone();
        if !self.remote.configured() {
            self.contribution.requested = false;
            self.contribution.data = Default::default();
        } else if self.remote.client() && !self.contribution.requested {
            self.contribution.requested = true;
            self.remote.public_contributions = was_authenticating || self.remote.data["identity"]["projects"].as_array().is_some_and(Vec::is_empty);
            self.command(json!({"action":"remote_contribution_refresh"}), cx);
        }
        if was_authenticating
            && !self.remote.data["connection"]["authenticating"]
                .as_bool()
                .unwrap_or(false)
            && self.remote.configured()
            && self.remote.data["error"].is_null()
            && self.remote.data["identity"].is_object()
        {
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
    pub(crate) fn remote_agent(&self) -> String {
        self.remote
            .agent
            .clone()
            .or_else(|| self.agents.get(self.agent_index).map(|a| a.id.clone()))
            .unwrap_or_else(|| "codex".into())
    }
    pub(crate) fn create_remote(&mut self, cx: &mut Context<Self>) {
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
    pub(crate) fn start_remote_form(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.remote
            .title
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.remote
            .prompt
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.remote
            .acceptance
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.remote.creating = true;
        self.remote.submitting = false;
        self.remote.form_error = None;
        self.remote.confirm_cancel = None;
        let focus = self.remote.title.focus_handle(cx);
        window.focus(&focus, cx);
        cx.notify();
    }
}
