//! Local App packages and the single owner of their installed state and backends.
pub mod agent;
mod builtins;
use builtins::BuiltinDiscovery;
mod definition;
mod process;
mod tenure;
use tenure::{StoreError, Tenure, TenureAsk, permit};
mod python;
pub use definition::{AppDefinition, AppName, AppSummary};
use process::AppProcess;
pub use process::BackendAccess;
pub use python::{PythonEnvironment, PythonEnvironments};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct InstallRecord {
    enabled: bool,
}

struct AppInstallation {
    definition: AppDefinition,
    enabled: bool,
}

#[derive(Serialize)]
pub struct AppAccess {
    pub root: PathBuf,
    pub entry: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backend: Option<BackendAccess>,
}

/// Imperative shell: owns disk state and backend children. Domain declarations
/// are parsed once, at install or startup, before entering this store.
pub struct AppStore {
    root: PathBuf,
    data: PathBuf,
    installed: BTreeMap<AppName, AppInstallation>,
    processes: BTreeMap<AppName, AppProcess>,
    python: PythonEnvironments,
    builtins: BuiltinDiscovery,
    required: std::collections::BTreeSet<AppName>,
}

impl AppStore {
    pub fn open(root: PathBuf, python: PythonEnvironments) -> Result<Self, String> {
        Self::open_required(root, python, std::collections::BTreeSet::new())
    }

