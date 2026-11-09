//! Host adapter for market requests; acquisition runs on the existing App worker.
use super::Apps;
use pero_runtime::skill_market::{CatalogLocation, Request, SkillMarketStore, SkillSelection};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub(super) struct Market {
    store: Arc<Mutex<Result<SkillMarketStore, String>>>,
    control: pero_runtime::skill_market::AcquisitionControl,
}
impl Market {
    pub(super) fn shutdown(&self) {
        self.control.shutdown();
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
        .map(|path| CatalogLocation::File(PathBuf::from(path)))
        .unwrap_or(CatalogLocation::Bundled(include_str!(
            "../../../docs/design-docs/research-skills-catalog.json"
        )));
    let store = (|| {
        let harness = pero_runtime::acp::registry(&workspace)?
            .into_iter()
            .find(|a| a.id == "pero")
            .ok_or("Default Pero Harness is unavailable")?
            .command;
        SkillMarketStore::open(root, catalog, harness)
    })();
    let control = store
        .as_ref()
        .map(|store| store.acquisition_control())
        .unwrap_or_default();
    Market {
        store: Arc::new(Mutex::new(store)),
        control,
    }
}

impl Apps {
    pub(crate) fn skill_market(&self, request: Request) -> Result<serde_json::Value, String> {
        if let Request::Cancel { id } = &request {
            self.market.control.cancel(id)?;
            return Ok(serde_json::json!({"cancelled":true}));
        }
        if request.acquisition_id().is_some() {
            let job = {
                let guard = self.market.store.lock().map_err(|e| e.to_string())?;
                guard.as_ref().map_err(|e| e.clone())?.prepare(&request)?
            };
            let result = job.run()?;
            let mut guard = self.market.store.lock().map_err(|e| e.to_string())?;
            return guard
                .as_mut()
                .map_err(|e| e.clone())?
                .complete(&job, result);
        }
        let mut guard = self.market.store.lock().map_err(|e| e.to_string())?;
        guard.as_mut().map_err(|e| e.clone())?.request(request)
    }
    pub(crate) fn market_context_candidates(
        &self,
        query: &str,
    ) -> Result<Vec<pero_contracts::context::ContextCandidate>, String> {
        let guard = self.market.store.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .map_err(|e| e.clone())?
            .context_candidates(query)
    }
    pub(crate) fn resolve_market_context(
        &self,
        source: &str,
    ) -> Result<pero_contracts::context::ContextReference, String> {
        let guard = self.market.store.lock().map_err(|e| e.to_string())?;
        guard
            .as_ref()
            .map_err(|e| e.clone())?
            .resolve_context(source)
    }
    pub(crate) fn market_selections(&self) -> Result<Vec<SkillSelection>, String> {
        let guard = self.market.store.try_lock().map_err(|_| {
            "A skill operation is running; retry creating the conversation after it finishes"
        })?;
        guard.as_ref().map_err(|e| e.clone())?.selections()
    }
}
