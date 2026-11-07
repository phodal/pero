//! Download the pinned micromamba and create one scientific prefix.
use super::{
    ScientificMethod,
    conda,
    definition::PythonDependency,
    preparation,
    python::PythonEnvironment,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

const RELEASE: &str = conda::SOLVER_VERSION;

struct Asset {
    name: &'static str,
    sha256: &'static str,
}

fn asset() -> Result<Asset, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok(Asset {
            name: "osx-arm64",
            sha256: "22953898e3cfd63c680d696a204c7858ce7f10a10c271bda7e6defd63370ee41",
        }),
        ("macos", "x86_64") => Ok(Asset {
            name: "osx-64",
            sha256: "d6542ddf80e0b81b8538f811dd64ad5804373206bc0128cbc4a8833efe67547b",
        }),
        ("linux", "x86_64") => Ok(Asset {
            name: "linux-64",
            sha256: "c04571cfb0750e5432d530a3068b8fcd232ebed3133358e056e59a90b9852b00",
        }),
        ("linux", "aarch64") => Ok(Asset {
            name: "linux-aarch64",
            sha256: "a64db0d7a82107c8d64357cf035fb8f9dbbe2fc48f48b302cbc8ba1590974e20",
        }),
        ("windows", "x86_64") => Ok(Asset {
            name: "win-64",
            sha256: "baf6d56a31a63a75f0c77bdce27fefea57b1bdc8aa25b50a1be45696c0e737e7",
        }),
        (os, arch) => Err(format!("No micromamba binary for {os}/{arch}")),
    }
}

fn sha256(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn environment_home(catalog: &Path) -> Result<PathBuf, String> {
    catalog
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Environment catalog needs a parent".to_owned())
}

fn binary_path(tools: &Path) -> PathBuf {
    tools.join(if cfg!(windows) { "micromamba.exe" } else { "micromamba" })
}

fn ensure_binary(tools: &Path, log: &mut impl FnMut(String)) -> Result<PathBuf, String> {
    let asset = asset()?;
    let binary = binary_path(tools);
    if binary.is_file() && sha256(&fs::read(&binary).map_err(|e| e.to_string())?) == asset.sha256 {
        return Ok(binary);
    }
    log(format!("Downloading micromamba {RELEASE}"));
    fs::create_dir_all(tools).map_err(|e| e.to_string())?;
    let url = format!(
        "https://github.com/mamba-org/micromamba-releases/releases/download/{RELEASE}/micromamba-{}",
        asset.name
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;
    let bytes = client
        .get(url)
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.bytes())
        .map_err(|e| format!("Cannot download micromamba: {e}"))?;
    let digest = sha256(&bytes);
    if digest != asset.sha256 {
        return Err(format!(
            "micromamba-{} sha256 mismatch (pinned {RELEASE}): expected {}, got {digest}",
            asset.name, asset.sha256
        ));
    }
    let partial = binary.with_extension("download");
    fs::write(&partial, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&partial, &binary).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    }
    Ok(binary)
}

fn solver(binary: &Path) -> Command {
    let mut command = Command::new(binary);
    for key in [
        "CONDARC",
        "MAMBA_ROOT_PREFIX",
        "CONDA_ENVS_PATH",
        "CONDA_PKGS_DIRS",
        "CONDA_PREFIX",
    ] {
        command.env_remove(key);
    }
    command
}

fn capture(command: &mut Command) -> Result<String, String> {
    let output = command
        .output()
        .map_err(|e| format!("Cannot run micromamba: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "micromamba failed ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    String::from_utf8(output.stdout).map_err(|e| e.to_string())
}

fn install_pip(python: &Path, packages: &[String], log: &mut impl FnMut(String)) -> Result<(), String> {
    if packages.is_empty() {
        return Ok(());
    }
    log(format!("Installing {}", packages.join(", ")));
    let mut command = Command::new(python);
    command.args(conda::pip_arguments(packages));
    for key in ["PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE", "PIP_CONFIG_FILE"] {
        command.env_remove(key);
    }
    preparation::run(&mut command, log)
}

fn install_homebrew_ngspice(prefix: &Path, log: &mut impl FnMut(String)) -> Result<(), String> {
    log("Installing ngspice with Homebrew because conda-forge has no Apple Silicon build".into());
    let mut command = Command::new("brew");
    command.args(["install", "ngspice"]).env("HOMEBREW_NO_AUTO_UPDATE", "1");
    preparation::run(&mut command, log)?;
    let output = Command::new("brew")
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
        let link = prefix.join("bin/ngspice");
        if link.symlink_metadata().is_ok() {
            fs::remove_file(&link).map_err(|e| e.to_string())?;
        }
        std::os::unix::fs::symlink(program, link).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        let _ = program;
        return Err("Homebrew ngspice is only linked on Unix".into());
    }
    Ok(())
}

pub(super) fn prepare(
    catalog: &Path,
    id: &str,
    method: ScientificMethod,
    dependencies: &[PythonDependency],
    log: &mut impl FnMut(String),
) -> Result<PythonEnvironment, String> {
    let home = environment_home(catalog)?;
    let binary = ensure_binary(&home.join("tools"), log)?;
    let root = home.join("conda");
    let prefix = catalog.join(id);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    if prefix.exists() {
        fs::remove_dir_all(&prefix).map_err(|e| e.to_string())?;
    }
    let native = (matches!(method, ScientificMethod::Circuit) && conda::ngspice_from_conda_forge())
        .then_some(conda::NGSPICE);
    let recipe = conda::recipe(method.python_minor(), native, dependencies);
    log(format!("Creating conda prefix {}", prefix.display()));
    let mut command = solver(&binary);
    command.args(conda::create_arguments(&root, &prefix, &recipe));
    preparation::run(&mut command, log)?;
    let environment = PythonEnvironment::try_from(prefix.clone())?;
    install_pip(&environment.executable(), &recipe.pip, log)?;
    if matches!(method, ScientificMethod::Circuit) && !conda::ngspice_from_conda_forge() {
        install_homebrew_ngspice(&prefix, log)?;
    }
    let mut export = solver(&binary);
    export.args(conda::export_arguments(&root, &prefix));
    let explicit = capture(&mut export)?;
    conda::accept_explicit(&explicit)?;
    fs::write(catalog.join(format!("{id}.explicit.txt")), explicit).map_err(|e| e.to_string())?;
    fs::write(prefix.join(conda::MARKER), conda::marker_bytes(method.python_minor()))
        .map_err(|e| e.to_string())?;
    Ok(environment)
}

pub(super) fn pip_find_links(
    python: &Path,
    find_links: &str,
    packages: &[&str],
    log: &mut impl FnMut(String),
) -> Result<(), String> {
    log("Installing PyG wheels into the conda prefix".into());
    let mut args = conda::pip_arguments(&[]);
    args.extend(["-f".to_owned(), find_links.to_owned()]);
    args.extend(packages.iter().map(|package| (*package).to_owned()));
    let mut command = Command::new(python);
    command.args(args);
    for key in ["PYTHONPATH", "PYTHONHOME", "PYTHONUSERBASE", "PIP_CONFIG_FILE"] {
        command.env_remove(key);
    }
    preparation::run(&mut command, log)
}
