//! Read-only transport to the Python declaration model. Never evaluates project code.
pub fn inspect(source: &str) -> Result<serde_json::Value, String> {
    if source.is_empty() || source.len() > 2048 {
        return Err("Choose a project path or a GitHub URL pinned to a full commit".into());
    }
    let output = std::process::Command::new(super::python::default_executable())
        .args([
            "-I",
            "-B",
            "-c",
            include_str!(
                "../../../../packages/scientific-runtime/python/pero_environment_proposal.py"
            ),
            source,
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .lines()
            .last()
            .unwrap_or("Declaration inspection failed")
            .to_owned());
    }
    serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
}