    /// `required` comes from the product. It is not read from a manifest or an installation file.
    pub fn open_required(
        root: PathBuf,
        python: PythonEnvironments,
        required: std::collections::BTreeSet<AppName>,
    ) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|error| error.to_string())?;
        let root = dunce::canonicalize(root).map_err(|error| error.to_string())?;
        let data = root
            .parent()
            .ok_or("App root needs a parent directory")?
            .join("app-data");
        let mut installed = BTreeMap::new();
        for entry in fs::read_dir(&root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let Some(directory) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if directory.starts_with('.') {
                continue;
            }
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                continue;
            }
            let record_path = entry.path().join(".installation.json");
            if !record_path.is_file() {
                continue;
            }
            let definition = AppDefinition::parse(
                &fs::read(entry.path().join("app.json")).map_err(|error| error.to_string())?,
            )?;
            if definition.name.as_str() != directory {
                return Err("Installed App identity differs from its directory".into());
            }
            let record: InstallRecord =
                serde_json::from_slice(&fs::read(record_path).map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())?;
            installed.insert(
                definition.name.clone(),
                AppInstallation {
                    definition,
                    enabled: record.enabled,
                },
            );
        }
        for name in &required {
            let Some(app) = installed.get_mut(name) else {
                continue;
            };
            if app.enabled {
                continue;
            }
            write_record(&root.join(name.as_str()), true)?;
            app.enabled = true;
        }
        let receipt = root.join(".builtin-discovery.json");
        let builtins = if receipt.is_file() {
            serde_json::from_slice(&fs::read(receipt).map_err(|error| error.to_string())?)
                .map_err(|error| error.to_string())?
        } else {
            BuiltinDiscovery::migrate(
                root.join(".builtins-seeded").exists(),
                installed.keys().cloned(),
            )
        };
        Ok(Self {
            root,
            data,
            installed,
            processes: BTreeMap::new(),
            python,
            builtins,
            required,
        })
    }

    pub fn list(&self) -> Vec<AppSummary> {
        self.installed
            .values()
            .map(|app| {
                let mut summary = app.definition.summary(app.enabled);
                summary.tenure = self.tenure_of(&app.definition.name);
                summary
            })
            .collect()
    }

    fn tenure_of(&self, name: &AppName) -> Tenure {
        if self.required.contains(name) {
            Tenure::Required
        } else {
            Tenure::Optional
        }
    }

    pub fn require_agent(&self, name: &AppName) -> Result<(), String> {
        self.require_grant(name, "agent")
            .map_err(|_| {
                "Enable this App with its declared agent permission before starting research"
                    .to_string()
            })
    }

    pub fn require_grant(&self, name: &AppName, grant: &str) -> Result<(), String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if !app.enabled
            || !app
                .definition
                .permissions
                .host
                .iter()
                .any(|held| held == grant)
        {
            return Err("This App cannot call that Host command".into());
        }
        Ok(())
    }

    /// Discover new trusted builtin identities while retaining user choices.
    pub fn seed_builtins(&mut self, catalog: &Path) -> Result<(), String> {
        self.seed_builtins_only(catalog, None)
    }

    /// Seeds builtin Apps from `catalog`, optionally limited to `names`.
    ///
    /// A single unreadable or incomplete builtin package (for example one
    /// whose `dist/` was never built) is skipped with a warning and is not
    /// recorded as discovered, so it is offered once it becomes valid. It
    /// does not hide the other builtins.
    pub fn seed_builtins_only(
        &mut self,
        catalog: &Path,
        names: Option<&[String]>,
    ) -> Result<(), String> {
        if !catalog.is_dir() {
            return Ok(());
        }
        for entry in fs::read_dir(catalog).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
                || !entry.path().join("app.json").is_file()
            {
                continue;
            }
            if let Some(names) = names
                && !names.iter().any(|name| entry.file_name() == name.as_str())
            {
                continue;
            }
            let seeded = (|| {
                let source = entry.path();
                let definition = AppDefinition::parse(
                    &fs::read(source.join("app.json")).map_err(|error| error.to_string())?,
                )?;
                let name = definition.name.clone();
                let stamp = package_stamp(&source)?;
                let needed = self.required.contains(&name);
                if self.installed.contains_key(&name) {
                    // The catalog is the source of the builtin. Enable state and
                    // domain data stay; package bytes follow the bundled tree.
                    if self.read_builtin_stamp(&name).as_deref() != Some(stamp.as_str()) {
                        self.refresh_builtin(&source, definition, &stamp)?;
                    }
                    if needed && !self.installed.get(&name).is_some_and(|app| app.enabled) {
                        self.set_enabled(&name, true).map_err(|error| error.to_string())?;
                    }
                } else if needed || self.builtins.should_install(&name, false) {
                    self.install_package(&source, definition)?;
                    self.set_enabled(&name, true).map_err(|error| error.to_string())?;
                    self.write_builtin_stamp(&name, &stamp)?;
                }
                Ok::<_, String>(name)
            })();
            let name = match seeded {
                Ok(name) => name,
                Err(error) => {
                    eprintln!(
                        "warning: skipping builtin App {}: {error}",
                        entry.path().display()
                    );
                    continue;
                }
            };
            // Persist each discovery so later package failures do not forget
            // identities already offered to this profile.
            if self.builtins.record(name) {
                self.save_builtin_discovery()?;
            }
        }
        if !self.root.join(".builtin-discovery.json").is_file() {
            self.save_builtin_discovery()?;
        }
        Ok(())
    }

    fn save_builtin_discovery(&self) -> Result<(), String> {
        let pending = self.root.join(".builtin-discovery.pending");
        fs::write(
            &pending,
            serde_json::to_vec(&self.builtins).map_err(|error| error.to_string())?,
        )
        .and_then(|_| fs::rename(pending, self.root.join(".builtin-discovery.json")))
        .map_err(|error| error.to_string())
    }

    pub fn install(&mut self, source: &Path) -> Result<Vec<AppSummary>, String> {
        let definition = AppDefinition::parse(
            &fs::read(source.join("app.json")).map_err(|error| error.to_string())?,
        )?;
        self.install_package(source, definition)?;
        Ok(self.list())
    }

    fn install_package(
        &mut self,
        source: &Path,
        definition: AppDefinition,
    ) -> Result<AppName, String> {
        let target = self.root.join(definition.name.as_str());
        if target.exists() {
            return Err(
                "App is already installed; uninstall it before installing another version".into(),
            );
        }
        let staging = self.stage_package(source, &definition, false)?;
        if let Err(error) = fs::rename(&staging, &target) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error.to_string());
        }
        let name = definition.name.clone();
        self.installed.insert(
            name.clone(),
            AppInstallation {
                definition,
                enabled: false,
            },
        );
        Ok(name)
    }

    /// Replace an installed builtin's files. The enable flag and `app-data` stay.
    fn refresh_builtin(
        &mut self,
        source: &Path,
        definition: AppDefinition,
        stamp: &str,
    ) -> Result<(), String> {
        let name = definition.name.clone();
        let enabled = self
            .installed
            .get(&name)
            .map(|app| app.enabled)
            .unwrap_or(false);
        self.processes.remove(&name);
        let staging = self.stage_package(source, &definition, enabled)?;
        let target = self.root.join(name.as_str());
        let backup = self.root.join(format!(".refresh-{}", uuid::Uuid::new_v4()));
        if let Err(error) = fs::rename(&target, &backup) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error.to_string());
        }
        if let Err(error) = fs::rename(&staging, &target) {
            let _ = fs::rename(&backup, &target);
            let _ = fs::remove_dir_all(&staging);
            return Err(error.to_string());
        }
        let _ = fs::remove_dir_all(&backup);
        self.write_builtin_stamp(&name, stamp)?;
        self.installed.insert(
            name,
            AppInstallation {
                definition,
                enabled,
            },
        );
        Ok(())
    }

    fn stage_package(
        &self,
        source: &Path,
        definition: &AppDefinition,
        enabled: bool,
    ) -> Result<PathBuf, String> {
        if fs::symlink_metadata(source)
            .map_err(|error| error.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("App installation source cannot be a symlink".into());
        }
        let source = dunce::canonicalize(source).map_err(|error| error.to_string())?;
        if source.starts_with(&self.root) || self.root.starts_with(&source) {
            return Err("App source and managed installation root must be separate".into());
        }
        let staging = self.root.join(format!(".install-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&staging).map_err(|error| error.to_string())?;
        let copied = (|| {
            let mut total = (0usize, 0u64);
            copy_package(&source, &staging, &mut total)?;
            for entry in definition
                .contributes
                .panels
                .iter()
                .map(|panel| panel.entry.as_str())
                .chain(
                    definition
                        .backend
                        .iter()
                        .map(|backend| backend.entry.as_str()),
                )
            {
                if !staging.join(entry).is_file() {
                    return Err(format!("App entry is missing: {entry}"));
                }
            }
            write_record(&staging, enabled)?;
            Ok(staging.clone())
        })();
        match copied {
            Ok(staging) => Ok(staging),
            Err(error) => {
                let _ = fs::remove_dir_all(&staging);
                Err(error)
            }
        }
    }

    fn read_builtin_stamp(&self, name: &AppName) -> Option<String> {
        fs::read_to_string(self.root.join(name.as_str()).join(".builtin-stamp"))
            .ok()
            .map(|stamp| stamp.trim().to_owned())
    }

    fn write_builtin_stamp(&self, name: &AppName, stamp: &str) -> Result<(), String> {
        let path = self.root.join(name.as_str()).join(".builtin-stamp");
        fs::write(&path, stamp).map_err(|error| error.to_string())
    }

    pub fn set_enabled(
        &mut self,
        name: &AppName,
        enabled: bool,
    ) -> Result<Vec<AppSummary>, StoreError> {
        permit(
            self.tenure_of(name),
            if enabled { TenureAsk::Enable } else { TenureAsk::Disable },
        )
        .map_err(StoreError::Required)?;
        let app = self
            .installed
            .get_mut(name)
            .ok_or_else(|| "App is not installed".to_string())?;
        write_record(&self.root.join(name.as_str()), enabled)?;
        app.enabled = enabled;
        if !enabled {
            self.processes.remove(name);
        }
        Ok(self.list())
    }

    pub fn uninstall(&mut self, name: &AppName) -> Result<Vec<AppSummary>, StoreError> {
        permit(self.tenure_of(name), TenureAsk::Remove).map_err(StoreError::Required)?;
        if !self.installed.contains_key(name) {
            return Err(StoreError::Failed("App is not installed".into()));
        }
        self.builtins.record(name.clone());
        self.save_builtin_discovery()?;
        self.processes.remove(name);
        fs::remove_dir_all(self.root.join(name.as_str())).map_err(|error| error.to_string())?;
        self.installed.remove(name);
        // Domain data is deliberately retained outside the installed package.
        Ok(self.list())
    }

    pub fn resolve(&mut self, name: &AppName) -> Result<AppAccess, String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if !app.enabled {
            return Err("App is disabled; enable it before opening".into());
        }
        let root = self.root.join(name.as_str());
        let entry = app.definition.contributes.panels[0].entry.clone();
        if self
            .processes
            .get_mut(name)
            .is_some_and(|process| process.access().is_err())
        {
            self.processes.remove(name);
        }
        if app.definition.backend.is_some() && !self.processes.contains_key(name) {
            self.processes.insert(
                name.clone(),
                AppProcess::start(
                    &app.definition,
                    &root,
                    &self.data.join(name.as_str()),
                    self.python.select(name),
                )?,
            );
        }
        let backend = self
            .processes
            .get_mut(name)
            .map(AppProcess::access)
            .transpose()?;
        Ok(AppAccess {
            root,
            entry,
            backend,
        })
    }
}

