//! Fixed official uv artifacts. PATH and shell installers are not trust inputs.
use super::preparation;
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
pub(super) const VERSION: &str = "0.12.20";
pub(super) fn sha(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn ensure(home: &Path, log: &mut impl FnMut(String)) -> Result<PathBuf, String> {
    let (target, archive_sha, binary_sha) = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => (
            "aarch64-apple-darwin",
            "848fdeb602ff1a1baacd4f6c8b7bdc6cf1ad026a6d9cf59475fda17c179743ca",
            "2dd23b7aaf10b3d709beb3fcfe6d9cc456136f0dbd0f4b0ebd4f44d4a6a299ee",
        ),
        ("linux", "x86_64") => (
            "x86_64-unknown-linux-gnu",
            "6590717592ace991ff83a63fef799e3ad9d33ecc8f96c5d6bdd732496e79337f",
            "b8299463da6fa7da3b94464444d252d0afca8ac6c96cb229f1baf4012f365246",
        ),
        _ => {
            return Err(
                "Locked compute profiles currently support macOS arm64 and Linux x86_64".into(),
            );
        }
    };
    let tools = home.join(format!("uv-{VERSION}"));
    let binary = tools.join(format!("uv-{target}/uv"));
    if binary.is_file() && sha(&fs::read(&binary).map_err(|e| e.to_string())?) == binary_sha {
        return Ok(binary);
    }
    log(format!("Downloading verified uv {VERSION} ({target})"));
    fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    let bytes = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?
        .get(format!(
            "https://github.com/astral-sh/uv/releases/download/{VERSION}/uv-{target}.tar.gz"
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| e.to_string())?;
    if sha(&bytes) != archive_sha {
        return Err("uv archive digest mismatch".into());
    }
    let archive = tools.join("uv.tar.gz");
    fs::write(&archive, bytes).map_err(|e| e.to_string())?;
    preparation::run(
        Command::new("tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&tools),
        log,
    )?;
    if sha(&fs::read(&binary).map_err(|e| e.to_string())?) != binary_sha {
        return Err("uv executable digest mismatch".into());
    }
    fs::remove_file(archive).map_err(|e| e.to_string())?;
    Ok(binary)
}

pub(super) fn command(binary: &Path, home: &Path) -> Command {
    let mut command = Command::new(binary);
    command.env_clear();
    for key in ["PATH", "HOME", "SYSTEMROOT", "TMPDIR", "TMP", "TEMP"] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    command
        .args(["--no-config", "--no-progress"])
        .env("UV_PYTHON_INSTALL_DIR", home.join("python"))
        .env("UV_CACHE_DIR", home.join("cache"))
        .env("UV_PYTHON_INSTALL_BIN", "0");
    command
}
