//! Native preview provider settings.
//!
//! The model and API URL persist through the Host settings file. The API key
//! stays in the preview secret store and is not written into that file.
use crate::native_secrets::SecretStore;
use pero_contracts::{
    harness_settings::{HarnessControl, HarnessSettings, HarnessState},
    HostEvent,
};
use serde_json::{json, Value};
use std::path::Path;

const DEFAULT_ENDPOINT: &str = "https://api.deepseek.com";
const DEFAULT_MODEL: &str = "deepseek-chat";

struct Pending {
    endpoint: String,
    model: String,
    key: String,
}

struct Route {
    endpoint: String,
    model: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredKey {
    api_key: String,
}

pub(crate) struct NativeHarness {
    endpoint: String,
    model: String,
    key: String,
    saved: bool,
    persistence: bool,
    status: String,
    error: Option<String>,
    pending: Option<Pending>,
    secrets: SecretStore,
}

pub(crate) struct HarnessOutcome {
    pub event: Option<HostEvent>,
    pub host: Option<String>,
}

impl NativeHarness {
    pub(crate) fn open(data: &Path, settings: &Path, env_file: &Path, ephemeral: bool) -> Self {
        let dotenv = std::fs::read_to_string(env_file)
            .map(|text| provider_dotenv(&text))
            .unwrap_or_default();
        Self::restore(
            settings,
            SecretStore::open(data, "harness", ephemeral),
            move |key| provider_setting(key, std::env::var(key).ok().as_deref(), &dotenv),
        )
    }

    fn restore(settings: &Path, secrets: SecretStore, mut env: impl FnMut(&str) -> String) -> Self {
        let (persistence, stored) = match secrets.load::<StoredKey>() {
            Ok(stored) => (true, stored),
            Err(_) => (false, None),
        };
        let saved_route = std::fs::read(settings).ok().and_then(|bytes| {
            let value: Value = serde_json::from_slice(&bytes).ok()?;
            let harness = value.get("harness")?;
            route(
                harness
                    .get("endpoint")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                harness.get("model").and_then(Value::as_str).unwrap_or(""),
            )
            .ok()
        });
        let saved = saved_route.is_some();
        let route = saved_route.unwrap_or_else(|| {
            route(&env("DEEPSEEK_BASE_URL"), &env("DEEPSEEK_MODEL")).unwrap_or(Route {
                endpoint: DEFAULT_ENDPOINT.into(),
                model: DEFAULT_MODEL.into(),
            })
        });
        let key = match stored {
            Some(stored) if !invalid_key(&stored.api_key) => stored.api_key,
            Some(_) => String::new(),
            None => {
                let key = env("DEEPSEEK_API_KEY");
                if invalid_key(&key) {
                    String::new()
                } else {
                    key
                }
            }
        };
        Self {
            endpoint: route.endpoint,
            model: route.model,
            key,
            saved,
            persistence,
            status: if persistence { "ready" } else { "error" }.into(),
            error: (!persistence).then(|| "harness.storage_error".into()),
            pending: None,
            secrets,
        }
    }

    pub(crate) fn process_env(&self) -> (String, String, String) {
        (self.endpoint.clone(), self.model.clone(), self.key.clone())
    }

    pub(crate) fn handle(&mut self, value: &Value) -> HarnessOutcome {
        let command = match value["action"].as_str() {
            Some("harness_get") => Command::Read,
            Some("native_harness_result") => Command::Host(value["ok"].as_bool().unwrap_or(false)),
            Some("harness_save") => match serde_json::from_value::<HarnessControl>(value.clone()) {
                Ok(HarnessControl::Save {
                    endpoint,
                    model,
                    api_key,
                    clear_key,
                }) => Command::Save {
                    endpoint,
                    model,
                    api_key,
                    clear_key,
                },
                _ => Command::Invalid,
            },
            _ => Command::Invalid,
        };
        match command {
            Command::Read => HarnessOutcome::event(self.state_event()),
            Command::Host(ok) => self.finish(ok),
            Command::Invalid => {
                if self.pending.is_some() {
                    return HarnessOutcome::empty();
                }
                self.fail("harness.save_error");
                HarnessOutcome::event(self.state_event())
            }
            Command::Save {
                endpoint,
                model,
                api_key,
                clear_key,
            } => self.save(endpoint, model, api_key, clear_key),
        }
    }

    pub(crate) fn abandon(&mut self) -> Option<HostEvent> {
        self.finish(false).event
    }

