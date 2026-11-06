//! Stdio adapter. App rules, installed state and backend lifetime belong to the runtime.
pub(crate) const APP_PREPARING: &str = "An App environment is being prepared; retry when installation finishes";
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
    Localenvironment { method: Method, id: String, name: AppName, request: pero_runtime::apps::local_environment::Request },
    Environment {
        method: Method,
        id: String,
        name: AppName,
        target: pero_runtime::apps::ScientificMethod,
    },
    Install {
        method: Method,
        id: String,
        path: PathBuf,
    },
    Pluginlist { method: Method, id: String },
    Plugininstall { method: Method, id: String, path: PathBuf },
    Pluginenable { method: Method, id: String, name: AppName, enabled: bool },
    Agentrun { method: Method, id: String, name: AppName, request: pero_runtime::apps::agent_run::Request },
    Apiaccess { method: Method, id: String, name: AppName, path: String },
    Sdkcontext { method: Method, id: String, name: AppName },
    Agentcatalog { method: Method, id: String, name: AppName, path: String },
    Prepare { method: Method, id: String, name: AppName },
    Doclingruntime { method: Method, id: String, name: AppName, request: pero_runtime::apps::docling_runtime::Request },
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
    #[serde(rename = "resolve_static")]
    ResolveStatic {
        method: Method,
        id: String,
        name: AppName,
    },
    Projectresources {
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
    Reproduction {
        method: Method,
        id: String,
        name: AppName,
        request: crate::paper_reproduction::ReproductionRequest,
    },
    #[serde(rename = "research-assets")]
    ResearchAssets {
        method: Method,
        id: String,
        name: AppName,
        request: crate::research_assets::ResearchAssetsRequest,
    },
}

#[derive(Clone)]
pub struct Apps {
    store: std::sync::Arc<std::sync::Mutex<Result<AppStore, String>>>,
    builtins: Option<PathBuf>,
    names: Option<Vec<String>>,
    shutting_down: std::sync::Arc<std::sync::atomic::AtomicBool>,
}
pub struct AppsShutdown(Apps);
impl Drop for AppsShutdown { fn drop(&mut self) { self.0.shutdown(); } }
impl Apps {
    pub(crate) fn check_research(&self, record_id: &str) -> Result<serde_json::Value, String> {
        let (paper, data) = {
            let mut guard = self.store.lock().map_err(|error| error.to_string())?;
            let store = guard.as_mut().map_err(|error| error.clone())?;
            let name = AppName::try_from("paper-agent".to_owned())?;
            store.require_grant(&name, "research-assets")?;
            let paper = store.resolve_with_progress(&name, &mut |_| {})?.backend.ok_or("Paper has no backend")?;
            let data = store.resolve_with_progress(&AppName::try_from("data".to_owned())?, &mut |_| {}).ok().and_then(|value| value.backend);
            (paper, data)
        };
        crate::research_assets::watch(&paper, data.as_ref(), record_id)
    }
    pub fn shutdown_guard(&self) -> AppsShutdown { AppsShutdown(self.clone()) }
    fn shutdown(&self) {
        self.shutting_down.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Ok(guard) = self.store.lock() { if let Ok(store) = guard.as_ref() { store.shutdown_docling_runtime(); } }
    }
    pub(crate) fn agent_panel(&self, name: &AppName) -> Result<String, String> {
        let guard = self.store.try_lock().map_err(|_| APP_PREPARING)?;
        guard.as_ref().map_err(Clone::clone)?.agent_panel(name)
    }
    pub(crate) fn session_plugins(&self, name: &AppName, panel: &str) -> Result<Option<pero_runtime::apps::AppSessionPlugins>, String> {
        let guard = self.store.try_lock().map_err(|_| APP_PREPARING)?;
        guard.as_ref().map_err(Clone::clone)?.session_plugins(name, panel)
    }
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
            shutting_down: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub(crate) fn require_grant(&self, name: &AppName, grant: &str) -> Result<(), String> {
        let guard=self.store.try_lock().map_err(|_|APP_PREPARING.to_string())?;
        guard.as_ref().map_err(Clone::clone)?.require_grant(name,grant)
    }

