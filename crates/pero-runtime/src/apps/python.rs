//! Prepared Python environments selected by trusted Host configuration.
//!
//! New environments use the bundled CPython minor, 3.12
//! (`scripts/release/python.json`). An existing environment of another version
//! is left in place; Control Lab is bound to a 3.12 environment instead.
use super::AppName;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    process::Command,
};

/// Bundled CPython minor. The release pin is 3.12.16; any 3.12 patch matches.
pub const BUNDLED_PYTHON_MINOR: &str = "3.12";

pub fn matches_bundled_python(version: &str) -> bool {
    let version = version.trim();
    version == BUNDLED_PYTHON_MINOR
        || version
            .strip_prefix(BUNDLED_PYTHON_MINOR)
            .is_some_and(|rest| {
                let Some(patch) = rest.strip_prefix('.') else {
                    return false;
                };
                !patch.is_empty() && patch.bytes().all(|byte| byte.is_ascii_digit())
            })
}

/// `version` in pyvenv.cfg. uv records the same value as `version_info`.
pub fn configured_python_version(config: &str) -> Option<&str> {
    let read = |name: &str| {
        config
            .lines()
            .filter_map(|line| line.split_once('='))
            .filter(|(key, _)| key.trim().eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim())
            .filter(|value| !value.is_empty())
            .last()
    };
    read("version").or_else(|| read("version_info"))
}

/// Existing selections have passed isolation and availability checks. Only a
/// managed target may be acquired, and only its successful preparation may bind it.
#[derive(Clone, Debug)]
pub(super) enum PythonPreparation {
    Existing(PythonEnvironment),
    Managed(PythonEnvironment),
}

impl PythonPreparation {
    pub(super) fn for_app(
        app: &AppName,
        selected: Option<&PythonEnvironment>,
        managed: PythonEnvironment,
        config: Option<&str>,
        executable_exists: bool,
        requirements_present: bool,
    ) -> Result<Self, String> {
        let Some(selected) = selected else {
            return Ok(Self::Managed(managed));
        };
        if selected.root() == managed.root() && !executable_exists && config.is_none() {
            return Ok(Self::Managed(managed));
        }
        let config = config.ok_or_else(|| format!(
            "Python environment {} is unavailable: pyvenv.cfg is missing; repair the selected venv or update app_python",
            selected.root().display()
        ))?;
        selected.validate_config(config)?;
        if !executable_exists {
            if selected.root() == managed.root() {
                return Ok(Self::Managed(managed));
            }
            return Err(format!(
                "Python interpreter {} is missing; repair the selected venv or update app_python",
                selected.executable().display()
            ));
        }
        if app.as_str() == "control-lab" && requirements_present {
            let version = configured_python_version(config).ok_or_else(|| format!(
                "Python environment {} does not declare its version in pyvenv.cfg; repair the selected venv",
                selected.root().display()
            ))?;
            if !matches_bundled_python(version) {
                return Ok(Self::Managed(managed));
            }
        }
        Ok(Self::Existing(selected.clone()))
    }

