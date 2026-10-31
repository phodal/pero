//! Stdio adapter. App rules, installed state and backend lifetime belong to the runtime.
#[path = "point_apps.rs"]
mod point_apps;
use pero_contracts::HostEvent;
use pero_runtime::apps::agent::AgentRequest;
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
    Pointconfig {
        method: Method,
        id: String,
        name: AppName,
        #[serde(default)]
        config: Option<serde_json::Value>,
    },
    Pointprojects {
        method: Method,
        id: String,
        name: AppName,
        request: point_apps::ProjectRequest,
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
    Agent {
        method: Method,
        id: String,
        name: AppName,
        request: AgentRequest,
    },
    Insights {
        method: Method,
        id: String,
        name: AppName,
        #[serde(default, rename = "threadId")]
        thread_id: Option<String>,
    },
    Connectors {
        method: Method,
        id: String,
        name: AppName,
    },
}

#[derive(Clone)]
pub struct Apps {
    store: std::sync::Arc<std::sync::Mutex<Result<AppStore, String>>>,
    builtins: Option<PathBuf>,
    names: Option<Vec<String>>,
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
        let builtins = std::env::var_os("PERO_BUILTIN_APPS_ROOT")
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);
        // Optional comma-separated allow-list; unset seeds every catalog entry.
        let names: Option<Vec<String>> = std::env::var("PERO_BUILTIN_APPS").ok().map(|names| {
            names
                .split(',')
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .map(str::to_owned)
                .collect()
        });
        let store = (|| {
            let python = settings
                .map(pero_runtime::settings::load_app_python)
                .transpose()?
                .unwrap_or_default();
            let required = std::env::var("PERO_REQUIRED_APPS").unwrap_or_default();
            let mut required_names = std::collections::BTreeSet::new();
            for name in required.split(',').map(str::trim).filter(|name| !name.is_empty()) {
                required_names.insert(pero_runtime::apps::AppName::try_from(name.to_owned())?);
            }
            let mut store = AppStore::open_required(root, python, required_names)?;
            if let Some(path) = settings {
                store.remember_settings(path);
            }
            if let Some(catalog) = &builtins {
                store.seed_builtins_only(catalog, names.as_deref())?;
            }
            Ok(store)
        })();
        Self {
            store: std::sync::Arc::new(std::sync::Mutex::new(store)),
            builtins,
            names,
        }
    }

    /// Installers run outside the stdio input loop so Agent traffic and
    /// cancellation remain responsive while pip downloads packages.
    pub fn dispatch_async(&self, value: serde_json::Value, agents: &mut crate::agents::Manager) {
        let action = value["action"].as_str().unwrap_or("");
        if matches!(action, "agent" | "insights" | "connectors" | "disable" | "uninstall") {
            let mut this = self.clone();
            let event = this.dispatch(value, Some(agents));
            let _ = crate::emit(event);
        } else {
            let mut this = self.clone();
            std::thread::spawn(move || { let event = this.dispatch(value, None); let _ = crate::emit(event); });
        }
    }

    pub fn dispatch(
        &mut self,
        value: serde_json::Value,
        mut agents: Option<&mut crate::agents::Manager>,
    ) -> HostEvent {
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
            let mut guard = if agents.is_some() {
                self.store.try_lock().map_err(|_| "An App environment is being prepared; retry when installation finishes".to_string())?
            } else { self.store.lock().map_err(|error| error.to_string())? };
            let store = guard.as_mut().map_err(|error| error.clone())?;
            let mut progress = |value: pero_runtime::apps::AppPreparation| {
                let mut event = HostEvent::new("apps_preparation", id.clone(), value.message.clone());
                event.data = serde_json::to_value(value).expect("App preparation event");
                let _ = crate::emit(event);
            };
            match request {
                Request::List { method, id } => {
                    let _ = (method, id);
                    if let Some(catalog) = &self.builtins {
                        store.seed_builtins_only(catalog, self.names.as_deref())?;
                    }
                    serde_json::to_value(store.list())
                }
                Request::Install { method, id, path } => {
                    let _ = (method, id);
                    let prepared = point_apps::Prepared::new(path)?;
                    serde_json::to_value(store.install(prepared.path())?)
                }
                Request::Pointconfig { method, id, name, config } => {
                    let _ = (method, id);
                    serde_json::to_value(serde_json::json!({"config": store.point_config(&name, config)?}))
                }
                Request::Pointprojects { method, id, name, request } => {
                    let _ = (method, id);
                    let root = store.point_project_root(&name, &request.path)?;
                    return point_apps::projects(&root, request);
                }
                Request::Enable { method, id, name } => {
                    let _ = (method, id);
                    store.prepare(&name, &mut progress)?;
                    serde_json::to_value(store.set_enabled(&name, true).map_err(|error| error.to_string())?)
                }
                Request::Disable { method, id, name } => {
                    let _ = (method, id);
                    let catalog = store.set_enabled(&name, false).map_err(|error| error.to_string())?;
                    agents.as_deref_mut().expect("Host manager").stop_app_sessions(&name);
                    serde_json::to_value(catalog)
                }
                Request::Uninstall { method, id, name } => {
                    let _ = (method, id);
                    let catalog = store.uninstall(&name).map_err(|error| error.to_string())?;
                    agents.as_deref_mut().expect("Host manager").stop_app_sessions(&name);
                    serde_json::to_value(catalog)
                }
                Request::Insights { method, id, name, thread_id } => {
                    let _ = (method, id);
                    store.require_grant(&name, "insights")?;
                    let sessions = match thread_id {
                        Some(thread) => vec![agents.as_deref_mut().expect("Host manager").insights_value(&thread)?],
                        None => agents.as_deref_mut().expect("Host manager").insights_catalog(),
                    };
                    let (repositories, conflicts) = agents.as_deref_mut().expect("Host manager").repository_snapshot();
                    serde_json::to_value(serde_json::json!({
                        "sessions": sessions,
                        "repositories": repositories,
                        "conflicts": conflicts,
                    }))
                }
                Request::Connectors { method, id, name } => {
                    let _ = (method, id);
                    store.require_grant(&name, "connectors")?;
                    Ok(serde_json::json!({"permitted":true}))
                }
                Request::Resolve { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.resolve_with_progress(&name, &mut progress)?)
                }
                Request::Agent {
                    method,
                    id,
                    name,
                    request,
                } => {
                    let _ = (method, id);
                    store.require_agent(&name)?;
                    return agents.as_deref_mut().expect("Host manager").app_request(name, request);
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
