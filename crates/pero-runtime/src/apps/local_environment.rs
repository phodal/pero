//! Managed local software. AppStore owns bindings and backend lifetime.
use super::{
    AppName, AppStore, PythonEnvironment, ScientificMethod, definition::PythonDependency,
    preparation,
};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(try_from = "String", into = "String")]
pub struct EnvironmentLabel(String);
impl TryFrom<String> for EnvironmentLabel {
    type Error = String;
    fn try_from(value: String) -> Result<Self, String> {
        let value = value.trim();
        if value.is_empty() || value.chars().count() > 80 {
            return Err("Use an environment name of 1–80 characters".into());
        }
        Ok(Self(value.to_owned()))
    }
}
impl From<EnvironmentLabel> for String {
    fn from(value: EnvironmentLabel) -> Self {
        value.0
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EnvironmentState {
    Created,
    Preparing,
    Ready,
    Failed,
}

impl EnvironmentState {
    fn preparing(&self, in_use: bool) -> Result<Self, String> {
        if in_use {
            return Err("Create a new environment before changing software already in use".into());
        }
        if *self == Self::Preparing {
            return Err("Environment is already preparing; wait for completion".into());
        }
        Ok(Self::Preparing)
    }
    fn require_ready(&self) -> Result<(), String> {
        if *self != Self::Ready {
            return Err("Prepare the environment successfully before binding".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LocalEnvironment {
    pub id: AppName,
    pub label: EnvironmentLabel,
    pub target: ScientificMethod,
    pub dependencies: Vec<PythonDependency>,
    pub state: EnvironmentState,
    pub log: Vec<String>,
    pub error: Option<String>,
    pub bound: bool,
}
#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase", deny_unknown_fields)]
pub enum Request {
    List,
    Create {
        target: ScientificMethod,
        label: EnvironmentLabel,
    },
    Prepare {
        id: AppName,
    },
    Bind {
        id: AppName,
    },
}

impl AppStore {
    fn environment_root(&self) -> PathBuf {
        self.root.parent().unwrap().join("environment/profiles")
    }
    fn environment_record(&self, id: &AppName) -> Result<LocalEnvironment, String> {
        serde_json::from_slice(
            &fs::read(
                self.environment_root()
                    .join(format!("{}.json", id.as_str())),
            )
            .map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())
    }
    pub fn local_environments(
        &self,
        caller: &AppName,
        request: Request,
    ) -> Result<Vec<LocalEnvironment>, String> {
        self.require_grant(caller, "environments")?;
        match request {
            Request::List => {}
            Request::Create { target, label } => {
                let app = self
                    .installed
                    .get(&AppName::try_from(target.target().0.to_owned())?)
                    .ok_or("App is not installed")?;
                let mut dependencies = app
                    .definition
                    .backend
                    .as_ref()
                    .ok_or("App has no Python backend")?
                    .dependencies
                    .clone();
                if matches!(target, ScientificMethod::Pcgym) {
                    let pins: Vec<PythonDependency> =
                        serde_json::from_str(include_str!("pcgym-dependencies.json"))
                            .map_err(|e| e.to_string())?;
                    dependencies.extend(pins);
                }
                let value = LocalEnvironment {
                    id: AppName::try_from(format!("env-{}", uuid::Uuid::new_v4()))?,
                    label,
                    target,
                    dependencies,
                    state: EnvironmentState::Created,
                    log: Vec::new(),
                    error: None,
                    bound: false,
                };
                save_environment(&self.environment_root(), &value)?;
            }
            Request::Prepare { .. } => return Err("Prepare through the Host job entrypoint".into()),
            Request::Bind { .. } => return Err("Binding requires the App backend owner".into()),
        }
        let root = self.environment_root();
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut values = Vec::new();
        for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.path().extension().is_some_and(|v| v == "json") {
                let mut value: LocalEnvironment =
                    serde_json::from_slice(&fs::read(entry.path()).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                let app = AppName::try_from(value.target.target().0.to_owned())?;
                value.bound = self
                    .python
                    .select(&app)
                    .is_some_and(|p| p.root() == self.environment_root().join(value.id.as_str()));
                values.push(value);
            }
        }
        values.sort_by(|a, b| a.label.cmp(&b.label));
        Ok(values)
    }
    pub fn bind_local_environment(
        &mut self,
        caller: &AppName,
        id: AppName,
    ) -> Result<Vec<LocalEnvironment>, String> {
        self.require_grant(caller, "environments")?;
        let value = self.environment_record(&id)?;
        value.state.require_ready()?;
        let app = AppName::try_from(value.target.target().0.to_owned())?;
        let root = self.environment_root().join(id.as_str());
        let environment = PythonEnvironment::try_from(root.clone())?;
        let inspection = super::environment::EnvironmentInspection::inspect(
            &self.root.join(app.as_str()),
            Some(&environment),
            value.target,
        )?;
        crate::environments::match_software(&inspection.requirements, &inspection.profile)
            .map_err(|e| e.to_string())?;
        let settings = self.settings.as_ref().ok_or("Host has no settings path")?;
        crate::settings::save_app_python_binding(settings, app.as_str(), &root)
            .map_err(|e| e.to_string())?;
        self.processes.remove(&app);
        self.python.bind(app.clone(), root)?;
        self.resolve(&app)?;
        self.local_environments(caller, Request::List)
    }
}

fn save_environment(directory: &std::path::Path, value: &LocalEnvironment) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|e| e.to_string())?;
    let path = directory.join(format!("{}.json", value.id.as_str()));
    let pending = path.with_extension("pending");
    fs::write(
        &pending,
        serde_json::to_vec(value).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(pending, path).map_err(|e| e.to_string())
}
pub struct EnvironmentPreparation {
    catalog: PathBuf,
    app_root: PathBuf,
    app_data: PathBuf,
    value: LocalEnvironment,
}
impl EnvironmentPreparation {
    pub fn run(self, progress: &mut impl FnMut(super::AppPreparation)) -> Result<(), String> {
        let mut value = self.value;
        let app = AppName::try_from(value.target.target().0.to_owned())?;
        let root = self.catalog.join(value.id.as_str());
        value.state = EnvironmentState::Preparing;
        value.error = None;
        value.log.clear();
        save_environment(&self.catalog, &value)?;
        let result = (|| {
            let dependencies = value.dependencies.clone();
            preparation::prepare(
                &app,
                None,
                PythonEnvironment::try_from(root.clone())?,
                &dependencies,
                value.target.python_minor(),
                &mut |event| {
                    value.log.push(event.message.clone());
                    if value.log.len() > 80 {
                        value.log.remove(0);
                    }
                    let _ = save_environment(&self.catalog, &value);
                    progress(event);
                },
            )?;
            if matches!(value.target, ScientificMethod::Lcms2Yield) {
                let environment = PythonEnvironment::try_from(root.clone())?;
                let mut report = |line: String| {
                    progress(super::AppPreparation {
                        name: app.clone(),
                        phase: preparation::PreparationPhase::Installing,
                        message: line.clone(),
                    });
                    value.log.push(line);
                };
                preparation::install_lcms_wheels(&environment, &mut report)?;
                preparation::fetch_lcms_release(
                    &environment,
                    &self.app_root,
                    &self.app_data,
                    &mut report,
                )?;
            }
            if matches!(value.target, ScientificMethod::Circuit) {
                let mut command = std::process::Command::new("brew");
                command
                    .args(["install", "ngspice"])
                    .env("HOMEBREW_NO_AUTO_UPDATE", "1");
                preparation::run(&mut command, &mut |line| {
                    progress(super::AppPreparation {
                        name: app.clone(),
                        phase: preparation::PreparationPhase::Installing,
                        message: line.clone(),
                    });
                    value.log.push(line);
                })?;
                let output = std::process::Command::new("brew")
                    .args(["--prefix", "ngspice"])
                    .output()
                    .map_err(|e| e.to_string())?;
                if !output.status.success() {
                    return Err("Cannot locate installed ngspice".into());
                }
                let program = PathBuf::from(String::from_utf8_lossy(&output.stdout).trim())
                    .join("bin/ngspice")
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    let link = root.join("bin/ngspice");
                    if link.symlink_metadata().is_ok() {
                        fs::remove_file(&link).map_err(|e| e.to_string())?;
                    }
                    std::os::unix::fs::symlink(program, link).map_err(|e| e.to_string())?;
                }
            }
            let inspection = super::environment::EnvironmentInspection::inspect(
                &self.app_root,
                Some(&PythonEnvironment::try_from(root)?),
                value.target,
            )?;
            crate::environments::match_software(&inspection.requirements, &inspection.profile)
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        value.state = if result.is_ok() {
            EnvironmentState::Ready
        } else {
            EnvironmentState::Failed
        };
        value.error = result.err();
        save_environment(&self.catalog, &value)?;

        Ok(())
    }
}
impl AppStore {
    pub fn environment_preparation(
        &self,
        caller: &AppName,
        id: &AppName,
    ) -> Result<EnvironmentPreparation, String> {
        self.require_grant(caller, "environments")?;
        let value = self.environment_record(id)?;
        let app = AppName::try_from(value.target.target().0.to_owned())?;
        let in_use = self
            .python
            .select(&app)
            .is_some_and(|p| p.root() == self.environment_root().join(id.as_str()));
        let mut value = value;
        value.state = value.state.preparing(in_use)?;
        save_environment(&self.environment_root(), &value)?;
        Ok(EnvironmentPreparation {
            catalog: self.environment_root(),
            app_root: self.root.join(app.as_str()),
            app_data: self.data.join(app.as_str()),
            value,
        })
    }
}

impl AppStore {
    pub(super) fn recover_local_environments(&self) -> Result<(), String> {
        let root = self.environment_root();
        if !root.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().is_some_and(|v| v == "json") {
                let mut value: LocalEnvironment =
                    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
                        .map_err(|e| e.to_string())?;
                if value.state == EnvironmentState::Preparing {
                    value.state = EnvironmentState::Failed;
                    value.error=Some("Preparation was interrupted when the Host stopped. Prepare again to resume installation.".into());
                    save_environment(&root, &value)?;
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::EnvironmentState::*;
    #[test]
    fn interrupted_preparation_is_recoverable_after_restart() {
        use super::*;
        let directory = std::env::temp_dir().join(format!(
            "pero-environment-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        let root = directory.join("apps");
        let store =
            AppStore::open(root.clone(), super::super::PythonEnvironments::default()).unwrap();
        let value = LocalEnvironment {
            id: AppName::try_from("env-recovery".to_owned()).unwrap(),
            label: EnvironmentLabel::try_from("Recovery".to_owned()).unwrap(),
            target: ScientificMethod::Control,
            dependencies: vec![],
            state: Preparing,
            log: vec!["Downloaded wheel".into()],
            error: None,
            bound: false,
        };
        save_environment(&store.environment_root(), &value).unwrap();
        drop(store);
        let store = AppStore::open(root, super::super::PythonEnvironments::default()).unwrap();
        let restored = store.environment_record(&value.id).unwrap();
        assert_eq!(restored.state, Failed);
        assert_eq!(restored.log, value.log);
        assert!(restored.error.unwrap().contains("interrupted"));
        assert!(restored.state.preparing(false).is_ok());
        drop(store);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn preparation_and_binding_transitions() {
        for (state, in_use, allowed, bindable) in [
            (Created, false, true, false),
            (Ready, false, true, true),
            (Failed, false, true, false),
            (Preparing, false, false, false),
            (Ready, true, false, true),
            (Created, true, false, false),
        ] {
            assert_eq!(
                state.preparing(in_use).is_ok(),
                allowed,
                "{state:?} in_use={in_use}"
            );
            assert_eq!(state.require_ready().is_ok(), bindable, "{state:?}");
        }
    }
}
