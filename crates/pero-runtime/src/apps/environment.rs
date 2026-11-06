//! Read-only inspection of an already configured scientific interpreter.
//! Host projection adds no install, backend startup, Use grant or calculation.
use super::{AppName, AppStore, PythonEnvironment};
use crate::environments::*;
use serde::{Deserialize, Serialize};
use std::{path::Path, process::Command};

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub enum ScientificMethod {
    #[serde(rename = "control-lab.python-control")]
    Control,
    #[serde(rename = "control-lab.ngspice")]
    Circuit,
    #[serde(rename = "paper-agent.pcgym")]
    Pcgym,
    #[serde(rename = "lcms2yield.inference")]
    Lcms2Yield,
}
impl ScientificMethod {
    /// This trial runs every method, including LCMS2Yield, on the bundled 3.12 minor.
    pub(super) fn python_minor(self) -> &'static str {
        let _ = self;
        super::python::BUNDLED_PYTHON_MINOR
    }
}
impl ScientificMethod {
    pub(super) fn target(
        self,
    ) -> (
        &'static str,
        &'static str,
        &'static str,
        Option<&'static str>,
    ) {
        match self {
            Self::Control => (
                "control-lab",
                "control-lab.python-control",
                "control_lab.environment",
                Some("python-control"),
            ),
            Self::Circuit => (
                "control-lab",
                "control-lab.ngspice",
                "control_lab.environment",
                Some("ngspice"),
            ),
            Self::Pcgym => (
                "paper-agent",
                "paper-agent.pcgym",
                "paper_agent.environment",
                None,
            ),
            Self::Lcms2Yield => (
                "lcms2yield",
                "lcms2yield.inference",
                "lcms2yield.environment",
                None,
            ),
        }
    }
}

#[derive(Debug)]
pub struct EnvironmentInspection {
    pub profile: SoftwareProfile,
    pub requirements: EnvironmentRequirements,
    pub observed_at_ms: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Probe {
    schema: String,
    method: Identity,
    profile: ProfileObservation,
    profile_id: ContentDigest,
    required: Vec<Requirement>,
    preferred: Vec<Requirement>,
    observed_at_ms: u64,
    evidence: String,
}

impl EnvironmentInspection {
    fn parse(bytes: &[u8], method: ScientificMethod) -> Result<Self, String> {
        let probe: Probe = serde_json::from_slice(bytes)
            .map_err(|e| format!("Invalid environment observation: {e}"))?;
        let (app, expected, _, _) = method.target();
        if probe.schema != "pero.environment.observation.v1"
            || probe.evidence != "metadata_only"
            || probe.method.as_str() != expected
            || probe.profile.name.as_str() != app
        {
            return Err("Environment observation does not belong to the selected method".into());
        }
        let profile = SoftwareProfile::observed(probe.profile);
        if profile.id() != &probe.profile_id {
            return Err("Environment profile digest does not match observed content".into());
        }
        let mut required = probe.required;
        if matches!(
            method,
            ScientificMethod::Control | ScientificMethod::Circuit
        ) {
            let (major, minor) = super::python::BUNDLED_PYTHON_MINOR
                .split_once('.')
                .expect("bundled Python minor");
            required.push(Requirement::Python {
                major: major.parse().expect("major"),
                minor: minor.parse().expect("minor"),
                patch: None,
            });
        }
        let requirements = EnvironmentRequirements::new(probe.method, required, probe.preferred)
            .map_err(|e| e.to_string())?;
        Ok(Self {
            profile,
            requirements,
            observed_at_ms: probe.observed_at_ms,
        })
    }

