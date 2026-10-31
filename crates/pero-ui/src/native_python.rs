//! Bind the default environment; the Host prepares it on first App use.
use std::path::Path;
pub fn prepare(settings: &Path, home: &Path) -> anyhow::Result<()> {
    if std::env::var_os("PERO_APP_PYTHON").is_some() { return Ok(()); }
    let mut value: serde_json::Value = if settings.exists() {
        serde_json::from_slice(&std::fs::read(settings)?)?
    } else { serde_json::json!({}) };
    // Keep an existing default, including a 3.14 pero-default that already has packages.
    if value.pointer("/app_python/default").and_then(|v| v.as_str()).is_some_and(|v| !v.is_empty()) { return Ok(()); }
    if value.get("app_python").is_none() { value["app_python"] = serde_json::json!({}); }
    value["app_python"]["default"] = serde_json::json!(home.join("environment/pero-python312"));
    if let Some(parent) = settings.parent() { std::fs::create_dir_all(parent)?; }
    std::fs::write(settings, serde_json::to_vec_pretty(&value)?)?;
    Ok(())
}
