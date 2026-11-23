//! Resolve installed runtime resources once, before starting the native shell.
use std::path::{Path, PathBuf};

pub(crate) struct NativeDistribution {
    pub root: PathBuf,
    pub host: PathBuf,
    pub node: Option<PathBuf>,
    pub repl_python: Option<PathBuf>,
    pub computer: PathBuf,
    pub packaged: bool,
}

impl NativeDistribution {
    pub fn open(executable: &Path, checkout: &Path) -> anyhow::Result<Self> {
        let payload = executable.parent().unwrap().join("../Resources/app");
        let packaged = payload.join("products/pero.json").is_file();
        let root = if packaged {
            payload
        } else {
            checkout.to_owned()
        }
        .canonicalize()?;
        let host = root.join(if packaged {
            "bin/pero-host"
        } else if cfg!(debug_assertions) {
            "target/debug/pero-host"
        } else {
            "target/release/pero-host"
        });
        let node = packaged.then(|| root.join("bin/node"));
        let repl_python =
            (packaged && cfg!(target_os = "macos")).then(|| root.join("runtime/python/bin/python3"));
        if packaged
            && (!host.is_file()
                || node.as_ref().is_some_and(|path| !path.is_file())
                || repl_python.as_ref().is_some_and(|path| !path.is_file()))
        {
            anyhow::bail!("Native runtime is incomplete: {}", root.display());
        }
        let computer = if cfg!(target_os = "macos") {
            if packaged {
                executable
                    .ancestors()
                    .nth(3)
                    .unwrap()
                    .with_file_name("Pero Computer Use.app")
            } else {
                host.with_file_name("Pero Computer Use.app")
            }
        } else {
            host.with_file_name(if cfg!(target_os = "windows") {
                "pero-computer.exe"
            } else {
                "pero-computer"
            })
        };
        Ok(Self {
            root,
            host,
            node,
            repl_python,
            computer,
            packaged,
        })
    }
}
