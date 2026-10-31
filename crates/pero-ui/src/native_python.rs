//! Prepare the native shell's shared App environment before starting the Host.
use std::{path::Path, process::Command};

pub fn prepare(settings: &Path, home: &Path) -> anyhow::Result<()> {
    // Explicit interpreter selections remain owned by their caller.
    if std::env::var_os("PERO_APP_PYTHON").is_some() {
        return Ok(());
    }
    let mut value: serde_json::Value = if settings.exists() {
        serde_json::from_slice(&std::fs::read(settings)?)?
    } else {
        serde_json::json!({})
    };
    let root = home.join("environment/pero-default");
    if value
        .pointer("/app_python/default")
        .and_then(|v| v.as_str())
        .is_some_and(|v| !v.is_empty() && Path::new(v) != root)
    {
        return Ok(());
    }
    let python = root.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    });
    if !python.exists() {
        std::fs::create_dir_all(root.parent().expect("environment parent"))?;
        anyhow::ensure!(
            Command::new("python3")
                .args(["-m", "venv"])
                .arg(&root)
                .status()?
                .success(),
            "Could not create the shared App Python environment"
        );
    }
    let config = std::fs::read_to_string(root.join("pyvenv.cfg"))?;
    let isolated = config
        .lines()
        .filter_map(|line| line.split_once('='))
        .filter(|(key, _)| {
            key.trim()
                .eq_ignore_ascii_case("include-system-site-packages")
        })
        .map(|(_, value)| value.trim())
        .last()
        .is_some_and(|value| value.eq_ignore_ascii_case("false"));
    anyhow::ensure!(
        isolated,
        "Shared App Python environment must disable system-site packages"
    );
    let ready = || {
        Command::new(&python)
            .args(["-I", "-c", "import pypdfium2, PIL.Image"])
            .output()
            .map(|output| output.status.success())
    };
    if !ready()? {
        anyhow::ensure!(
            Command::new(&python)
                .args(["-m", "pip", "install", "pypdfium2==5.0.0", "Pillow==12.0.0"])
                .status()?
                .success()
                && ready()?,
            "Could not prepare Paper Agent PDF dependencies"
        );
    }
    if value.get("app_python").is_none() {
        value["app_python"] = serde_json::json!({});
    }
    value["app_python"]["default"] = serde_json::json!(root);
    std::fs::write(settings, serde_json::to_vec_pretty(&value)?)?;
    Ok(())
}
