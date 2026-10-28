//! Stdio adapter. App rules, installed state and backend lifetime belong to the runtime.
use pero_contracts::HostEvent;
use pero_runtime::apps::{AppName, AppStore};
use std::path::{Path, PathBuf};

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum Method {
    Apps,
}

#[derive(serde::Deserialize)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
enum Request {
    List {
        method: Method,
        id: String,
    },
    Install {
        method: Method,
        id: String,
        path: PathBuf,
    },
    Enable {
        method: Method,
        id: String,
        name: AppName,
    },
    Disable {
        method: Method,
        id: String,
        name: AppName,
    },
    Uninstall {
        method: Method,
        id: String,
        name: AppName,
    },
    Resolve {
        method: Method,
        id: String,
        name: AppName,
    },
}

pub struct Apps {
    store: Result<AppStore, String>,
}
impl Apps {
    pub fn new(settings: Option<&Path>) -> Self {
        let root = std::env::var_os("PERO_APPS_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                settings
                    .and_then(Path::parent)
                    .unwrap_or(Path::new(".pero"))
                    .join("apps")
            });
        let store = AppStore::open(root).and_then(|mut store| {
            if let Some(catalog) = std::env::var_os("PERO_BUILTIN_APPS_ROOT") {
                store.seed_builtins(Path::new(&catalog))?;
            }
            Ok(store)
        });
        Self { store }
    }

    pub fn dispatch(&mut self, value: serde_json::Value) -> HostEvent {
        let id = value
            .get("id")
            .and_then(|id| id.as_str())
            .filter(|id| !id.is_empty() && id.len() <= 128)
            .map(str::to_owned);
        let mut event = HostEvent::new("apps_result", id.clone(), String::new());
        let result = (|| {
            if id.is_none() {
                return Err("App request needs an id of 1–128 bytes".to_string());
            }
            let request: Request =
                serde_json::from_value(value).map_err(|error| error.to_string())?;
            let store = self.store.as_mut().map_err(|error| error.clone())?;
            match request {
                Request::List { method, id } => {
                    let _ = (method, id);
                    serde_json::to_value(store.list())
                }
                Request::Install { method, id, path } => {
                    let _ = (method, id);
                    serde_json::to_value(store.install(&path)?)
                }
                Request::Enable { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.set_enabled(&name, true)?)
                }
                Request::Disable { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.set_enabled(&name, false)?)
                }
                Request::Uninstall { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.uninstall(&name)?)
                }
                Request::Resolve { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.resolve(&name)?)
                }
            }
            .map_err(|error| error.to_string())
        })();
        event.data = match result {
            Ok(value) => serde_json::json!({"ok":true,"value":value}),
            Err(error) => serde_json::json!({"ok":false,"error":error}),
        };
        event
    }
}