    fn save(
        &mut self,
        endpoint: String,
        model: String,
        api_key: String,
        clear_key: bool,
    ) -> HarnessOutcome {
        if self.pending.is_some() {
            return HarnessOutcome::empty();
        }
        if !self.persistence {
            self.fail("harness.storage_error");
            return HarnessOutcome::event(self.state_event());
        }
        let route = match route(&endpoint, &model) {
            Ok(route) => route,
            Err(error) => {
                self.fail(error);
                return HarnessOutcome::event(self.state_event());
            }
        };
        if invalid_key(&api_key) {
            self.fail("harness.invalid_key");
            return HarnessOutcome::event(self.state_event());
        }
        let key = if clear_key {
            String::new()
        } else if api_key.is_empty() {
            self.key.clone()
        } else {
            api_key
        };
        self.pending = Some(Pending {
            endpoint: route.endpoint.clone(),
            model: route.model.clone(),
            key: key.clone(),
        });
        self.status = "saving".into();
        self.error = None;
        HarnessOutcome {
            event: Some(self.state_event()),
            host: Some(configure_message(&route.endpoint, &route.model, &key)),
        }
    }

    fn finish(&mut self, ok: bool) -> HarnessOutcome {
        let Some(pending) = self.pending.take() else {
            return HarnessOutcome::empty();
        };
        if !ok {
            self.fail("harness.save_error");
            return HarnessOutcome::event(self.state_event());
        }
        self.endpoint = pending.endpoint;
        self.model = pending.model;
        self.key = pending.key.clone();
        self.saved = true;
        self.status = "saved".into();
        self.error = None;
        if self
            .secrets
            .save(&StoredKey {
                api_key: pending.key,
            })
            .is_err()
        {
            self.fail("harness.storage_error");
        }
        HarnessOutcome::event(self.state_event())
    }

    fn fail(&mut self, error: &str) {
        self.status = "error".into();
        self.error = Some(error.into());
    }

    fn state_event(&self) -> HostEvent {
        let mut event = HostEvent::new("harness_state", None, String::new());
        event.data = serde_json::to_value(HarnessState {
            endpoint: self.endpoint.clone(),
            model: self.model.clone(),
            credential_configured: !self.key.is_empty(),
            source: if self.saved { "settings" } else { "env" }.into(),
            persistence_available: self.persistence,
            status: self.status.clone(),
            error: self.error.clone(),
        })
        .expect("harness state");
        event
    }
}

enum Command {
    Read,
    Save {
        endpoint: String,
        model: String,
        api_key: String,
        clear_key: bool,
    },
    Host(bool),
    Invalid,
}

impl HarnessOutcome {
    fn empty() -> Self {
        Self {
            event: None,
            host: None,
        }
    }
    fn event(event: HostEvent) -> Self {
        Self {
            event: Some(event),
            host: None,
        }
    }
}

fn configure_message(endpoint: &str, model: &str, api_key: &str) -> String {
    json!({
        "method": "settings.harness",
        "id": "native-harness",
        "settings": HarnessSettings {
            endpoint: endpoint.into(),
            model: model.into(),
            encrypted_api_key: None,
        },
        "api_key": api_key,
    })
    .to_string()
}

fn route(endpoint: &str, model: &str) -> Result<Route, &'static str> {
    if model.is_empty()
        || model.len() > 256
        || model
            .chars()
            .any(|character| character.is_whitespace() || character <= '\u{1f}')
    {
        return Err("harness.invalid_model");
    }
    if endpoint.len() > 2048 || endpoint != endpoint.trim() {
        return Err("harness.invalid_endpoint");
    }
    let url = url::Url::parse(endpoint).map_err(|_| "harness.invalid_endpoint")?;
    let host = url.host_str().unwrap_or("");
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("harness.invalid_endpoint");
    }
    let mut endpoint = url.to_string();
    if endpoint.ends_with('/') {
        endpoint.pop();
    }
    Ok(Route {
        endpoint,
        model: model.to_owned(),
    })
}

fn invalid_key(key: &str) -> bool {
    key.len() > 4096
        || key
            .chars()
            .any(|character| character.is_whitespace() || character <= '\u{1f}')
}

const PROVIDER_ENV: [&str; 3] = ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL"];

/// Process values win, including an explicit empty string. The file supplies a
/// key only when the process does not define it. Other dotenv names stay out.
fn provider_setting(
    key: &str,
    process: Option<&str>,
    file: &std::collections::BTreeMap<String, String>,
) -> String {
    process
        .map(str::to_owned)
        .unwrap_or_else(|| file.get(key).cloned().unwrap_or_default())
}

