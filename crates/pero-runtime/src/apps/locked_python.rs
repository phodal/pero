//! Explicit, wheel-only Control Lab preparation. AppStore owns publication.
use super::{PythonEnvironment, definition::PythonDependency, preparation, uv_tool};
use crate::environments::{LockedPythonProfile, PythonObservation};
use std::{fs, path::Path, process::Command};

const PYTHON: &str = "3.12.14"; // uv 0.12.20's fixed python-build-standalone table.

pub(super) fn verify(profile: &LockedPythonProfile, app: &Path) -> Result<(), String> {
    profile
        .require(&observe(&profile.root, app)?)
        .map_err(|e| e.to_string())
}

fn observe(root: &Path, app: &Path) -> Result<PythonObservation, String> {
    let python = PythonEnvironment::try_from(root.to_path_buf())?;
    let output = Command::new(python.executable())
        .args([
            "-I",
            "-B",
            "-c",
            include_str!("../../../../apps/control-lab/backend/control_lab/compute_observation.py"),
        ])
        .current_dir(app)
        .env_clear()
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "Compute dependencies unavailable: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}

pub(super) fn copy_recipe(
    catalog: &Path,
    source: &str,
    destination: &str,
    profile: &LockedPythonProfile,
) -> Result<(), String> {
    let source = catalog.join(format!("{source}.recipe"));
    let project = fs::read(source.join("pyproject.toml")).map_err(|e| e.to_string())?;
    let lock = fs::read(source.join("uv.lock")).map_err(|e| e.to_string())?;
    if uv_tool::sha(&project) != profile.project_sha256
        || uv_tool::sha(&lock) != profile.lock_sha256
    {
        return Err("Saved recipe or lock changed; cannot rebuild that profile".into());
    }
    let destination = catalog.join(format!("{destination}.recipe"));
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    fs::write(destination.join("pyproject.toml"), project).map_err(|e| e.to_string())?;
    fs::write(destination.join("uv.lock"), lock).map_err(|e| e.to_string())?;
    fs::write(destination.join("lock.sha256"), &profile.lock_sha256).map_err(|e| e.to_string())
}

pub(super) fn prepare(
    catalog: &Path,
    id: &str,
    dependencies: &[PythonDependency],
    app: &Path,
    log: &mut impl FnMut(String),
) -> Result<LockedPythonProfile, String> {
    let (python_target, python_archive_sha256) =
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => (
                "aarch64-apple-darwin",
                "c2edb321cd32ec2b170df208db0446dccc4398db602ca27cf2079098fb1f7d9d",
            ),
            ("linux", "x86_64") => (
                "x86_64-unknown-linux-gnu",
                "269b2c99e4db15b242bf01832f4fea1e8f1a664f273cff519393f296e9820b41",
            ),
            _ => return Err("Unsupported locked Python platform".into()),
        };
    // These are uv 0.12.20's download-metadata.json inputs, verified by that
    // pinned downloader; never inferred from the observed executable digest.
    let python_archive_url = format!(
        "https://github.com/astral-sh/python-build-standalone/releases/download/20260924/cpython-{PYTHON}%2B20260924-{python_target}-install_only_stripped.tar.gz"
    );
    let home = catalog.parent().ok_or("Environment home missing")?;
    // One local preparation owner, with an OS lock released even if Host exits.
    let guard = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(home.join("uv-preparation.lock"))
        .map_err(|e| e.to_string())?;
    fs2::FileExt::try_lock_exclusive(&guard)
        .map_err(|_| "Another locked environment is preparing; retry after it finishes")?;
    // No published profile reaches this path. Remove this record's interrupted,
    // unpublished generations only when the user explicitly retries preparation.
    for entry in fs::read_dir(catalog).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().map_err(|e| e.to_string())?.is_dir()
            && entry
                .file_name()
                .to_string_lossy()
                .starts_with(&format!("{id}-"))
        {
            fs::remove_dir_all(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    let binary = uv_tool::ensure(home, log)?;
    let recipe = catalog.join(format!("{id}.recipe"));
    fs::create_dir_all(&recipe).map_err(|e| e.to_string())?;
    // Only generate from the installed, validated fixed method manifest. No arbitrary project scripts.
    let project = format!(
        "[project]\nname = \"pero-control-compute\"\nversion = \"0.0.0\"\nrequires-python = \"=={PYTHON}\"\ndependencies = {}\n\n[tool.uv]\npackage = false\n",
        serde_json::to_string(
            &dependencies
                .iter()
                .map(PythonDependency::as_str)
                .collect::<Vec<_>>()
        )
        .map_err(|e| e.to_string())?
    );
    let project_path = recipe.join("pyproject.toml");
    if project_path.exists() {
        if fs::read_to_string(&project_path).map_err(|e| e.to_string())? != project {
            return Err(
                "Recipe changed; create a new environment instead of rewriting a saved lock".into(),
            );
        }
    } else {
        fs::write(&project_path, &project).map_err(|e| e.to_string())?;
    }
    let lock_path = recipe.join("uv.lock");
    if !lock_path.exists() {
        log("Resolving complete dependencies from https://pypi.org/simple".into());
        preparation::run(
            uv_tool::command(&binary, home).current_dir(&recipe).args([
                "lock",
                "--python",
                PYTHON,
                "--managed-python",
                "--no-build",
                "--default-index",
                "https://pypi.org/simple",
            ]),
            log,
        )?;
    }
    let lock_sha256 = uv_tool::sha(&fs::read(&lock_path).map_err(|e| e.to_string())?);
    let lock_digest_path = recipe.join("lock.sha256");
    if lock_digest_path.exists()
        && fs::read_to_string(&lock_digest_path).map_err(|e| e.to_string())? != lock_sha256
    {
        return Err("Saved uv.lock digest changed; no installation attempted".into());
    }
    fs::write(&lock_digest_path, &lock_sha256).map_err(|e| e.to_string())?;
    // An unpublished generation stays at its final physical path: relocating a
    // venv would invalidate script shebangs. The catalog record is the atomic publication.
    let root = catalog.join(format!("{id}-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        log("Installing frozen wheels into a new unpublished compute prefix".into());
        preparation::run(
            uv_tool::command(&binary, home)
                .current_dir(&recipe)
                .env("UV_PROJECT_ENVIRONMENT", &root)
                .args([
                    "sync",
                    "--locked",
                    "--python",
                    PYTHON,
                    "--managed-python",
                    "--no-build",
                    "--no-dev",
                    "--no-install-project",
                    "--default-index",
                    "https://pypi.org/simple",
                ]),
            log,
        )?;
        let observation = observe(&root, app)?;
        Ok(LockedPythonProfile {
            root: root.clone(),
            project_sha256: uv_tool::sha(project.as_bytes()),
            lock_sha256,
            python_request: PYTHON.into(),
            python_archive_url,
            python_archive_sha256: python_archive_sha256.into(),
            uv_version: uv_tool::VERSION.into(),
            uv_sha256: uv_tool::sha(&fs::read(&binary).map_err(|e| e.to_string())?),
            observation,
        })
    })();
    if result.is_err() && root.exists() {
        fs::remove_dir_all(root).map_err(|e| e.to_string())?;
    }
    result
}

#[cfg(test)]
mod tests;
