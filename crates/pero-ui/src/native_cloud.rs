//! Native Cloud session with platform-owned credential persistence.
#[path = "native_cloud_storage.rs"]
mod storage;
use crate::cloud_links::{self, idempotency_key};
use crate::desktop_login::{self, Attempt, CALLBACK_ERROR, DEFAULT_ORIGIN};
use pero_contracts::HostEvent;
use serde_json::{Value, json};
use std::time::{Duration, SystemTime};
pub(crate) use storage::{CloudAccount, EnrollmentFailure};

const EXCHANGE_ERROR: &str = "GitHub sign-in could not complete. Start GitHub sign-in again.";
const UNSUPPORTED: &str = "This native preview cannot do that yet.";
const LOCAL_WORKSPACE: &str =
    "This native preview does not run a local contribution workspace yet.";
const GH_HELP: &str = "https://cli.github.com/";

pub(crate) struct CloudSession {
    attempt: Option<Attempt>,
    completed_callback: Option<String>,
    base: String,
    token: String,
    client_mode: bool,
    pages: usize,
    source_kind: String,
    tag: String,
    selected: Option<String>,
    tasks: Value,
    has_more: bool,
    workers: Value,
    identity: Value,
    github: Value,
    detail: Value,
    contributions: Value,
    contribution_more: bool,
    contribution_cursor: Option<String>,
    contribution_selected: Option<String>,
    contribution_detail: Value,
    open_url: Option<String>,
    error: Option<String>,
    loading: bool,
    http: reqwest::blocking::Client,
    vault: Option<crate::native_secrets::SecretStore>,
}

pub(crate) struct CommandOutcome {
    pub event: HostEvent,
    pub open_url: Option<String>,
    pub expire_id: Option<String>,
}

impl CloudSession {
    pub(crate) fn new() -> Self {
        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("cloud client");
        Self {
            attempt: None,
            completed_callback: None,
            base: DEFAULT_ORIGIN.into(),
            token: String::new(),
            client_mode: true,
            pages: 1,
            source_kind: String::new(),
            tag: String::new(),
            selected: None,
            tasks: json!([]),
            has_more: false,
            workers: json!([]),
            identity: Value::Null,
            github: Value::Null,
            detail: Value::Null,
            contributions: json!([]),
            contribution_more: false,
            contribution_cursor: None,
            contribution_selected: None,
            contribution_detail: Value::Null,
            open_url: None,
            error: None,
            loading: false,
            http,
            vault: None,
        }
    }

