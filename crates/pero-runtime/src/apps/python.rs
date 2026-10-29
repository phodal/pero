//! Prepared Python environments selected by trusted Host configuration.
use super::AppName;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PythonEnvironments {
    default: Option<PythonEnvironment>,
    apps: BTreeMap<AppName, PythonEnvironment>,
}

impl PythonEnvironments {
    pub fn select(&self, name: &AppName) -> Option<&PythonEnvironment> {
        self.apps.get(name).or(self.default.as_ref())
    }
}

/// A venv root, rather than an arbitrary executable or command.
#[derive(Clone, Debug, Deserialize)]
#[serde(try_from = "PathBuf")]
pub struct PythonEnvironment {
    root: PathBuf,
}

impl TryFrom<PathBuf> for PythonEnvironment {
    type Error = String;

    fn try_from(root: PathBuf) -> Result<Self, Self::Error> {
        if !root.is_absolute() {
            return Err("App Python environment must be an absolute venv directory path".into());
        }
        Ok(Self { root })
    }
}

impl PythonEnvironment {
    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn executable(&self) -> PathBuf {
        self.root.join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        })
    }

    /// The shell reads pyvenv.cfg; this rule stays independent of the filesystem.
    pub fn validate_config(&self, text: &str) -> Result<(), String> {
        let system_packages = text
            .lines()
            .filter_map(|line| line.split_once('='))
            .filter(|(key, _)| {
                key.trim()
                    .eq_ignore_ascii_case("include-system-site-packages")
            })
            .map(|(_, value)| value.trim())
            .last();
        if system_packages.is_some_and(|value| value.eq_ignore_ascii_case("false")) {
            return Ok(());
        }
        Err(format!(
            "Python environment {} must set include-system-site-packages = false in pyvenv.cfg; recreate the venv without --system-site-packages",
            self.root.display()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_environment_requires_an_isolated_venv() {
        let absolute = if cfg!(windows) {
            r"C:\environments\paper-agent"
        } else {
            "/environments/paper-agent"
        };
        for (root, config, accepted) in [
            (
                absolute,
                "home = /python\ninclude-system-site-packages = false\n",
                true,
            ),
            (absolute, "INCLUDE-SYSTEM-SITE-PACKAGES = FALSE\n", true),
            (absolute, "include-system-site-packages = true\n", false),
            (absolute, "home = /python\n", false),
            (absolute, "include-system-site-packages = no\n", false),
            (
                absolute,
                "include-system-site-packages = false\ninclude-system-site-packages = true\n",
                false,
            ),
            (
                "relative/venv",
                "include-system-site-packages = false\n",
                false,
            ),
            ("", "include-system-site-packages = false\n", false),
        ] {
            let result = serde_json::from_value::<PythonEnvironments>(
                serde_json::json!({"apps": {"paper-agent": root}}),
            )
            .map_err(|error| error.to_string())
            .and_then(|environments| {
                environments
                    .select(&AppName::try_from("paper-agent".to_string()).unwrap())
                    .unwrap()
                    .validate_config(config)
            });
            assert_eq!(result.is_ok(), accepted, "{root}: {config}");
        }
    }

    #[test]
    fn app_override_precedes_the_shared_default() {
        let (shared, dedicated) = if cfg!(windows) {
            (r"C:\environments\shared", r"C:\environments\paper-agent")
        } else {
            ("/environments/shared", "/environments/paper-agent")
        };
        let name = AppName::try_from("paper-agent".to_string()).unwrap();
        for (config, selected) in [
            (serde_json::json!({"default": shared}), Some(shared)),
            (
                serde_json::json!({"default": shared, "apps": {"paper-agent": dedicated}}),
                Some(dedicated),
            ),
            (
                serde_json::json!({"default": shared, "apps": {"other-app": dedicated}}),
                Some(shared),
            ),
            (
                serde_json::json!({"apps": {"paper-agent": dedicated}}),
                Some(dedicated),
            ),
            (serde_json::json!({"apps": {"other-app": dedicated}}), None),
            (serde_json::json!({}), None),
        ] {
            let environments: PythonEnvironments = serde_json::from_value(config.clone()).unwrap();
            assert_eq!(
                environments.select(&name).map(PythonEnvironment::root),
                selected.map(Path::new),
                "{config}"
            );
        }
    }
}