fn provider_dotenv(text: &str) -> std::collections::BTreeMap<String, String> {
    let mut values = std::collections::BTreeMap::new();
    for line in text.lines() {
        let line = line
            .trim()
            .strip_prefix("export ")
            .unwrap_or(line.trim())
            .trim_start();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, raw)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if PROVIDER_ENV.contains(&key) {
            values.insert(key.to_owned(), dotenv_value(raw));
        }
    }
    values
}

fn dotenv_value(raw: &str) -> String {
    let raw = raw.trim_start();
    if let Some(rest) = raw.strip_prefix('"') {
        if let Some(value) = quoted(rest, '"') {
            return value;
        }
    }
    if let Some(rest) = raw.strip_prefix('\'') {
        if let Some(end) = rest.find('\'') {
            return rest[..end].to_owned();
        }
    }
    raw.split('#').next().unwrap_or("").trim().to_owned()
}

fn quoted(raw: &str, quote: char) -> Option<String> {
    let mut out = String::new();
    let mut chars = raw.chars();
    while let Some(character) = chars.next() {
        if character == quote {
            return Some(out);
        }
        if character == '\\' && quote == '"' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('r') => out.push('\r'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => out.push('\\'),
            }
        } else {
            out.push(character);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn harness(settings: &Path, env_key: &str, env_model: &str) -> NativeHarness {
        let model = env_model.to_owned();
        let key = env_key.to_owned();
        NativeHarness::restore(settings, SecretStore::memory(), move |name| match name {
            "DEEPSEEK_BASE_URL" => "https://env.example".into(),
            "DEEPSEEK_MODEL" => model.clone(),
            "DEEPSEEK_API_KEY" => key.clone(),
            _ => String::new(),
        })
    }

    fn state(outcome: &HarnessOutcome) -> HarnessState {
        serde_json::from_value(outcome.event.as_ref().unwrap().data.clone()).unwrap()
    }

    #[test]
    fn provider_dotenv_uses_the_file_only_when_the_process_value_is_absent() {
        let file = provider_dotenv("DEEPSEEK_API_KEY=\"file-key\"\nDEEPSEEK_MODEL=custom-model\nDEEPSEEK_BASE_URL=\"a\\nb\"\nGITHUB_KEY=private\nPERO_OPERATOR_TOKEN=private\n# DEEPSEEK_API_KEY=commented\n");
        assert!(file.get("GITHUB_KEY").is_none());
        assert!(file.get("PERO_OPERATOR_TOKEN").is_none());
        assert_eq!(
            file.get("DEEPSEEK_BASE_URL").map(String::as_str),
            Some("a\nb")
        );
        let cases = [
            (None, None, "file-key", "custom-model"),
            (Some("process-key"), None, "process-key", "custom-model"),
            (Some(""), None, "", "custom-model"),
            (None, Some("process-model"), "file-key", "process-model"),
        ];
        for (process_key, process_model, expected_key, expected_model) in cases {
            assert_eq!(
                provider_setting("DEEPSEEK_API_KEY", process_key, &file),
                expected_key
            );
            assert_eq!(
                provider_setting("DEEPSEEK_MODEL", process_model, &file),
                expected_model
            );
        }
        assert_eq!(dotenv_value("value # comment"), "value");
        assert_eq!(
            dotenv_value("\"value # not comment\" # tail"),
            "value # not comment"
        );
        assert_eq!(dotenv_value("' spaced '"), " spaced ");
    }

    #[test]
    fn provider_routes_accept_https_and_loopback_and_reject_invalid_input() {
        let cases = [
            ("https://api.deepseek.com/", "deepseek-chat", "", false, ""),
            ("http://127.0.0.1:1234/v1", "local-model", "", false, ""),
            ("http://[::1]:9/v1", "local-model", "", false, ""),
            (
                "http://example.com",
                "model",
                "",
                false,
                "harness.invalid_endpoint",
            ),
            (
                "https://user:secret@example.com",
                "model",
                "",
                false,
                "harness.invalid_endpoint",
            ),
            (
                "https://api.deepseek.com?key=secret",
                "model",
                "",
                false,
                "harness.invalid_endpoint",
            ),
            (
                "https://api.deepseek.com",
                "",
                "",
                false,
                "harness.invalid_model",
            ),
            (
                "https://api.deepseek.com",
                "bad model",
                "",
                false,
                "harness.invalid_model",
            ),
            (
                "https://api.deepseek.com",
                "model",
                "bad key",
                false,
                "harness.invalid_key",
            ),
        ];
        let path = Path::new("/no/such/pero-harness-route");
        for (endpoint, model, api_key, clear_key, error) in cases {
            let mut provider = harness(path, "env-key", "env-model");
            let outcome = provider.handle(&json!({
                "action": "harness_save",
                "endpoint": endpoint,
                "model": model,
                "api_key": api_key,
                "clear_key": clear_key,
            }));
            let view = state(&outcome);
            if error.is_empty() {
                assert_eq!(
                    (view.status.as_str(), view.error.as_deref()),
                    ("saving", None),
                    "{endpoint} {model}"
                );
                assert!(outcome.host.is_some());
                assert_eq!(provider.model, "env-model");
            } else {
                assert_eq!(view.error.as_deref(), Some(error), "{endpoint} {model}");
                assert!(outcome.host.is_none());
                assert_eq!(provider.process_env().1, "env-model");
            }
        }
    }

    #[test]
    fn a_model_change_is_kept_only_after_the_host_saves_it() {
        let path =
            std::env::temp_dir().join(format!("pero-harness-save-{}.json", std::process::id()));
        let mut provider = harness(&path, "env-key", "env-model");
        let outcome = provider.handle(&json!({
            "action": "harness_save",
            "endpoint": "https://api.deepseek.com/",
            "model": "saved-model",
            "api_key": "",
            "clear_key": false,
        }));
        let message: Value = serde_json::from_str(outcome.host.as_ref().unwrap()).unwrap();
        assert!(message["settings"]["encrypted_api_key"].is_null());
        assert_eq!(message["settings"]["model"], "saved-model");
        assert_eq!(message["settings"]["endpoint"], "https://api.deepseek.com");
        assert_eq!(message["api_key"], "env-key");
        assert!(provider.secrets.load::<StoredKey>().unwrap().is_none());

        let failed = provider.handle(&json!({"action":"native_harness_result","ok":false}));
        assert_eq!(state(&failed).error.as_deref(), Some("harness.save_error"));
        assert_eq!(provider.process_env().1, "env-model");
        assert!(provider.secrets.load::<StoredKey>().unwrap().is_none());

        provider.handle(&json!({
            "action": "harness_save",
            "endpoint": "https://api.deepseek.com",
            "model": "saved-model",
            "api_key": "next-key",
            "clear_key": false,
        }));
        let saved = provider.handle(&json!({"action":"native_harness_result","ok":true}));
        let view = state(&saved);
        assert_eq!(view.status, "saved");
        assert_eq!(view.model, "saved-model");
        assert_eq!(view.source, "settings");
        assert!(view.credential_configured);
        assert_eq!(
            provider
                .secrets
                .load::<StoredKey>()
                .unwrap()
                .unwrap()
                .api_key,
            "next-key"
        );

        provider.handle(&json!({
            "action": "harness_save",
            "endpoint": "https://api.deepseek.com",
            "model": "saved-model",
            "api_key": "",
            "clear_key": true,
        }));
        provider.handle(&json!({"action":"native_harness_result","ok":true}));
        assert_eq!(
            provider
                .secrets
                .load::<StoredKey>()
                .unwrap()
                .unwrap()
                .api_key,
            ""
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_saved_model_overrides_the_environment_and_an_empty_key_does_not_fall_back() {
        let path =
            std::env::temp_dir().join(format!("pero-harness-restore-{}.json", std::process::id()));
        std::fs::write(
            &path,
            r#"{"other":{"enabled":true},"harness":{"endpoint":"https://api.deepseek.com/","model":"saved-model","encrypted_api_key":"ciphertext"}}"#,
        )
        .unwrap();
        let mut provider = harness(&path, "env-key", "env-model");
        let (endpoint, model, key) = provider.process_env();
        assert_eq!(endpoint, "https://api.deepseek.com");
        assert_eq!(model, "saved-model");
        assert_eq!(key, "env-key");
        let view = state(&provider.handle(&json!({"action":"harness_get"})));
        assert_eq!(view.source, "settings");
        assert!(view.credential_configured);

        let secrets = SecretStore::memory();
        secrets
            .save(&StoredKey {
                api_key: String::new(),
            })
            .unwrap();
        let mut cleared = NativeHarness::restore(&path, secrets, |_| "env-key".into());
        assert_eq!(cleared.process_env().2, "");
        assert!(!state(&cleared.handle(&json!({"action":"harness_get"}))).credential_configured);
        std::fs::remove_file(path).unwrap();
    }
}