    pub(super) fn inspect(
        root: &Path,
        python: Option<&PythonEnvironment>,
        method: ScientificMethod,
    ) -> Result<Self, String> {
        let (_, _, module, argument) = method.target();
        let mut command = Command::new(
            python
                .map(PythonEnvironment::executable)
                .map(|p| p.into_os_string())
                .unwrap_or_else(super::python::default_executable),
        );
        command
            .args(["-E", "-s", "-B", "-m", module])
            .current_dir(root.join("backend"))
            .env_clear();
        if let Some(argument) = argument {
            command.arg(argument);
        }
        for key in ["PATH", "HOME", "LANG", "SYSTEMROOT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH"] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        if let Some(python) = python {
            python.configure_command(&mut command)?;
        }
        let output = command
            .output()
            .map_err(|e| format!("Cannot inspect configured scientific Python: {e}"))?;
        if !output.status.success() {
            return Err(
                "Scientific environment probe failed; no preparation or execution was attempted"
                    .into(),
            );
        }
        if output.stdout.len() > 64 * 1024 {
            return Err("Environment observation exceeds 64 KiB".into());
        }
        Self::parse(&output.stdout, method)
    }
}

impl AppStore {
    /// Same selection used to start App processes; it does not prepare a venv.
    pub(super) fn selected_python(
        &self,
        name: &AppName,
    ) -> Result<Option<PythonEnvironment>, String> {
        let app = self.installed.get(name).ok_or("App is not installed")?;
        if let Some(python) = self.python.select(name) {
            return Ok(Some(python.clone()));
        }
        if app
            .definition
            .backend
            .as_ref()
            .is_some_and(|b| !b.dependencies.is_empty())
        {
            return Ok(Some(PythonEnvironment::try_from(
                self.root
                    .parent()
                    .ok_or("App root needs a parent")?
                    .join("environment/pero-python312"),
            )?));
        }
        Ok(None)
    }

    /// Inspects the selected interpreter now, not an attestation of a live backend.
    pub fn inspect_environment(
        &self,
        method: ScientificMethod,
    ) -> Result<EnvironmentInspection, String> {
        let (app, _, _, _) = method.target();
        let name = AppName::try_from(app.to_owned())?;
        let installation = self.installed.get(&name).ok_or("App is not installed")?;
        if !installation.enabled {
            return Err("App is disabled".into());
        }
        EnvironmentInspection::inspect(
            &self.root.join(app),
            self.selected_python(&name)?.as_ref(),
            method,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observation_boundary_rejects_wrong_identity_or_unsupported_conditions() {
        let profile = serde_json::json!({"name":"paper-agent","python":{"major":3,"minor":12,"patch":11},
            "system":"Linux","machine":"x86_64","interpreter_sha256":null,
            "packages":{"torch":null},"native":{}});
        let valid = serde_json::json!({"schema":"pero.environment.observation.v1","method":"paper-agent.pcgym",
            "profile_id":ContentDigest::of(&profile),"profile":profile,"observed_at_ms":100,
            "evidence":"metadata_only","required":[{"kind":"package","name":"torch","version":null}],"preferred":[]});
        assert!(
            EnvironmentInspection::parse(
                &serde_json::to_vec(&valid).unwrap(),
                ScientificMethod::Pcgym
            )
            .is_ok()
        );
        for (key, value) in [
            ("schema", serde_json::json!("other")),
            ("method", serde_json::json!("control-lab.python-control")),
            ("profile_id", serde_json::json!("0".repeat(64))),
            ("evidence", serde_json::json!("prepared")),
            ("required", serde_json::json!([{"kind":"gpu","count":1}])),
        ] {
            let mut changed = valid.clone();
            changed[key] = value;
            assert!(
                EnvironmentInspection::parse(
                    &serde_json::to_vec(&changed).unwrap(),
                    ScientificMethod::Pcgym
                )
                .is_err(),
                "{key}"
            );
        }
    }

    #[test]
    fn existing_scientific_environments() {
        // Real stdlib-only probes: no models, solvers, installation or App startup.
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps");
        for (app, method) in [
            ("control-lab", ScientificMethod::Control),
            ("control-lab", ScientificMethod::Circuit),
            ("paper-agent", ScientificMethod::Pcgym),
            ("lcms2yield", ScientificMethod::Lcms2Yield),
        ] {
            let inspection = EnvironmentInspection::inspect(&root.join(app), None, method).unwrap();
            let crate::environments::SoftwareObservation::Legacy(observed) = inspection.profile.observation() else {
                panic!("legacy probe contract")
            };
            assert_eq!(observed.name.as_str(), app);
            let binding = EnvironmentBinding {
                owner: "probe".to_owned().try_into().unwrap(),
                incarnation: "inspection".to_owned().try_into().unwrap(),
                observed_at_ms: inspection.observed_at_ms,
                profile: inspection.profile,
            };
            // Whether installed or missing, all declared conditions are evaluated by the same core.
            let matched = match_profile(
                &inspection.requirements,
                &binding,
                inspection.observed_at_ms,
                1,
            );
            assert!(
                matched.is_ok()
                    || matches!(matched, Err(EnvironmentError::RequirementUnsatisfied(_)))
            );
            let raw = serde_json::to_vec(&binding.profile.observation()).unwrap();
            assert!(!String::from_utf8(raw).unwrap().contains("/Users/"));
        }
    }
}