    pub(crate) fn start_login(&mut self, url: &str) -> Result<CommandOutcome, &'static str> {
        let base = desktop_login::service_origin(url)?;
        let attempt = Attempt::begin(base)?;
        let open_url = attempt.url();
        let expire_id = attempt.state.clone();
        self.attempt = Some(attempt);
        self.error = None;
        self.loading = false;
        Ok(CommandOutcome {
            event: self.remote_event(),
            open_url: Some(open_url),
            expire_id: Some(expire_id),
        })
    }

    pub(crate) fn note_error(&mut self, message: &str) -> HostEvent {
        self.attempt = None;
        self.loading = false;
        self.error = Some(self.redact(message));
        self.remote_event()
    }

    pub(crate) fn expire(&mut self, id: &str) -> Option<HostEvent> {
        if self
            .attempt
            .as_ref()
            .is_some_and(|attempt| attempt.state == id)
        {
            Some(self.note_error("GitHub sign-in expired. Sign in again from the connection page."))
        } else {
            None
        }
    }

    pub(crate) fn command(&mut self, value: &Value) -> Option<CommandOutcome> {
        self.open_url = None;
        let action = value["action"].as_str().unwrap_or("");
        if action == "native_login_callback" {
            return Some(self.finish_callback(value["url"].as_str().unwrap_or("")));
        }
        if action == "native_login_expired" {
            return self
                .expire(value["id"].as_str().unwrap_or(""))
                .map(|event| CommandOutcome {
                    event,
                    open_url: None,
                    expire_id: None,
                });
        }
        if !action.starts_with("remote_") {
            return None;
        }
        let event = if action.starts_with("remote_contribution_") {
            self.contribution(action, value)
        } else {
            self.remote(action, value)
        };
        Some(CommandOutcome {
            event,
            open_url: self.open_url.clone(),
            expire_id: None,
        })
    }

    fn remote(&mut self, action: &str, value: &Value) -> HostEvent {
        self.loading = false;
        match action {
            "remote_login_cancel" => {
                self.attempt = None;
                self.error = None;
            }
            "remote_disconnect" => {
                self.attempt = None;
                self.token.clear();
                self.client_mode = true;
                self.clear_lists();
                self.error = None;
                self.forget_connection();
            }
            "remote_configure" => self.configure(value),
            "remote_refresh" => self.reload(),
            "remote_more" => {
                if self.configured() {
                    self.pages += 1;
                    self.reload();
                }
            }
            "remote_select" => self.select(value),
            "remote_filter" => self.filter(value),
            "remote_open_source" => self.open_source(value),
            "remote_claim" | "remote_release" | "remote_dispatch" | "remote_cancel" => {
                self.transition(action, value)
            }
            "remote_create" => self.create_task(value),
            "remote_sync_issues" => self.sync_issues(),
            _ => self.error = Some(UNSUPPORTED.into()),
        }
        self.remote_event()
    }

    fn transition(&mut self, action: &str, value: &Value) {
        if !self.configured() {
            return;
        }
        let Some(id) = identifier(value.get("task_id")) else {
            self.error = Some("Invalid task identifier".into());
            return;
        };
        let verb = action.trim_start_matches("remote_");
        let body = if verb == "dispatch" {
            match value.get("worker_id").filter(|worker| !worker.is_null()) {
                Some(worker) => {
                    let Some(worker) = identifier(Some(worker)) else {
                        self.error = Some("Invalid task identifier".into());
                        return;
                    };
                    json!({"worker_id": worker})
                }
                None => json!({}),
            }
        } else {
            json!({})
        };
        if let Err(message) = self.post(&format!("{}/tasks/{id}/{verb}", self.api()), &body) {
            self.error = Some(message);
            return;
        }
        self.selected = Some(id);
        self.reload();
    }

    fn create_task(&mut self, value: &Value) {
        if !self.configured() {
            return;
        }
        let spec = match cloud_links::task_spec(value) {
            Ok(spec) => spec,
            Err(message) => {
                self.error = Some(message.into());
                return;
            }
        };
        let key = value
            .get("request_id")
            .and_then(|_| identifier(value.get("request_id")));
        if value.get("request_id").is_some() && key.is_none() {
            self.error = Some("Invalid task request identifier".into());
            return;
        }
        let response = self.read(
            self.http
                .post(format!("{}{}{}", self.base, self.api(), "/tasks"))
                .bearer_auth(&self.token)
                .header("Idempotency-Key", key.unwrap_or_else(idempotency_key))
                .json(&spec),
        );
        match response {
            Ok(task) => {
                self.selected = identifier(task.get("id"));
                self.reload();
            }
            Err(message) => self.error = Some(message),
        }
    }

    fn sync_issues(&mut self) {
        if !self.configured() {
            return;
        }
        if self.client_mode {
            self.error = Some("Only the operator can sync GitHub sources".into());
            return;
        }
        match self.post("/api/v1/github/sync", &json!({})) {
            Ok(synced) => {
                self.reload();
                if synced["partial"].as_bool().unwrap_or(false) && self.error.is_none() {
                    let joined = synced["errors"]
                        .as_array()
                        .map(|errors| {
                            errors
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join("; ")
                        })
                        .unwrap_or_default();
                    let message = if joined.is_empty() {
                        "Source synchronization is incomplete".to_string()
                    } else {
                        joined
                    };
                    self.error = Some(self.redact(&message));
                }
            }
            Err(message) => self.error = Some(message),
        }
    }

    fn configure(&mut self, value: &Value) {
        self.attempt = None;
        let Ok(base) = desktop_login::service_origin(value["url"].as_str().unwrap_or("")) else {
            self.error = Some(desktop_login::ORIGIN_ERROR.into());
            return;
        };
        let Some(token) = value["token"].as_str() else {
            self.error = Some("Invalid connection fields".into());
            return;
        };
        let token = token.trim();
        if token.is_empty() || token.len() > 512 || token.chars().any(|char| char.is_control()) {
            self.error = Some("Invalid connection fields".into());
            return;
        }
        let mode = value["mode"].as_str().unwrap_or("");
        if mode != "client" && mode != "operator" {
            self.error = Some("Choose client or operator access".into());
            return;
        }
        self.base = base;
        self.token = token.to_string();
        self.client_mode = mode == "client";
        self.source_kind.clear();
        self.tag.clear();
        self.clear_lists();
        self.reload();
        if self.error.is_none() {
            self.persist_connection();
        }
    }

    fn select(&mut self, value: &Value) {
        if !self.configured() {
            return;
        }
        if value.get("task_id").is_some_and(Value::is_null) {
            self.selected = None;
            self.detail = Value::Null;
            self.error = None;
            return;
        }
        let Some(id) = identifier(value.get("task_id")) else {
            self.error = Some("Invalid task identifier".into());
            return;
        };
        self.selected = Some(id);
        self.reload();
    }

    fn filter(&mut self, value: &Value) {
        if !self.configured() {
            return;
        }
        let kind = value["source_kind"].as_str().unwrap_or("");
        if !matches!(kind, "" | "github" | "roadmap") {
            self.error = Some("Invalid task source filter".into());
            return;
        }
        let tag = if value.get("tag").is_none() || value["tag"].as_str() == Some("") {
            String::new()
        } else {
            match value["tag"].as_str() {
                Some(tag)
                    if !tag.trim().is_empty()
                        && tag.chars().count() <= 128
                        && !tag.chars().any(|char| char.is_control()) =>
                {
                    tag.trim().to_string()
                }
                _ => {
                    self.error = Some("Invalid task source filter".into());
                    return;
                }
            }
        };
        self.source_kind = kind.to_string();
        self.tag = tag;
        self.pages = 1;
        self.clear_lists();
        self.reload();
    }

    fn open_source(&mut self, value: &Value) {
        if !self.configured() {
            self.error = Some(UNSUPPORTED.into());
            return;
        }
        let Some(id) = identifier(value.get("task_id")) else {
            self.error = Some("Invalid task identifier".into());
            return;
        };
        let detail = match self.get(&format!("{}/tasks/{id}", self.api())) {
            Ok(detail) => detail,
            Err(message) => {
                self.error = Some(message);
                return;
            }
        };
        let source_url = {
            let source = if detail["task"]["latest_source"].is_object() {
                &detail["task"]["latest_source"]
            } else {
                &detail["task"]["source"]
            };
            desktop_login::canonical_source_url(source)
        };
        match source_url {
            Ok(url) => {
                self.detail = detail;
                self.selected = Some(id);
                self.error = None;
                self.open_url = Some(url);
            }
            Err(message) => self.error = Some(message.into()),
        }
    }

    fn reload(&mut self) {
        if !self.configured() {
            return;
        }
        match self.load() {
            Ok(()) => self.error = None,
            Err(message) => self.error = Some(message),
        }
    }

    fn finish_callback(&mut self, value: &str) -> CommandOutcome {
        if self.completed_callback.as_deref() == Some(value) {
            return CommandOutcome {
                event: self.remote_event(),
                open_url: None,
                expire_id: None,
            };
        }
        let accepted = self.attempt.as_ref().map(|attempt| {
            let base = attempt.base.clone();
            let verifier = attempt.verifier().to_string();
            attempt
                .accept(value, SystemTime::now())
                .map(|code| (base, verifier, code))
        });
        let (base, verifier, code) = match accepted {
            None => {
                return CommandOutcome {
                    event: self.note_error(CALLBACK_ERROR),
                    open_url: None,
                    expire_id: None,
                };
            }
            Some(Err(message)) => {
                return CommandOutcome {
                    event: self.note_error(message),
                    open_url: None,
                    expire_id: None,
                };
            }
            Some(Ok(parts)) => parts,
        };
        self.loading = true;
        let exchanged = self.exchange(&base, &code, &verifier);
        self.attempt = None;
        self.loading = false;
        match exchanged {
            Ok(token) => {
                self.base = base;
                self.token = token;
                self.client_mode = true;
                self.completed_callback = Some(value.to_string());
                self.clear_lists();
                self.reload();
                self.persist_connection();
            }
            Err(message) => self.error = Some(message),
        }
        CommandOutcome {
            event: self.remote_event(),
            open_url: None,
            expire_id: None,
        }
    }

    fn exchange(&self, base: &str, code: &str, verifier: &str) -> Result<String, String> {
        let response = self
            .http
            .post(format!("{base}/auth/desktop/token"))
            .json(&json!({"code": code, "code_verifier": verifier}))
            .send()
            .map_err(|_| EXCHANGE_ERROR.to_string())?;
        if !response.status().is_success() {
            return Err(EXCHANGE_ERROR.into());
        }
        let body = read_body(response, 2048).map_err(|_| EXCHANGE_ERROR.to_string())?;
        let result: Value =
            serde_json::from_slice(&body).map_err(|_| EXCHANGE_ERROR.to_string())?;
        let token = result["token"].as_str().unwrap_or("");
        if !token.starts_with("desktop_")
            || !token.contains(".secret_")
            || token.len() > 512
            || !token_ok(token)
        {
            return Err(EXCHANGE_ERROR.into());
        }
        Ok(token.to_string())
    }

    fn load(&mut self) -> Result<(), String> {
        let api = self.api();
        let identity = self.get(&format!("{api}/me"))?;
        let github = self.get(&format!("{api}/github/status"))?;
        let workers = self.get(&format!("{api}/workers"))?;
        if !workers["workers"].is_array() {
            return Err("Invalid remote Worker list".into());
        }
        let mut tasks = Vec::new();
        let mut cursor = None;
        let mut has_more = false;
        for _ in 0..self.pages {
            let mut url = reqwest::Url::parse(&format!("{}{api}/tasks", self.base))
                .map_err(|_| "Invalid API route".to_string())?;
            {
                let mut query = url.query_pairs_mut();
                query.append_pair("limit", "50");
                if !self.source_kind.is_empty() {
                    query.append_pair("source_kind", &self.source_kind);
                }
                if !self.tag.is_empty() {
                    query.append_pair("tag", &self.tag);
                }
                if let Some(cursor) = cursor.as_deref() {
                    query.append_pair("cursor", cursor);
                }
            }
            let page = self.get_url(url)?;
            let page_tasks = page["tasks"]
                .as_array()
                .cloned()
                .ok_or("Invalid remote task list")?;
            tasks.extend(page_tasks);
            has_more = page["has_more"].as_bool().unwrap_or(false);
            cursor = page["next_cursor"].as_str().map(str::to_string);
            if !has_more || cursor.is_none() {
                break;
            }
        }
        let detail = if let Some(id) = &self.selected {
            self.get(&format!("{api}/tasks/{id}"))?
        } else {
            Value::Null
        };
        self.identity = identity;
        self.github = github;
        self.workers = workers["workers"].clone();
        self.tasks = Value::Array(tasks);
        self.has_more = has_more;
        self.detail = detail;
        Ok(())
    }

    fn contribution(&mut self, action: &str, value: &Value) -> HostEvent {
        if !self.configured() || !self.client_mode {
            self.contributions = json!([]);
            return self.contribution_event();
        }
        match action {
            "remote_contribution_refresh" | "remote_contribution_more" => {
                let more = action.ends_with("_more");
                let mut url = match reqwest::Url::parse(&format!(
                    "{}/api/client/v1/contributions",
                    self.base
                )) {
                    Ok(url) => url,
                    Err(_) => return self.contribution_error("Invalid contribution endpoint"),
                };
                {
                    let mut query = url.query_pairs_mut();
                    query.append_pair("limit", "50");
                    if more {
                        if let Some(cursor) = &self.contribution_cursor {
                            query.append_pair("cursor", cursor);
                        }
                    }
                }
                match self.get_url(url) {
                    Ok(page)
                        if page["contributions"].is_array() && page["has_more"].is_boolean() =>
                    {
                        let rows = page["contributions"]
                            .as_array()
                            .cloned()
                            .unwrap_or_default();
                        if more {
                            let mut existing =
                                self.contributions.as_array().cloned().unwrap_or_default();
                            existing.extend(rows);
                            self.contributions = Value::Array(existing);
                        } else {
                            self.contributions = Value::Array(rows);
                        }
                        self.contribution_more = page["has_more"].as_bool().unwrap_or(false);
                        self.contribution_cursor = page["next_cursor"].as_str().map(str::to_string);
                        self.error = None;
                    }
                    Ok(_) => return self.contribution_error("Invalid public task list"),
                    Err(message) => return self.contribution_error(&message),
                }
            }
            "remote_contribution_select" => {
                let Some(id) = value["task_id"].as_str().filter(|id| identifier_str(id)) else {
                    return self.contribution_error("Select a public task first.");
                };
                match self.get(&format!("/api/client/v1/contributions/{id}")) {
                    Ok(detail) => {
                        self.contribution_selected = Some(id.to_string());
                        self.contribution_detail = detail;
                    }
                    Err(message) => return self.contribution_error(&message),
                }
            }
            "remote_contribution_claim" | "remote_contribution_release" => {
                let Some(id) = value["task_id"].as_str().filter(|id| identifier_str(id)) else {
                    return self.contribution_error("Select a public task first.");
                };
                let verb = if action.ends_with("_claim") {
                    "claim"
                } else {
                    "release"
                };
                match self.post(
                    &format!("/api/client/v1/contributions/{id}/{verb}"),
                    &json!({}),
                ) {
                    Ok(detail) => self.remember_contribution(id, detail),
                    Err(message) => return self.contribution_error(&message),
                }
            }
            "remote_contribution_source"
            | "remote_contribution_open_pr"
            | "remote_contribution_gh_help" => {
                if let Err(message) = self.contribution_ready(value) {
                    return self.contribution_error(&message);
                }
                let opened = if action.ends_with("_gh_help") {
                    Some(GH_HELP.to_string())
                } else if action.ends_with("_open_pr") {
                    cloud_links::pull_page(
                        self.contribution_detail["repository"]
                            .as_str()
                            .unwrap_or(""),
                        self.contribution_detail["pull_request"]["url"]
                            .as_str()
                            .unwrap_or(""),
                    )
                } else {
                    cloud_links::source_page(
                        self.contribution_detail["repository"]
                            .as_str()
                            .unwrap_or(""),
                        self.contribution_detail["source_url"]
                            .as_str()
                            .unwrap_or(""),
                    )
                };
                match opened {
                    Some(url) => self.open_url = Some(url),
                    None => {
                        return self.contribution_error(if action.ends_with("_open_pr") {
                            "No pull request has been created."
                        } else {
                            "Invalid task source"
                        });
                    }
                }
            }
            "remote_contribution_start"
            | "remote_contribution_review"
            | "remote_contribution_publish"
            | "remote_contribution_submit"
            | "remote_contribution_open_session" => {
                return self.contribution_error(LOCAL_WORKSPACE);
            }
            _ => return self.contribution_error(UNSUPPORTED),
        }
        self.contribution_event()
    }

    fn remember_contribution(&mut self, id: &str, detail: Value) {
        self.contribution_selected = Some(id.to_string());
        if let Some(rows) = self.contributions.as_array_mut() {
            if let Some(row) = rows
                .iter_mut()
                .find(|row| row["task_id"].as_str() == Some(id))
            {
                *row = detail.clone();
            }
        }
        self.contribution_detail = detail;
        self.error = None;
    }

    fn contribution_ready(&mut self, value: &Value) -> Result<(), String> {
        let Some(id) = value["task_id"].as_str().filter(|id| identifier_str(id)) else {
            return Err("Select a public task first.".into());
        };
        if self.contribution_detail["task_id"].as_str() == Some(id) {
            self.contribution_selected = Some(id.to_string());
            return Ok(());
        }
        let detail = self.get(&format!("/api/client/v1/contributions/{id}"))?;
        self.contribution_selected = Some(id.to_string());
        self.contribution_detail = detail;
        Ok(())
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        self.get_url(
            reqwest::Url::parse(&format!("{}{path}", self.base))
                .map_err(|_| "Invalid API route".to_string())?,
        )
    }

    fn post(&self, path: &str, body: &Value) -> Result<Value, String> {
        let url = reqwest::Url::parse(&format!("{}{path}", self.base))
            .map_err(|_| "Invalid API route".to_string())?;
        self.read(
            self.http
                .post(url)
                .bearer_auth(&self.token)
                .header("Idempotency-Key", idempotency_key())
                .json(body),
        )
    }

    fn get_url(&self, url: reqwest::Url) -> Result<Value, String> {
        self.read(self.http.get(url).bearer_auth(&self.token))
    }

    fn read(&self, request: reqwest::blocking::RequestBuilder) -> Result<Value, String> {
        let response = request
            .send()
            .map_err(|_| "Cloud connection failed".to_string())?;
        let status = response.status();
        let bytes = read_body(response, 2_000_000)?;
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| "Cloud connection failed".to_string())?;
        if !status.is_success() {
            let message = value["error"].as_str().unwrap_or("request failed");
            return Err(self.redact(&format!(
                "Remote {}: {}",
                status.as_u16(),
                message.chars().take(300).collect::<String>()
            )));
        }
        Ok(value)
    }

    fn api(&self) -> &'static str {
        if self.client_mode {
            "/api/client/v1"
        } else {
            "/api/v1"
        }
    }

    fn configured(&self) -> bool {
        !self.token.is_empty()
    }

    fn clear_lists(&mut self) {
        self.pages = 1;
        self.tasks = json!([]);
        self.workers = json!([]);
        self.has_more = false;
        self.selected = None;
        self.detail = Value::Null;
        self.identity = Value::Null;
        self.github = Value::Null;
        self.contributions = json!([]);
        self.contribution_detail = Value::Null;
        self.contribution_selected = None;
        self.contribution_cursor = None;
        self.contribution_more = false;
    }

    fn remote_event(&self) -> HostEvent {
        let mut event = HostEvent::new("remote_state", None, String::new());
        event.data = json!({
            "configured": self.configured(),
            "loading": self.loading,
            "error": self.error,
            "tasks": self.tasks,
            "workers": self.workers,
            "has_more": self.has_more,
            "selected_task_id": self.selected,
            "detail": self.detail,
            "identity": self.identity,
            "github": self.github,
            "connection": {
                "url": self.base,
                "mode": if self.client_mode { "client" } else { "operator" },
                "credential_configured": self.configured(),
                "persistence_available": self.vault.is_some(),
                "authenticating": self.attempt.is_some(),
            },
            "source_kind": self.source_kind,
            "tag": self.tag,
        });
        event
    }

    fn contribution_event(&self) -> HostEvent {
        let mut event = HostEvent::new("contributor_state", None, String::new());
        event.data = json!({
            "loading": false,
            "error": Value::Null,
            "contributions": self.contributions,
            "selected_task_id": self.contribution_selected,
            "detail": self.contribution_detail,
            "local": Value::Null,
            "has_more": self.contribution_more,
        });
        event
    }

    fn contribution_error(&self, message: &str) -> HostEvent {
        let mut event = self.contribution_event();
        event.data["error"] = Value::String(self.redact(message));
        event
    }

    fn redact(&self, message: &str) -> String {
        let message = if self.token.is_empty() {
            message.to_string()
        } else {
            message.replace(&self.token, "[redacted]")
        };
        message.chars().take(500).collect()
    }
}

