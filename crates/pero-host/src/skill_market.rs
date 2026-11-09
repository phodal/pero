//! Host adapter for market requests; acquisition runs on the existing App worker.
use super::Apps;
use pero_runtime::skill_market::{
    CatalogLocation, Request, SkillCatalogEntry, SkillMarketStore, SkillSelection, sanitize_catalog,
};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub(super) struct Market {
    store: Arc<Mutex<Result<SkillMarketStore, String>>>,
    /// Copied at open so catalog I/O never waits on the installed-state lock.
    location: Option<CatalogLocation>,
    catalog: Arc<Mutex<Option<Arc<CachedCatalog>>>>,
    control: pero_runtime::skill_market::AcquisitionControl,
}
struct CachedCatalog {
    entries: std::collections::HashMap<String, SkillCatalogEntry>,
    served: Arc<Vec<u8>>,
}
impl Market {
    pub(super) fn shutdown(&self) {
        self.control.shutdown();
    }
    fn load(&self) -> Result<Arc<CachedCatalog>, String> {
        {
            let guard = self.catalog.lock().map_err(|error| error.to_string())?;
            if let Some(cached) = guard.as_ref() {
                return Ok(Arc::clone(cached));
            }
        }
        let Some(location) = self.location.clone() else {
            return Err(self.store_error());
        };
        let bytes = match &location {
            CatalogLocation::File(path) => std::fs::read(path)
                .map_err(|_| "Skill catalog is unavailable; rebuild or update Pero".to_string())?,
            CatalogLocation::Bundled(content) => content.as_bytes().to_vec(),
        };
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("Skill catalog exceeds 64 MiB".into());
        }
        let served = Arc::new(sanitize_catalog(&bytes)?);
        let entries = SkillMarketStore::index_catalog(&bytes)?;
        let cached = Arc::new(CachedCatalog { entries, served });
        let mut guard = self.catalog.lock().map_err(|error| error.to_string())?;
        if guard.is_none() {
            *guard = Some(Arc::clone(&cached));
        }
        Ok(guard.as_ref().map(Arc::clone).unwrap_or(cached))
    }
    fn store_error(&self) -> String {
        self.store
            .lock()
            .ok()
            .and_then(|guard| guard.as_ref().err().cloned())
            .unwrap_or_else(|| "Skill market is unavailable".into())
    }
    fn entry(&self, id: &str) -> Result<SkillCatalogEntry, String> {
        let cached = self.load()?;
        let entry = cached
            .entries
            .get(id)
            .cloned()
            .ok_or("Skill is not in this catalog")?;
        SkillMarketStore::accept_entry(entry)
    }
    pub(crate) fn catalog_document(&self) -> Result<serde_json::Value, String> {
        let cached = self.load()?;
        serde_json::from_slice(&cached.served).map_err(|error| error.to_string())
    }
    pub(crate) fn selections(&self) -> Result<Vec<SkillSelection>, String> {
        let guard = self.store.lock().map_err(|error| error.to_string())?;
        match guard.as_ref() {
            Ok(store) => store.selections(),
            Err(_) => Ok(Vec::new()),
        }
    }
    pub(crate) fn context_candidates(
        &self,
        query: &str,
    ) -> Result<Vec<pero_contracts::context::ContextCandidate>, String> {
        let guard = self.store.lock().map_err(|error| error.to_string())?;
        match guard.as_ref() {
            Ok(store) => store.context_candidates(query),
            Err(_) => Ok(Vec::new()),
        }
    }
}

pub(super) fn open(settings: Option<&Path>) -> Market {
    let root = settings
        .and_then(Path::parent)
        .unwrap_or(Path::new(".pero"))
        .join("skill-market");
    let workspace = std::env::var_os("PERO_AGENT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    let catalog = std::env::var_os("PERO_SKILLS_CATALOG")
        .map(PathBuf::from)
        .unwrap_or_else(|| catalog_path(&workspace));
    let store = (|| {
        let harness = pero_runtime::acp::registry(&workspace)?
            .into_iter()
            .find(|agent| agent.id == "pero")
            .ok_or("Default Pero Harness is unavailable")?
            .command;
        SkillMarketStore::open(root, CatalogLocation::File(catalog.clone()), harness)
    })();
    let location = store.as_ref().ok().map(|_| CatalogLocation::File(catalog));
    let control = store
        .as_ref()
        .map(|store| store.acquisition_control())
        .unwrap_or_default();
    Market {
        store: Arc::new(Mutex::new(store)),
        location,
        catalog: Arc::new(Mutex::new(None)),
        control,
    }
}

fn catalog_path(workspace: &Path) -> PathBuf {
    let packaged = workspace.join("apps/skills/market-catalog.json");
    if packaged.is_file() {
        return packaged;
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            let beside = directory.join("../apps/skills/market-catalog.json");
            if beside.is_file() {
                return beside;
            }
        }
    }
    let reviewed = workspace.join("docs/design-docs/research-skills-catalog.json");
    if reviewed.is_file() {
        return reviewed;
    }
    packaged
}

