//! Fixed installer profiles. Selection is a pure decision over observed Host
//! and interpreter identities, never an App- or model-supplied platform hint.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(super) enum Profile {
    #[serde(rename = "linux-x86_64-cp312")]
    LinuxX86,
    #[serde(rename = "macos-arm64-cp312")]
    MacArm,
}

pub(super) struct HostPlatform<'a> {
    pub os: &'a str,
    pub arch: &'a str,
    pub translated: bool,
    pub macos_major: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub(super) struct PythonIdentity {
    pub platform: String,
    pub machine: String,
    pub implementation: String,
    pub version: [u32; 2],
    pub abi: String,
    pub pointer_width: u32,
    pub debug: bool,
    pub free_threaded: bool,
}

pub(super) const PYTHON_IDENTITY: &str = "import json,platform,struct,sys,sysconfig; print(json.dumps(dict(platform=sys.platform,machine=platform.machine(),implementation=sys.implementation.name,version=list(sys.version_info[:2]),abi=sysconfig.get_config_var('SOABI') or '',pointer_width=struct.calcsize('P')*8,debug=bool(sysconfig.get_config_var('Py_DEBUG')),free_threaded=bool(sysconfig.get_config_var('Py_GIL_DISABLED')))))";

impl Profile {
    pub fn for_host(host: &HostPlatform<'_>) -> Result<Self, String> {
        match (host.os, host.arch) {
            ("linux", "x86_64") => Ok(Self::LinuxX86),
            ("macos", _) if host.translated => Err("Optional Docling setup cannot run from a Rosetta-translated Host. Use native Apple Silicon Pero with native arm64 CPython 3.12 on macOS 14 or later.".into()),
            ("macos", "aarch64") if host.macos_major.is_some_and(|v| v >= 14) => Ok(Self::MacArm),
            ("macos", "aarch64") => Err("Optional Docling setup requires macOS 14 or later; this Host could not verify that requirement.".into()),
            ("macos", _) => Err("This pinned Docling profile does not support Intel Macs. Its Docling Parse and PyTorch versions do not provide compatible Intel Mac wheels.".into()),
            _ => Err("Automatic Docling setup supports Linux x86-64 and native Apple Silicon macOS 14 or later only.".into()),
        }
    }

    pub fn validate_python(self, python: &PythonIdentity) -> Result<(), String> {
        let (platform, machine, abi) = match self {
            Self::LinuxX86 => ("linux", "x86_64", "cpython-312-x86_64-linux-gnu"),
            Self::MacArm => ("darwin", "arm64", "cpython-312-darwin"),
        };
        if python.platform != platform
            || python.machine != machine
            || python.implementation != "cpython"
            || python.version != [3, 12]
            || python.abi != abi
            || python.pointer_width != 64
            || python.debug
            || python.free_threaded
        {
            return Err(format!(
                "Select an existing non-debug CPython 3.12 {machine} Paper environment matching this Host ({platform}, {abi}). The selected interpreter has {} / {} / {} / {:?}. This installer does not acquire Python or translate architectures.",
                python.platform, python.machine, python.abi, python.version
            ));
        }
        Ok(())
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::LinuxX86 => "Linux x86-64 CPU / CPython 3.12",
            Self::MacArm => "macOS 14+ Apple Silicon CPU / native arm64 CPython 3.12",
        }
    }
    pub fn validation(self) -> &'static str {
        match self {
            Self::LinuxX86 => "linux-runtime-tested",
            Self::MacArm => "macos-hosted-runtime-tested",
        }
    }
    pub fn requirements(self) -> &'static str {
        match self {
            Self::LinuxX86 => include_str!("../../../../apps/paper-agent/requirements-docling.txt"),
            Self::MacArm => {
                include_str!("../../../../apps/paper-agent/requirements-docling-macos-arm64.txt")
            }
        }
    }
    pub fn wheels(self) -> &'static str {
        match self {
            Self::LinuxX86 => include_str!("docling-wheels.json"),
            Self::MacArm => include_str!("docling-wheels-macos-arm64.json"),
        }
    }
    pub fn venv_name(self) -> &'static str {
        match self {
            Self::LinuxX86 => "venv",
            Self::MacArm => "venv-macos-arm64-cp312",
        }
    }
    pub fn prerequisites(self) -> &'static str {
        match self {
            Self::LinuxX86 => "Tesseract with English data must already be installed.",
            Self::MacArm => {
                "OCR uses Apple's built-in Vision through pinned ocrmac/PyObjC wheels. No Homebrew or Tesseract installation is performed. Installation and OCR passed on a hosted macOS 26 arm64 runner. Desktop confirmation and interaction remain unverified."
            }
        }
    }
}

impl HostPlatform<'static> {
    pub fn current() -> Self {
        #[cfg(target_os = "macos")]
        let (translated, macos_major) = {
            let mut translated: libc::c_int = 0;
            let mut size = std::mem::size_of_val(&translated);
            // The key is absent on Intel Macs. On Apple Silicon it distinguishes
            // a translated x86-64 Host from the native binary.
            unsafe {
                libc::sysctlbyname(
                    c"sysctl.proc_translated".as_ptr(),
                    (&mut translated as *mut libc::c_int).cast(),
                    &mut size,
                    std::ptr::null_mut(),
                    0,
                );
            }
            let mut version = [0u8; 64];
            let mut size = version.len();
            let result = unsafe {
                libc::sysctlbyname(
                    c"kern.osproductversion".as_ptr(),
                    version.as_mut_ptr().cast(),
                    &mut size,
                    std::ptr::null_mut(),
                    0,
                )
            };
            let major = (result == 0)
                .then(|| {
                    std::str::from_utf8(&version)
                        .ok()
                        .and_then(|s| s.split('.').next()?.parse().ok())
                })
                .flatten();
            (translated == 1, major)
        };
        #[cfg(not(target_os = "macos"))]
        let (translated, macos_major) = (false, None);
        Self {
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            translated,
            macos_major,
        }
    }
}