fn write_record(root: &Path, enabled: bool) -> Result<(), String> {
    let pending = root.join(".installation.pending");
    fs::write(
        &pending,
        serde_json::to_vec(&InstallRecord { enabled }).map_err(|error| error.to_string())?,
    )
    .and_then(|_| fs::rename(pending, root.join(".installation.json")))
    .map_err(|error| error.to_string())
}

fn copy_package(source: &Path, target: &Path, total: &mut (usize, u64)) -> Result<(), String> {
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if matches!(
            name.to_str(),
            Some(
                "node_modules" | ".git" | "__pycache__" | ".venv" | ".DS_Store" | ".builtin-stamp"
            )
        ) {
            continue;
        }
        if name.to_string_lossy().starts_with(".installation") {
            return Err("Package contains Host installation metadata".into());
        }
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let destination = target.join(&name);
        total.0 += 1;
        if total.0 > 10000 {
            return Err("App package exceeds 10,000 entries".into());
        }
        if kind.is_symlink() {
            return Err("App package cannot contain symlinks".into());
        }
        if kind.is_dir() {
            fs::create_dir(&destination).map_err(|error| error.to_string())?;
            copy_package(&entry.path(), &destination, total)?;
        } else if kind.is_file() {
            total.1 += entry.metadata().map_err(|error| error.to_string())?.len();
            if total.1 > 256 * 1024 * 1024 {
                return Err("App package exceeds 256 MiB".into());
            }
            fs::copy(entry.path(), destination).map_err(|error| error.to_string())?;
        } else {
            return Err("App package contains a special file".into());
        }
    }
    Ok(())
}