impl Apps {
    pub(crate) fn skill_market(&self, request: Request) -> Result<serde_json::Value, String> {
        if let Request::Cancel { id } = &request {
            self.market.control.cancel(id)?;
            return Ok(serde_json::json!({"cancelled":true}));
        }
        if matches!(request, Request::Catalog) {
            return self.market.catalog_document();
        }
        if request.acquisition_id().is_some() {
            let entry = self
                .market
                .entry(request.acquisition_id().unwrap_or_default())?;
            let job = {
                let guard = self
                    .market
                    .store
                    .lock()
                    .map_err(|error| error.to_string())?;
                guard
                    .as_ref()
                    .map_err(|error| error.clone())?
                    .prepare_entry(&request, entry)?
            };
            let result = job.run()?;
            let mut guard = self
                .market
                .store
                .lock()
                .map_err(|error| error.to_string())?;
            return guard
                .as_mut()
                .map_err(|error| error.clone())?
                .complete(&job, result);
        }
        let mut guard = self
            .market
            .store
            .lock()
            .map_err(|error| error.to_string())?;
        guard
            .as_mut()
            .map_err(|error| error.clone())?
            .request(request)
    }
    pub(crate) fn market_context_candidates(
        &self,
        query: &str,
    ) -> Result<Vec<pero_contracts::context::ContextCandidate>, String> {
        self.market.context_candidates(query)
    }
    pub(crate) fn resolve_market_context(
        &self,
        source: &str,
    ) -> Result<pero_contracts::context::ContextReference, String> {
        let version = {
            let guard = self
                .market
                .store
                .lock()
                .map_err(|error| error.to_string())?;
            guard
                .as_ref()
                .map_err(|error| error.clone())?
                .context_version(source)?
        };
        pero_runtime::skill_market::read_installed_context(&version)
    }
    pub(crate) fn market_selections(&self) -> Result<Vec<SkillSelection>, String> {
        self.market.selections()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, thread, time::Duration};

    #[test]
    fn unavailable_market_adds_no_session_capability() {
        let market = Market {
            store: Arc::new(Mutex::new(
                Err("Default Pero Harness is unavailable".into()),
            )),
            location: None,
            catalog: Arc::new(Mutex::new(None)),
            control: Default::default(),
        };
        assert!(market.selections().unwrap().is_empty());
        assert!(market.context_candidates("audit").unwrap().is_empty());
        assert!(market.catalog_document().unwrap_err().contains("Harness"));
    }

    #[test]
    fn catalog_load_does_not_wait_on_the_installed_state_lock() {
        let root = std::env::temp_dir().join(format!(
            "pero-market-lock-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let catalog = root.join("catalog.json");
        std::fs::write(&catalog, r#"{"schema_version":1,"skills":[]}"#).unwrap();
        let store = SkillMarketStore::open(
            root.join("state"),
            CatalogLocation::File(catalog.clone()),
            "unused-harness".into(),
        )
        .unwrap();
        let market = Market {
            store: Arc::new(Mutex::new(Ok(store))),
            location: Some(CatalogLocation::File(catalog)),
            catalog: Arc::new(Mutex::new(None)),
            control: Default::default(),
        };
        let _guard = market.store.lock().unwrap();
        let market = market.clone();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            sender
                .send(
                    market
                        .catalog_document()
                        .map(|value| value["schema_version"].as_u64()),
                )
                .ok();
        });
        let loaded = receiver
            .recv_timeout(Duration::from_secs(2))
            .expect("catalog read waited on the installed-state lock");
        assert_eq!(loaded.unwrap(), Some(1));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn packaged_catalog_is_preferred_over_the_source_tree() {
        let root = std::env::temp_dir().join(format!(
            "pero-market-path-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(root.join("apps/skills")).unwrap();
        std::fs::create_dir_all(root.join("docs/design-docs")).unwrap();
        std::fs::write(root.join("apps/skills/market-catalog.json"), "packaged").unwrap();
        std::fs::write(
            root.join("docs/design-docs/research-skills-catalog.json"),
            "reviewed",
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(catalog_path(&root)).unwrap(),
            "packaged"
        );
        std::fs::remove_file(root.join("apps/skills/market-catalog.json")).unwrap();
        assert_eq!(
            std::fs::read_to_string(catalog_path(&root)).unwrap(),
            "reviewed"
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