    pub(super) fn environment(&self) -> &PythonEnvironment {
        match self {
            Self::Existing(environment) | Self::Managed(environment) => environment,
        }
    }
}

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

    pub fn bind(&mut self, name: AppName, root: PathBuf) -> Result<(), String> {
        self.apps.insert(name, PythonEnvironment::try_from(root)?);
        Ok(())
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

/// Real `python3.12` executable. Resolving the symlink keeps venv `home` on the
/// interpreter prefix; a shim directory cannot start under `-E`.
pub fn bundled_python_executable() -> Result<PathBuf, String> {
    let output = Command::new("python3.12")
        .args(["-c", "import sys; print(sys.executable)"])
        .output()
        .map_err(|error| {
            format!("python3.12 is required to create an App Python environment: {error}")
        })?;
    if !output.status.success() {
        return Err(format!(
            "python3.12 is required to create an App Python environment. {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let path = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    let path = path.trim();
    if path.is_empty() {
        return Err("python3.12 did not report its executable".into());
    }
    // `sys.executable` may be a PATH shim. venv records that directory as
    // `home`, and the environment then cannot start under `-E`.
    let path = std::fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path));
    let version = probe_version(&path)?;
    if !matches_bundled_python(&version) {
        return Err(format!(
            "python3.12 reported {version}, not CPython {BUNDLED_PYTHON_MINOR}"
        ));
    }
    Ok(path)
}

fn probe_version(python: &Path) -> Result<String, String> {
    let output = Command::new(python)
        .args([
            "-E",
            "-s",
            "-c",
            "import sys; print(sys.version.split()[0])",
        ])
        .output()
        .map_err(|error| format!("{} cannot start: {error}", python.display()))?;
    if !output.status.success() {
        return Err(format!(
            "{} failed: {}",
            python.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let version = String::from_utf8(output.stdout).map_err(|error| error.to_string())?;
    let version = version.trim();
    if version.is_empty() {
        return Err(format!("{} did not report a version", python.display()));
    }
    Ok(version.to_owned())
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

    #[test]
    fn default_interpreter_is_the_bundled_minor() {
        let pin: serde_json::Value =
            serde_json::from_str(include_str!("../../../../scripts/release/python.json")).unwrap();
        let asset = pin["asset"].as_str().unwrap();
        assert!(
            asset.starts_with(&format!("cpython-{BUNDLED_PYTHON_MINOR}.")),
            "{asset}"
        );
        for (version, accepted) in [
            ("3.12.16", true),
            ("3.12.11", true),
            ("3.12", true),
            (" 3.12.16\n", true),
            ("3.14.7", false),
            ("3.13.1", false),
            ("3.120", false),
            ("3.12.", false),
            ("3.12.16rc1", false),
            ("", false),
        ] {
            assert_eq!(matches_bundled_python(version), accepted, "{version}");
        }
        assert_eq!(
            configured_python_version(
                "home = /python\nversion = 3.14.7\ninclude-system-site-packages = false\n"
            ),
            Some("3.14.7")
        );
        assert_eq!(
            configured_python_version(
                "home = /python\nversion_info = 3.12.11\ninclude-system-site-packages = false\n"
            ),
            Some("3.12.11")
        );
        assert_eq!(
            configured_python_version("version_info = 3.12.11\nversion = 3.12.16\n"),
            Some("3.12.16")
        );
    }

    #[test]
    fn preparation_keeps_explicit_environments_and_bounds_control_lab_migration() {
        let external =
            PythonEnvironment::try_from(std::env::temp_dir().join("pero-selected-python")).unwrap();
        let managed =
            PythonEnvironment::try_from(std::env::temp_dir().join("pero-managed-python312"))
                .unwrap();
        let compatible = "version = 3.12.16\ninclude-system-site-packages = false\n";
        let other_minor = "version = 3.14.7\ninclude-system-site-packages = false\n";
        let invalid = "version = 3.14.7\ninclude-system-site-packages = true\n";
        for (app, selection, config, executable, requirements, expected) in [
            (
                "paper-agent",
                "external",
                Some(other_minor),
                true,
                true,
                "existing",
            ),
            (
                "paper-agent",
                "external",
                Some(compatible),
                true,
                true,
                "existing",
            ),
            (
                "paper-agent",
                "external",
                Some(invalid),
                true,
                true,
                "system-site-packages",
            ),
            (
                "paper-agent",
                "external",
                None,
                false,
                true,
                "pyvenv.cfg is missing",
            ),
            (
                "paper-agent",
                "external",
                Some(compatible),
                false,
                true,
                "interpreter",
            ),
            ("paper-agent", "none", None, false, true, "managed"),
            ("paper-agent", "managed", None, false, true, "managed"),
            (
                "paper-agent",
                "managed",
                Some(invalid),
                false,
                true,
                "system-site-packages",
            ),
            (
                "paper-agent",
                "managed",
                Some(invalid),
                true,
                true,
                "system-site-packages",
            ),
            (
                "control-lab",
                "external",
                Some(other_minor),
                true,
                true,
                "managed",
            ),
            (
                "control-lab",
                "external",
                Some(compatible),
                true,
                true,
                "existing",
            ),
            (
                "control-lab",
                "external",
                Some(invalid),
                true,
                true,
                "system-site-packages",
            ),
            (
                "control-lab",
                "external",
                Some(other_minor),
                false,
                true,
                "interpreter",
            ),
            (
                "control-lab",
                "external",
                Some(other_minor),
                true,
                false,
                "existing",
            ),
            (
                "control-lab",
                "external",
                Some("include-system-site-packages = false\n"),
                true,
                true,
                "version",
            ),
        ] {
            let selected = match selection {
                "external" => Some(&external),
                "managed" => Some(&managed),
                _ => None,
            };
            let app_name = AppName::try_from(app.to_owned()).unwrap();
            let result = PythonPreparation::for_app(
                &app_name,
                selected,
                managed.clone(),
                config,
                executable,
                requirements,
            );
            match expected {
                "existing" => assert!(
                    matches!(result, Ok(PythonPreparation::Existing(_))),
                    "{app}/{selection}: {result:?}"
                ),
                "managed" => assert!(
                    matches!(result, Ok(PythonPreparation::Managed(_))),
                    "{app}/{selection}: {result:?}"
                ),
                error => {
                    let detail = result.unwrap_err();
                    assert!(detail.contains(error), "{app}/{selection}: {detail}");
                    assert!(
                        detail.contains(&selected.unwrap().root().display().to_string()),
                        "{detail}"
                    );
                }
            }
        }
    }
}
