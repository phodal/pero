//! Point directories use the same install request and Rust-owned App store.
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct Prepared {
    path: PathBuf,
    temporary: bool,
}
impl Prepared {
    pub fn path(&self) -> &Path { &self.path }
    pub fn new(source: PathBuf) -> Result<Self, String> {
        let bytes = std::fs::read(source.join("app.json")).map_err(|e| e.to_string())?;
        if bytes.len() > 65536 { return Err("App manifest exceeds 64 KiB".into()); }
        let manifest: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        if manifest.get("schemaVersion").is_some() {
            return Ok(Self { path: source, temporary: false });
        }
        if !manifest["contributes"]["panelTabs"].is_array() { return Err("Unknown App manifest format".into()); }
        let runtime = std::env::var_os("PERO_POINT_RUNTIME_ROOT").map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("packages/point-app/dist"));
        let installer = runtime.join("install.mjs");
        if !installer.is_file() { return Err("This Pero build has no Point App SDK runtime; build the shared Point runtime first".into()); }
        let name = format!("pero-point-install-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos());
        let prepared = Self { path: std::env::temp_dir().join(name), temporary: true };
        let output = Command::new(std::env::var_os("PERO_APP_NODE").unwrap_or_else(|| "node".into()))
            .env("ELECTRON_RUN_AS_NODE", "1")
            .arg(installer).arg("--source").arg(source).arg("--out").arg(&prepared.path)
            .output().map_err(|e| format!("Cannot prepare Point App: {e}"))?;
        if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).chars().take(2000).collect()); }
        Ok(prepared)
    }
}
impl Drop for Prepared {
    fn drop(&mut self) { if self.temporary { let _ = std::fs::remove_dir_all(&self.path); } }
}

/// Private HTTP-shaped operation; no App-selected binary, filesystem root or URL.
#[derive(serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectRequest {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<serde_json::Value>,
}
pub fn projects(root: &Path, request: ProjectRequest) -> Result<serde_json::Value, String> {
    use std::io::Write;
    let runtime = std::env::var_os("PERO_POINT_RUNTIME_ROOT").map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("packages/point-app/dist"));
    let binary = runtime.join(if cfg!(windows) { "point-host.exe" } else { "point-host" });
    let bytes = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    if bytes.len() > 1048576 { return Err("Point Project request exceeds 1 MiB".into()); }
    let mut child = Command::new(binary).arg("--root").arg(root)
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
        .spawn().map_err(|e| format!("Point Project domain is unavailable in this Pero build: {e}"))?;
    let write = child.stdin.take().ok_or("Point Project input unavailable")?.write_all(&bytes);
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    write.map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).chars().take(2000).collect()); }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}
