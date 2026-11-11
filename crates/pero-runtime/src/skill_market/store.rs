//! Files, Git acquisition and inspection are the market's imperative shell.
use super::*;
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Component, Path},
};

pub struct SkillMarketStore {
    root: PathBuf,
    catalog: CatalogLocation,
    harness: String,
    state: SkillMarketState,
    control: AcquisitionControl,
}
#[derive(Clone)]
pub enum CatalogLocation {
    File(PathBuf),
    Bundled(&'static str),
}
#[derive(Deserialize)]
struct Catalog {
    schema_version: u32,
    skills: Vec<SkillCatalogEntry>,
}

impl SkillMarketStore {
    pub fn open(root: PathBuf, catalog: CatalogLocation, harness: String) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let state = match fs::read(root.join("state.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_|"Installed skills state is invalid; restore the profile backup before changing it".to_string())?,
            Err(e) if e.kind()==std::io::ErrorKind::NotFound => SkillMarketState::default(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self {
            root,
            catalog,
            harness,
            state,
            control: AcquisitionControl::default(),
        })
    }
    fn catalog_bytes(&self) -> Result<Vec<u8>, String> {
        let bytes = match &self.catalog {
            CatalogLocation::File(path) => fs::read(path)
                .map_err(|_| "Skill catalog is unavailable; rebuild or update Pero".to_string())?,
            CatalogLocation::Bundled(content) => content.as_bytes().to_vec(),
        };
        if bytes.len() > 64 * 1024 * 1024 {
            return Err("Skill catalog exceeds 64 MiB".into());
        }
        Ok(bytes)
    }
    fn entry(&self, id: &str) -> Result<SkillCatalogEntry, String> {
        Self::read_entry(&self.catalog_bytes()?, id)
    }
    pub fn catalog_location(&self) -> CatalogLocation {
        self.catalog.clone()
    }
    pub fn read_entry(bytes: &[u8], id: &str) -> Result<SkillCatalogEntry, String> {
        Self::index_catalog(bytes)?
            .remove(id)
            .ok_or_else(|| "Skill is not in this catalog".into())
            .and_then(Self::accept_entry)
    }
    pub fn index_catalog(bytes: &[u8]) -> Result<HashMap<String, SkillCatalogEntry>, String> {
        let catalog: Catalog = serde_json::from_slice(bytes)
            .map_err(|error| format!("Invalid skill catalog: {error}"))?;
        if catalog.schema_version != 1 {
            return Err("Unsupported skill catalog version".into());
        }
        let mut entries = HashMap::new();
        for entry in catalog.skills {
            if entries.insert(entry.id.clone(), entry).is_some() {
                return Err("Duplicate skill identity in catalog".into());
            }
        }
        Ok(entries)
    }
    pub fn accept_entry(entry: SkillCatalogEntry) -> Result<SkillCatalogEntry, String> {
        let source = &entry.source;
        if source.repository.split('/').count() != 2
            || source.repository.split('/').any(|value| {
                value.is_empty()
                    || value.starts_with('.')
                    || !value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
            })
            || source.path.is_empty()
            || source.path.contains(['\\', '!', '\0', ':'])
            || !Path::new(&source.path)
                .components()
                .all(|component| matches!(component, Component::Normal(_)))
            || Path::new(&source.path)
                .file_name()
                .and_then(|name| name.to_str())
                != Some("SKILL.md")
            || !hex(&source.commit, 40)
            || !hex(&source.sha256, 64)
        {
            return Err("Selected source is not a supported pinned Git skill; archive members require a separate adapter".into());
        }
        entry.installable()?;
        Ok(entry)
    }
    pub fn prepare(&self, request: &Request) -> Result<SkillAcquisition, String> {
        let id = request
            .acquisition_id()
            .ok_or("This request is not an acquisition")?;
        let entry = self.entry(id)?;
        self.prepare_entry(request, entry)
    }
    pub fn prepare_entry(
        &self,
        request: &Request,
        entry: SkillCatalogEntry,
    ) -> Result<SkillAcquisition, String> {
        let entry = Self::accept_entry(entry)?;
        let id = request
            .acquisition_id()
            .ok_or("This request is not an acquisition")?;
        if entry.id != id {
            return Err("Skill is not in this catalog".into());
        }
        let kind = match request {
            Request::Install { .. } => AcquisitionKind::Install,
            Request::Update { .. } => AcquisitionKind::Update,
            _ => AcquisitionKind::CheckUpdate,
        };
        let installed = if matches!(kind, AcquisitionKind::Install) {
            self.state.items.get(id)
        } else {
            Some(self.state.items.get(id).ok_or("Skill is not installed")?)
        };
        let current_revision = installed.map(|record| record.revision.clone());
        let installed_sha256 = installed
            .map(|record| {
                record
                    .current_version()
                    .map(|version| version.sha256.clone())
            })
            .transpose()?
            .unwrap_or_default();
        let (pinned_revision, pinned_sha256) = match request {
            Request::Update {
                revision, sha256, ..
            } => {
                if !hex(revision, 40) || !hex(sha256, 64) {
                    return Err("Update requires the observed revision and content digest".into());
                }
                (
                    Some(revision.to_ascii_lowercase()),
                    Some(sha256.to_ascii_lowercase()),
                )
            }
            _ => (None, None),
        };
        self.control.begin(id)?;
        Ok(SkillAcquisition {
            entry,
            current_revision,
            installed_sha256,
            pinned_revision,
            pinned_sha256,
            kind,
            root: self.root.clone(),
            harness: self.harness.clone(),
            control: self.control.clone(),
        })
    }
    pub fn complete(
        &mut self,
        job: &SkillAcquisition,
        result: AcquisitionResult,
    ) -> Result<serde_json::Value, String> {
        job.publish(||match result{
            AcquisitionResult::Installed(version)=>{self.save(self.state.publish(version))?;Ok(self.installed())}
            AcquisitionResult::Upstream{latest_revision,latest_sha256}=>{
                let current=job.current_revision.as_ref().ok_or("Skill is not installed")?;
                let update_available=!current.eq_ignore_ascii_case(&latest_revision)||!job.installed_sha256.eq_ignore_ascii_case(&latest_sha256);
                Ok(serde_json::json!({"id":job.entry.id,"currentRevision":current,"latestRevision":latest_revision,"latestSha256":latest_sha256,"updateAvailable":update_available}))
            }
        })
    }
    fn save(&mut self, next: SkillMarketState) -> Result<(), String> {
        let path = self.root.join("state.json");
        let pending = self
            .root
            .join(format!(".state-{}.pending", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&pending)
                .map_err(|e| e.to_string())?;
            let bytes = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
            file.write_all(&bytes)
                .and_then(|_| file.sync_all())
                .map_err(|e| e.to_string())?;
            fs::rename(&pending, &path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&pending);
        }
        result?;
        self.state = next;
        Ok(())
    }
    fn installed(&self) -> serde_json::Value {
        let items=self.state.items.values().map(|item|{
            let mut value=serde_json::json!({"id":item.id,"revision":item.revision,"enabled":item.enabled,"selected":item.selected,"invocation":item.invocation,"entry":item.entry,"versions":item.versions.iter().map(|version|&version.revision).collect::<Vec<_>>()});
            if let Some(revision)=&item.previous_revision{value["previousRevision"]=serde_json::json!(revision);}
            value
        }).collect::<Vec<_>>();
        serde_json::json!({"items":items,"supportedAgent":"pero"})
    }
    pub fn context_candidates(
        &self,
        query: &str,
    ) -> Result<Vec<pero_contracts::context::ContextCandidate>, String> {
        Ok(self
            .state
            .installed_versions()?
            .iter()
            .filter_map(|version| version.context_candidate(query))
            .collect())
    }
    pub fn context_version(&self, source: &str) -> Result<SkillVersion, String> {
        self.state
            .installed_versions()?
            .into_iter()
            .find(|version| version.context_source() == source)
            .ok_or_else(|| {
                "This installed skill version is no longer available; refresh the context picker"
                    .into()
            })
    }
    pub fn resolve_context(
        &self,
        source: &str,
    ) -> Result<pero_contracts::context::ContextReference, String> {
        read_installed_context(&self.context_version(source)?)
    }
    pub fn selections(&self) -> Result<Vec<SkillSelection>, String> {
        self.state.selections()
    }
    pub fn acquisition_control(&self) -> AcquisitionControl {
        self.control.clone()
    }
    pub fn request(&mut self, request: Request) -> Result<serde_json::Value, String> {
        if request.acquisition_id().is_some() {
            let job = self.prepare(&request)?;
            let result = job.run()?;
            return self.complete(&job, result);
        }
        match request {
            Request::Cancel { id } => {
                self.control.cancel(&id)?;
                return Ok(serde_json::json!({"cancelled":true}));
            }
            Request::Catalog => {
                return serde_json::from_slice(&self.catalog_bytes()?).map_err(|e| e.to_string());
            }
            Request::Installed => {}
            Request::Enable { id, enabled } => {
                self.control.ensure_idle(&id)?;
                self.save(self.state.enable(&id, enabled)?)?;
            }
            Request::Remove { id } => {
                self.control.ensure_idle(&id)?;
                self.save(self.state.remove(&id)?)?;
            }
            Request::Rollback { id, revision } => {
                self.control.ensure_idle(&id)?;
                self.save(self.state.rollback(&id, revision.as_deref())?)?;
            }
            _ => return Err("Acquisition must run outside the installed state lock".into()),
        }
        Ok(self.installed())
    }
}
pub fn read_installed_context(
    version: &SkillVersion,
) -> Result<pero_contracts::context::ContextReference, String> {
    const MAX_SKILL_CONTEXT_BYTES: usize = 128_001;
    let file = fs::File::open(version.skill_file()).map_err(
        |_| "Installed skill file is unavailable; reinstall it before selecting context",
    )?;
    let mut bytes = Vec::new();
    file.take(MAX_SKILL_CONTEXT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Installed skill context must be readable")?;
    if bytes.len() > MAX_SKILL_CONTEXT_BYTES {
        return Err("Installed skill file exceeds the context size limit".into());
    }
    let text = String::from_utf8(bytes)
        .map_err(|_| "Installed skill context must be UTF-8 text".to_string())?;
    version.context_reference(text)
}
pub(super) fn hex(value: &str, length: usize) -> bool {
    value.len() == length && value.bytes().all(|c| c.is_ascii_hexdigit())
}

#[cfg(test)]
mod context_tests {
    use super::*;
    use pero_contracts::context::ContextContent;
    use sha2::{Digest, Sha256};

    #[test]
    fn installed_context_tracks_current_version_without_global_activation() {
        let root =
            std::env::temp_dir().join(format!("pero-market-context-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let version = |revision: &str, body: &str| {
            let mut entry: SkillCatalogEntry = serde_json::from_str(r#"{"id":"fixture/research/SKILL.md","name":"evidence-read","title_zh":"Evidence review","description":"Analyze research findings","description_zh":"Secondary keyword","kind":"research_skill","source":{"repository":"fixture/research","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"skills/evidence/SKILL.md","sha256":"unused"},"license":{"spdx":"MIT","status":"declared_in_skill","evidence_url":"https://example.invalid/LICENSE"}}"#).unwrap();
            let directory = root.join(revision);
            fs::create_dir_all(directory.join("source/skills/evidence")).unwrap();
            fs::write(directory.join("source/skills/evidence/SKILL.md"), body).unwrap();
            let sha256 = format!("{:x}", Sha256::digest(body.as_bytes()));
            entry.source.commit = revision.into();
            entry.source.sha256 = sha256.clone();
            SkillVersion {
                revision: revision.into(),
                sha256,
                invocation: "market:evidence-read".into(),
                directory,
                adapter_version: 2,
                entry,
            }
        };
        let old = version(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "OLD_INSTRUCTIONS",
        );
        let new = version(
            "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "NEW_INSTRUCTIONS",
        );
        let mut store = SkillMarketStore::open(
            root.clone(),
            CatalogLocation::Bundled("{}"),
            "unused-harness".into(),
        )
        .unwrap();
        store
            .save(SkillMarketState::default().publish(old.clone()))
            .unwrap();
        assert!(store.selections().unwrap().is_empty());
        assert!(store.context_candidates("uninstalled").unwrap().is_empty());
        for query in ["", "EVIDENCE", "Analyze", "Secondary", "fixture/research"] {
            assert_eq!(store.context_candidates(query).unwrap().len(), 1, "{query}");
        }
        let source = store.context_candidates("").unwrap()[0].source.clone();
        let frozen = store.resolve_context(&source).unwrap();
        let ContextContent::Text { text } = &frozen.content else {
            panic!("Expected text context")
        };
        assert!(text.contains("OLD_INSTRUCTIONS"));
        assert!(text.contains(&old.revision));
        assert!(text.contains(&old.directory.join("source").display().to_string()));
        store.save(store.state.publish(new.clone())).unwrap();
        assert!(store.resolve_context(&source).is_err());
        let current = store.context_candidates("").unwrap()[0].source.clone();
        assert!(current.ends_with(&new.revision));
        assert_ne!(current, source);
        store
            .request(Request::Rollback {
                id: old.entry.id.clone(),
                revision: None,
            })
            .unwrap();
        assert_eq!(store.context_candidates("").unwrap()[0].source, source);
        store
            .request(Request::Remove {
                id: old.entry.id.clone(),
            })
            .unwrap();
        assert!(store.context_candidates("").unwrap().is_empty());
        assert!(store.resolve_context(&source).is_err());
        assert!(text.contains("OLD_INSTRUCTIONS"));
        assert!(old.skill_file().exists());
        let oversized = "A".repeat(128_002);
        let truncated = &oversized[..128_001];
        let mut large = old.clone();
        large.revision = "cccccccccccccccccccccccccccccccccccccccc".into();
        large.sha256 = format!("{:x}", Sha256::digest(truncated.as_bytes()));
        large.entry.source.commit = large.revision.clone();
        large.entry.source.sha256 = large.sha256.clone();
        fs::create_dir_all(large.directory.join("source/skills/evidence")).unwrap();
        fs::write(large.skill_file(), &oversized).unwrap();
        store
            .save(SkillMarketState::default().publish(large.clone()))
            .unwrap();
        let oversized_source = store
            .context_candidates("")
            .unwrap()
            .into_iter()
            .find(|item| item.source.ends_with(&large.revision))
            .unwrap()
            .source;
        let oversized_error = store.resolve_context(&oversized_source).unwrap_err();
        assert!(oversized_error.contains("size limit"), "{oversized_error}");
        assert!(!oversized_error.contains("changed"));
        store
            .save(SkillMarketState::default().publish(old.clone()))
            .unwrap();
        fs::write(old.skill_file(), "MODIFIED_INSTRUCTIONS").unwrap();
        assert!(
            store
                .resolve_context(&source)
                .unwrap_err()
                .contains("changed")
        );
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selections_do_not_read_the_catalog() {
        let root =
            std::env::temp_dir().join(format!("pero-market-missing-{}", uuid::Uuid::new_v4()));
        let mut store = SkillMarketStore::open(
            root.join("state"),
            CatalogLocation::File(root.join("missing.json")),
            "unused".into(),
        )
        .unwrap();
        assert!(store.selections().unwrap().is_empty());
        assert!(
            store
                .request(Request::Catalog)
                .unwrap_err()
                .contains("unavailable")
        );
        let _ = fs::remove_dir_all(root);
    }
}
