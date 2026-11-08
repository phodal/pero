//! Inputs for a micromamba prefix. The solver stays in the shell.
use super::definition::PythonDependency;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const SOLVER: &str = "micromamba";
pub const SOLVER_VERSION: &str = "2.5.0-2";
pub const CHANNEL: &str = "conda-forge";
pub const MARKER: &str = ".pero-conda-prefix";
/// conda-forge publishes this build for linux-64, osx-64 and win-64.
pub const NGSPICE: &str = "ngspice-exe=41";

/// conda-forge has no osx-arm64 ngspice build.
pub fn ngspice_from_conda_forge() -> bool {
    !cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CondaRecipe {
    pub channels: &'static [&'static str],
    pub specs: Vec<String>,
    pub pip: Vec<String>,
}

pub fn recipe(python_minor: &str, native: Option<&str>, pip: &[PythonDependency]) -> CondaRecipe {
    let mut specs = vec![format!("python={python_minor}"), "pip".to_owned()];
    if let Some(native) = native {
        specs.push(native.to_owned());
    }
    CondaRecipe {
        channels: &[CHANNEL],
        specs,
        pip: pip.iter().map(|pin| pin.as_str().to_owned()).collect(),
    }
}

pub fn create_arguments(root: &Path, prefix: &Path, recipe: &CondaRecipe) -> Vec<String> {
    let mut args = vec![
        "--no-rc".to_owned(),
        "--no-env".to_owned(),
        "-r".to_owned(),
        root.display().to_string(),
        "create".to_owned(),
        "-y".to_owned(),
        "-p".to_owned(),
        prefix.display().to_string(),
        "--override-channels".to_owned(),
    ];
    for channel in recipe.channels {
        args.push("-c".to_owned());
        args.push((*channel).to_owned());
    }
    args.extend(recipe.specs.iter().cloned());
    args
}

pub fn export_arguments(root: &Path, prefix: &Path) -> Vec<String> {
    vec![
        "--no-rc".to_owned(),
        "--no-env".to_owned(),
        "-r".to_owned(),
        root.display().to_string(),
        "env".to_owned(),
        "export".to_owned(),
        "-p".to_owned(),
        prefix.display().to_string(),
        "--explicit".to_owned(),
    ]
}

pub fn pip_arguments(packages: &[String]) -> Vec<String> {
    let mut args = vec![
        "-E".to_owned(),
        "-s".to_owned(),
        "-m".to_owned(),
        "pip".to_owned(),
        "install".to_owned(),
        "--disable-pip-version-check".to_owned(),
        "--no-cache-dir".to_owned(),
        "--only-binary".to_owned(),
        ":all:".to_owned(),
    ];
    args.extend(packages.iter().cloned());
    args
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct PrefixMarker {
    solver: String,
    version: String,
    channels: Vec<String>,
    python: String,
}

pub fn marker_bytes(python: &str) -> Vec<u8> {
    serde_json::to_vec(&PrefixMarker {
        solver: SOLVER.to_owned(),
        version: SOLVER_VERSION.to_owned(),
        channels: vec![CHANNEL.to_owned()],
        python: python.to_owned(),
    })
    .expect("prefix marker")
}

pub fn accept_marker(text: &str) -> Result<String, String> {
    let marker: PrefixMarker = serde_json::from_str(text)
        .map_err(|error| format!("Conda prefix marker is invalid: {error}"))?;
    let python_minor = marker.python.split_once('.').is_some_and(|(major, minor)| {
        !major.is_empty()
            && !minor.is_empty()
            && major.bytes().all(|byte| byte.is_ascii_digit())
            && minor.bytes().all(|byte| byte.is_ascii_digit())
            && !minor.contains('.')
    });
    if marker.solver != SOLVER
        || marker.version != SOLVER_VERSION
        || marker.channels != [CHANNEL]
        || !python_minor
    {
        return Err(
            "Conda prefix marker does not match the pinned micromamba recipe".into(),
        );
    }
    Ok(marker.python)
}

pub fn accept_explicit(text: &str) -> Result<(), String> {
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    let Some((head, rest)) = lines.split_first() else {
        return Err("Micromamba explicit export is empty".into());
    };
    if *head != "@EXPLICIT" {
        return Err("Micromamba explicit export is missing @EXPLICIT".into());
    }
    if rest.is_empty() || rest.iter().any(|line| !line.starts_with("https://")) {
        return Err("Micromamba explicit export must list https package URLs".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pin(value: &str) -> PythonDependency {
        PythonDependency::try_from(value.to_owned()).unwrap()
    }

    #[test]
    fn recipe_pins_python_and_keeps_pip_requirements_exact() {
        let plain = recipe("3.12", None, &[pin("numpy==2.2.6")]);
        assert_eq!(plain.channels, ["conda-forge"]);
        assert_eq!(plain.specs, ["python=3.12", "pip"]);
        assert_eq!(plain.pip, ["numpy==2.2.6"]);
        let with_native = recipe("3.12", Some(NGSPICE), &[]);
        assert!(with_native.specs.iter().any(|spec| spec == NGSPICE));
    }

    #[test]
    fn create_uses_the_private_root_and_overrides_channels() {
        let recipe = recipe("3.12", None, &[]);
        let root = Path::new("/environment/conda");
        let prefix = Path::new("/environment/profiles/env-1");
        let args = create_arguments(root, prefix, &recipe);
        assert_eq!(&args[..2], ["--no-rc", "--no-env"]);
        assert!(args.windows(2).any(|pair| pair[0] == "-r" && pair[1] == root.display().to_string()));
        assert!(args.windows(2).any(|pair| pair[0] == "-p" && pair[1] == prefix.display().to_string()));
        assert!(args.iter().any(|arg| arg == "--override-channels"));
        assert!(args.windows(2).any(|pair| pair == ["-c", "conda-forge"]));
        assert!(args.iter().any(|arg| arg == "python=3.12"));
        assert!(!args.iter().any(|arg| arg.contains("defaults")));
    }

    #[test]
    fn marker_accepts_only_the_pinned_solver() {
        assert_eq!(
            accept_marker(std::str::from_utf8(&marker_bytes("3.12")).unwrap()).unwrap(),
            "3.12"
        );
        assert!(accept_marker(
            r#"{"solver":"micromamba","version":"2.5.0-2","channels":["defaults"],"python":"3.12"}"#
        )
        .is_err());
    }

    #[test]
    fn explicit_export_is_a_list_of_https_urls() {
        accept_explicit(
            "# created\n@EXPLICIT\nhttps://conda.anaconda.org/conda-forge/osx-arm64/python.conda\n",
        )
        .unwrap();
        assert!(accept_explicit("@EXPLICIT\nfile:///local/python.conda\n").is_err());
        assert!(accept_explicit("name: env\n").is_err());
    }

    #[test]
    fn apple_silicon_does_not_request_the_missing_ngspice_build() {
        assert_eq!(
            ngspice_from_conda_forge(),
            !cfg!(all(target_os = "macos", target_arch = "aarch64"))
        );
    }
}