    /// Installers run outside the stdio input loop so Agent traffic and
    /// cancellation remain responsive while pip downloads packages.
    pub fn dispatch_async(&self, value: serde_json::Value, agents: &mut crate::agents::Manager) {
        let action = value["action"].as_str().unwrap_or("");
        if matches!(action, "agentrun" | "agentcatalog" | "agent" | "insights" | "connectors" | "disable" | "uninstall" | "pluginenable") {
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
            if let Request::Localenvironment { ref name, request: pero_runtime::apps::local_environment::Request::Prepare {ref id}, .. } = request {
                let job={let guard=self.store.lock().map_err(|e|e.to_string())?;guard.as_ref().map_err(Clone::clone)?.environment_preparation(name,id)?};
                job.run(&mut |_| {})?;
                let guard=self.store.lock().map_err(|e|e.to_string())?;
                return serde_json::to_value(guard.as_ref().map_err(Clone::clone)?.local_environments(name,pero_runtime::apps::local_environment::Request::List)?).map_err(|e|e.to_string());
            }
            let mut guard = if agents.is_some() {
                self.store.try_lock().map_err(|_| APP_PREPARING.to_string())?
            } else { self.store.lock().map_err(|error| error.to_string())? };
            if self.shutting_down.load(std::sync::atomic::Ordering::SeqCst) { return Err("Host is shutting down".into()); }
            let store = guard.as_mut().map_err(|error| error.clone())?;
            let mut progress = |value: pero_runtime::apps::AppPreparation| {
                let mut event = HostEvent::new("apps_preparation", id.clone(), value.message.clone());
                event.data = serde_json::to_value(value).expect("App preparation event");
                let _ = crate::emit(event);
            };
            match request {
                Request::Pluginlist { method, id } => {
                    let _ = (method, id);
                    serde_json::to_value(store.agent_plugins()?.list())
                }
                Request::Plugininstall { method, id, path } => {
                    let _ = (method, id);
                    serde_json::to_value(store.agent_plugins()?.install(&path)?)
                }
                Request::Pluginenable { method, id, name, enabled } => {
                    let _ = (method, id);
                    let mut plugins = store.agent_plugins()?;
                    plugins.set_enabled(&name, enabled)?;
                    if !enabled { agents.as_deref_mut().expect("Host manager").stop_plugin_sessions(&name); }
                    serde_json::to_value(plugins.list())
                }
                Request::Apiaccess {method,id,name,path} => {
                    let _=(method,id);store.require_api(&name,&path)?;Ok(serde_json::json!({"permitted":true}))
                }
                Request::Sdkcontext { method, id, name } => {
                    let _ = (method, id); serde_json::to_value(store.sdk_context(&name)?)
                }
                Request::Localenvironment { method, id, name, request } => {
                    let _=(method,id);
                    let values=match request {
                        pero_runtime::apps::local_environment::Request::Bind{id} => store.bind_local_environment(&name,id)?,
                        other => store.local_environments(&name,other)?,
                    };
                    serde_json::to_value(values)
                }
                Request::Environment { method, id, name, target } => {
                    let _ = (method, id);
                    serde_json::to_value(store.inspect_environment_for(&name, target)?)
                }
                Request::List { method, id } => {
                    let _ = (method, id);
                    if let Some(catalog) = &self.builtins {
                        store.seed_builtins_only(catalog, self.names.as_deref())?;
                    }
                    serde_json::to_value(store.list())
                }
                Request::Install { method, id, path } => {
                    let _ = (method, id);
                    serde_json::to_value(store.install(&path)?)
                }
                Request::Agentrun { method,id,name,request } => {
                    let _=(method,id);
                    if let pero_runtime::apps::agent_run::Request::Prepare {scope,input} = request {
                        agents.as_deref_mut().expect("Host manager").run_scope(&scope)?;
                        return Ok(serde_json::json!({"context":store.prepare_agent_context(&name,input)?}));
                    }
                    let panel=store.agent_panel(&name)?;
                    let revision=store.agent_declaration_revision(&name)?;
                    if let pero_runtime::apps::agent_run::Request::Start {ref context,..} = request {store.validate_agent_context(&name,context.as_ref())?;}
                    drop(guard);
                    return agents.as_deref_mut().expect("Host manager").agent_run_request(name,panel,revision,request);
                }
                Request::Agentcatalog { method,id,name,path } => {
                    let _=(method,id);store.agent_catalog_permission(&name,&path)?;
                    return agents.as_deref_mut().expect("Host manager").agent_catalog(&path);
                }
                Request::Prepare { method, id, name } => {
                    let _ = (method, id);
                    store.prepare(&name, &mut progress)?;
                    serde_json::to_value(store.list())
                }
                Request::Enable { method, id, name } => {
                    let _ = (method, id);
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
                Request::Doclingruntime { method, id, name, request } => {
                    let _ = (method, id);
                    let runtime = store.docling_runtime(&name)?;
                    drop(guard);
                    return runtime.execute(request);
                }
                Request::Reproduction { method, id, name, request } => {
                    let _ = (method, id);
                    let handoff = crate::paper_reproduction::PaperReproduction::resolve(store, &name)?;
                    drop(guard);
                    return handoff.execute(request);
                }
                Request::ResearchAssets { method, id, name, request } => {
                    let _ = (method, id);
                    let handoff = crate::research_assets::ResearchAssetHandoff::resolve(store, &name, &mut progress)?;
                    // Backend authority is frozen above; do not hold the catalog lock during I/O.
                    drop(guard);
                    return handoff.execute(request);
                }
                Request::Resolve { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.resolve_with_progress(&name, &mut progress)?)
                }
                Request::ResolveStatic { method, id, name } => {
                    let _ = (method, id);
                    serde_json::to_value(store.resolve_static(&name)?)
                }
                Request::Projectresources { method, id, name } => {
                    let _ = (method, id);
                    let catalog = crate::project_resources::ProjectResources::resolve(store, &name, &mut progress)?;
                    drop(guard);
                    return serde_json::to_value(catalog.read()?).map_err(|error| error.to_string());
                }
                Request::Agent {
                    method,
                    id,
                    name,
                    request,
                } => {
                    let _ = (method, id);
                    store.require_agent(&name)?;
                    drop(guard);
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

#[cfg(test)]
mod tests {
    use super::Request;

    #[test]
    fn renderer_mixed_method_action_cannot_select_private_reproduction() {
        for request in [
            serde_json::json!({"method":"apps","id":"forged","action":"list_agents"}),
            serde_json::json!({"method":"settings.workbench","id":"forged","action":"reproduction",
                "name":"paper-agent","request":{"operation":"prepare","itemId":"a".repeat(64),
                "specId":"b".repeat(64),"requestId":"forged"}}),
        ] {
            assert!(serde_json::from_value::<Request>(request).is_err());
        }
    }

    #[test]
    fn optional_runtime_requires_private_apps_method_and_fixed_request() {
        let valid = serde_json::json!({"method":"apps","id":"setup","action":"doclingruntime","name":"paper-agent","request":{"operation":"prepare","component":"model"}});
        assert!(matches!(serde_json::from_value::<Request>(valid.clone()), Ok(Request::Doclingruntime { .. })));
        let mut mixed = valid.clone(); mixed["method"] = serde_json::json!("settings.workbench");
        assert!(serde_json::from_value::<Request>(mixed).is_err());
        let mut arbitrary = valid; arbitrary["request"]["url"] = serde_json::json!("https://example.org/package");
        assert!(serde_json::from_value::<Request>(arbitrary).is_err());
    }

    #[test]
    fn app_request_surface_accepts_pero_install_and_rejects_removed_adapters() {
        let install = serde_json::json!({"method":"apps","id":"install","action":"install","path":"local-app"});
        assert!(matches!(serde_json::from_value::<Request>(install), Ok(Request::Install { .. })));
        let research = serde_json::json!({"method":"apps","id":"assets","action":"research-assets","name":"paper-agent",
            "request":{"operation":"status","bundleId":"a".repeat(64)}});
        assert!(matches!(serde_json::from_value::<Request>(research), Ok(Request::ResearchAssets { .. })));
        for action in ["pointconfig", "pointprojects"] {
            let request = serde_json::json!({"method":"apps","id":"removed","action":action,"name":"sample"});
            assert!(serde_json::from_value::<Request>(request).is_err());
        }
    }
}