fn identifier(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|id| identifier_str(id))
        .map(str::to_string)
}

fn identifier_str(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn token_ok(token: &str) -> bool {
    let Some((name, secret)) = token.split_once('.') else {
        return false;
    };
    let Some(name) = name.strip_prefix("desktop_") else {
        return false;
    };
    let Some(secret) = secret.strip_prefix("secret_") else {
        return false;
    };
    !name.is_empty()
        && !secret.is_empty()
        && name.bytes().all(token_char)
        && secret.bytes().all(token_char)
}

fn token_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-'
}

fn read_body(mut response: reqwest::blocking::Response, max: usize) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut body = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = response
            .read(&mut chunk)
            .map_err(|_| "Cloud connection failed".to_string())?;
        if read == 0 {
            break;
        }
        if body.len() + read > max {
            return Err("Remote response is too large".into());
        }
        body.extend_from_slice(&chunk[..read]);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_in_opens_the_service_and_waits() {
        let mut cloud = CloudSession::new();
        let started = cloud.start_login("https://app.openpero.com").unwrap();
        assert!(
            started
                .open_url
                .unwrap()
                .starts_with("https://app.openpero.com/connect/desktop?")
        );
        assert_eq!(started.event.data["connection"]["authenticating"], true);
        assert_eq!(started.event.data["configured"], false);
        assert!(!started.event.data.to_string().contains("code_verifier"));
        let waiting = cloud
            .command(&json!({"action":"remote_login_cancel"}))
            .unwrap();
        assert_eq!(waiting.event.data["connection"]["authenticating"], false);
        assert!(waiting.event.data["error"].is_null());
    }

    #[test]
    fn a_foreign_callback_does_not_replace_the_attempt_with_a_token() {
        let mut cloud = CloudSession::new();
        cloud.start_login(DEFAULT_ORIGIN).unwrap();
        let outcome = cloud.command(&json!({"action":"native_login_callback","url":"pero://connect/callback?code=abcd&state=nope"})).unwrap();
        assert_eq!(outcome.event.data["configured"], false);
        assert!(outcome.event.data["error"].is_string());
        assert!(!outcome.event.data.to_string().contains("secret_"));
    }

    #[test]
    fn invalid_creation_sync_and_claim_stay_local() {
        let mut cloud = CloudSession::new();
        cloud.token = "desktop_name.secret_value".into();
        let created = cloud
            .command(&json!({"action":"remote_create","title":"","prompt":"Prompt","acceptance":"Done","project_id":"pero","workspace_key":"pero","agent_id":"codex"}))
            .unwrap();
        assert_eq!(created.event.data["error"], "Invalid remote task field");
        let synced = cloud
            .command(&json!({"action":"remote_sync_issues"}))
            .unwrap();
        assert_eq!(
            synced.event.data["error"],
            "Only the operator can sync GitHub sources"
        );
        let claimed = cloud
            .command(&json!({"action":"remote_claim","task_id":"../x"}))
            .unwrap();
        assert_eq!(claimed.event.data["error"], "Invalid task identifier");
        assert!(claimed.open_url.is_none());
    }

    #[test]
    fn public_pages_open_only_on_their_own_repository() {
        let mut cloud = CloudSession::new();
        cloud.token = "desktop_name.secret_value".into();
        cloud.contribution_selected = Some("task-1".into());
        cloud.contribution_detail = json!({
            "task_id": "task-1",
            "repository": "phodal/pero",
            "source_url": "https://github.com/phodal/pero/issues/9",
            "pull_request": {"url": "https://github.com/phodal/pero/pull/12"}
        });
        let source = cloud
            .command(&json!({"action":"remote_contribution_source","task_id":"task-1"}))
            .unwrap();
        assert_eq!(
            source.open_url.as_deref(),
            Some("https://github.com/phodal/pero/issues/9")
        );
        cloud.contribution_detail["source_url"] = json!("https://github.com/evil/pero/issues/9");
        let swapped = cloud
            .command(&json!({"action":"remote_contribution_source","task_id":"task-1"}))
            .unwrap();
        assert!(swapped.open_url.is_none());
        assert_eq!(swapped.event.data["error"], "Invalid task source");
        let help = cloud
            .command(&json!({"action":"remote_contribution_gh_help","task_id":"task-1"}))
            .unwrap();
        assert_eq!(help.open_url.as_deref(), Some("https://cli.github.com/"));
        let pull = cloud
            .command(&json!({"action":"remote_contribution_open_pr","task_id":"task-1"}))
            .unwrap();
        assert_eq!(
            pull.open_url.as_deref(),
            Some("https://github.com/phodal/pero/pull/12")
        );
        let started = cloud
            .command(&json!({"action":"remote_contribution_start","task_id":"task-1"}))
            .unwrap();
        assert_eq!(
            started.event.data["error"],
            "This native preview does not run a local contribution workspace yet."
        );
        assert!(started.open_url.is_none());
    }
}
