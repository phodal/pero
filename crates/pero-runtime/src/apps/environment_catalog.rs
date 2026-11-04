//! Public observation projection. This does not allocate resources or create a Use.
use super::{AppName, AppStore, EnvironmentInspection, ScientificMethod};
use crate::environments::{
    EnvironmentError, EnvironmentRequirements, Requirement, SoftwareProfile, match_software,
};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct EnvironmentReport {
    schema: &'static str,
    method: ScientificMethod,
    scope: &'static str,
    evidence: &'static str,
    observed_at_ms: u64,
    profile: SoftwareProfile,
    requirements: EnvironmentRequirements,
    matched: bool,
    missing: Vec<Requirement>,
}

impl EnvironmentReport {
    fn from_inspection(
        method: ScientificMethod,
        inspection: EnvironmentInspection,
    ) -> Result<Self, String> {
        let (matched, missing) = match match_software(&inspection.requirements, &inspection.profile)
        {
            Ok(_) => (true, Vec::new()),
            Err(EnvironmentError::RequirementUnsatisfied(missing)) => (false, missing),
            Err(error) => return Err(error.to_string()),
        };
        Ok(Self {
            schema: "pero.environment.inspection.v1",
            method,
            scope: "configured-interpreter",
            evidence: "metadata_only",
            observed_at_ms: inspection.observed_at_ms,
            profile: inspection.profile,
            requirements: inspection.requirements,
            matched,
            missing,
        })
    }
}

impl ScientificMethod {
    /// Only the method's App and the granted management App may inspect it.
    fn permits(self, caller: &AppName) -> bool {
        caller.as_str() == self.target().0 || caller.as_str() == "environments"
    }
}

impl AppStore {
    /// Caller identity comes from the existing Host transport, not the request body.
    /// Scope admission is checked before any probe process is started.
    pub fn inspect_environment_for(
        &self,
        caller: &AppName,
        method: ScientificMethod,
    ) -> Result<EnvironmentReport, String> {
        if !method.permits(caller) {
            return Err("This App cannot inspect that scientific method".into());
        }
        if caller.as_str() == "environments" {
            self.require_grant(caller, "environments")?;
        }
        // Uses precisely the selection and probe already owned by AppStore.
        // Does not call prepare(), resolve(), bind(), or any scientific entrypoint.
        EnvironmentReport::from_inspection(method, self.inspect_environment(method)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::environments::{Identity, ProfileObservation, PythonVersion};
    use std::collections::BTreeMap;

    fn inspection(installed: bool) -> EnvironmentInspection {
        let package: Identity = "torch".to_owned().try_into().unwrap();
        let profile = SoftwareProfile::observed(ProfileObservation {
            name: "paper-agent".to_owned().try_into().unwrap(),
            python: PythonVersion {
                major: 3,
                minor: 12,
                patch: 11,
            },
            system: "Linux".to_owned().try_into().unwrap(),
            machine: "x86_64".to_owned().try_into().unwrap(),
            interpreter_sha256: None,
            packages: BTreeMap::from([(
                package.clone(),
                installed.then(|| "2.0".to_owned().try_into().unwrap()),
            )]),
            native: BTreeMap::new(),
        });
        let requirements = EnvironmentRequirements::new(
            "paper-agent.pcgym".to_owned().try_into().unwrap(),
            vec![Requirement::Package {
                name: package,
                version: None,
            }],
            Vec::new(),
        )
        .unwrap();
        EnvironmentInspection {
            profile,
            requirements,
            observed_at_ms: 100,
        }
    }

    #[test]
    fn method_scope_is_narrow() {
        for (method, caller, allowed) in [
            (ScientificMethod::Pcgym, "paper-agent", true),
            (ScientificMethod::Control, "control-lab", true),
            (ScientificMethod::Circuit, "control-lab", true),
            (ScientificMethod::Pcgym, "environments", true),
            (ScientificMethod::Control, "environments", true),
            (ScientificMethod::Circuit, "environments", true),
            (ScientificMethod::Control, "paper-agent", false),
            (ScientificMethod::Pcgym, "control-lab", false),
            (ScientificMethod::Control, "other", false),
        ] {
            assert_eq!(
                method.permits(&caller.to_owned().try_into().unwrap()),
                allowed,
                "{caller}"
            );
        }
    }

    #[test]
    fn reports_missing_and_observed_without_claiming_execution() {
        for installed in [false, true] {
            let value = serde_json::to_value(
                EnvironmentReport::from_inspection(ScientificMethod::Pcgym, inspection(installed))
                    .unwrap(),
            )
            .unwrap();
            assert_eq!(value["matched"], installed);
            assert_eq!(value["missing"].as_array().unwrap().is_empty(), installed);
            assert_eq!(value["scope"], "configured-interpreter");
            assert_eq!(value["evidence"], "metadata_only");
            assert!(value.get("authorized").is_none());
            assert!(value.get("verdict").is_none());
            assert!(value.get("use_id").is_none());
        }
    }

    #[test]
    fn method_wire_names_are_closed() {
        for name in [
            "paper-agent.pcgym",
            "control-lab.python-control",
            "control-lab.ngspice",
        ] {
            let method: ScientificMethod = serde_json::from_value(serde_json::json!(name)).unwrap();
            assert_eq!(serde_json::to_value(method).unwrap(), name);
        }
        for value in [
            serde_json::json!("python /tmp/arbitrary.py"),
            serde_json::json!("gpu"),
            serde_json::json!({"target":"paper-agent.pcgym"}),
        ] {
            assert!(serde_json::from_value::<ScientificMethod>(value).is_err());
        }
    }
}
