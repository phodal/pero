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
        ("macos", "x86_64") => (
            "x86_64-apple-darwin",
            "ac54283d211fd77cdc152b67606dbaf6406ff4ab03f3af4ae99468fa8e887141",
            "4b8a2e92e78230f38f6006b8cefa75157865fc3901c8e9b8c2c1f30d0f90d669",
        ),
        ("linux", "aarch64") => (
            "aarch64-unknown-linux-gnu",
            "8a7aad7bc76a2fae5151566ff3e43eacce0b2a113d5e4de3e4afe3e58fa2441e",
            "a034e16d5eca62d31549bbf9ae58015a72b0fdc38c09497a163dca97867c309d",
        ),
        ("windows", "x86_64") => (
            "x86_64-pc-windows-msvc",
            "95f9bc30fbb3574d276e28ac4a6de932d25153645853d13da8c21eec3bc88d06",
            "a0d2742d49564a32488753b02e76276e7b5ef1b1ea8cf30bcbf06ee28f60cd73",
        ),
        ("windows", "aarch64") => (
            "aarch64-pc-windows-msvc",
            "b6bd9218855591742ffd3b00fcf2044b4d2fb6446b6a3545e0dfee447e950388",
            "a8b361c86d8dc53ccf38fc11525e0d1703e26c075c9a356b7d82b5bdaa88febd",
        ),
        _ => {
            return Err("Verified uv supports macOS, Linux and Windows on arm64 and x86_64".into());
        }
    };
    let tools = home.join(format!("uv-{VERSION}"));
    let windows = target.ends_with("windows-msvc");
    let extension = if windows { "zip" } else { "tar.gz" };
    let binary = if windows {
        tools.join("uv.exe")
    } else {
        tools.join(format!("uv-{target}/uv"))
    };
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
            "https://github.com/astral-sh/uv/releases/download/{VERSION}/uv-{target}.{extension}"
        ))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| e.to_string())?;
    if sha(&bytes) != archive_sha {
        return Err("uv archive digest mismatch".into());
    }
    let archive = tools.join(format!("uv.{extension}"));
    fs::write(&archive, bytes).map_err(|e| e.to_string())?;
    if windows {
        preparation::run(Command::new("powershell.exe")
            .args(["-NoProfile","-NonInteractive","-Command","Expand-Archive -LiteralPath $env:PERO_UV_ARCHIVE -DestinationPath $env:PERO_UV_DEST -Force"])
            .env("PERO_UV_ARCHIVE",&archive).env("PERO_UV_DEST",&tools),log)?;
    } else {
        preparation::run(
            Command::new("tar")
                .arg("-xzf")
                .arg(&archive)
                .arg("-C")
                .arg(&tools),
            log,
        )?;
    }
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