/// Identity of a bundled package. File size and modification time are enough
/// to notice a rebuild without reading the package on every catalog request.
fn package_stamp(root: &Path) -> Result<String, String> {
    let mut files = Vec::new();
    collect_package_files(root, &mut files)?;
    files.sort();
    let mut hash = 0xcbf29ce484222325u64;
    for path in files {
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
        hash = mix(hash, relative.to_string_lossy().as_bytes());
        let meta = fs::metadata(&path).map_err(|error| error.to_string())?;
        hash = mix(hash, meta.len().to_string().as_bytes());
        let modified = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok());
        hash = mix(
            hash,
            modified
                .map(|time| time.as_secs())
                .unwrap_or(0)
                .to_string()
                .as_bytes(),
        );
        hash = mix(
            hash,
            modified
                .map(|time| time.subsec_nanos())
                .unwrap_or(0)
                .to_string()
                .as_bytes(),
        );
    }
    Ok(format!("{hash:016x}"))
}

fn collect_package_files(root: &Path, files: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if matches!(
            name.to_str(),
            Some(
                "node_modules" | ".git" | "__pycache__" | ".venv" | ".DS_Store" | ".builtin-stamp"
            )
        ) || name.to_string_lossy().starts_with(".installation")
        {
            continue;
        }
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        if kind.is_symlink() {
            return Err("App package cannot contain symlinks".into());
        }
        if kind.is_dir() {
            collect_package_files(&entry.path(), files)?;
        } else if kind.is_file() {
            files.push(entry.path());
        } else {
            return Err("App package contains a special file".into());
        }
    }
    Ok(())
}

fn mix(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash = hash.wrapping_mul(0x100000001b3) ^ (*byte as u64);
    }
    hash.wrapping_mul(0x100000001b3) ^ 0xff
}

#[cfg(test)]
mod tests;
