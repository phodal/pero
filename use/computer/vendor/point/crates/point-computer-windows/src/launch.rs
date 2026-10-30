//! Windows 应用启动:信任根下的 `.exe`,绝不走 PATH / App Paths / Start Menu。
//!
//! HKCU App Paths、每用户 Start Menu、`%LOCALAPPDATA%\WindowsApps` 均为
//! agent 可写(REF 实测)。收下它们等于「种一个 exe 再启动它」。本模块只扫
//! [`APP_ROOTS`];解析出的是**已验证路径**,`CreateProcess` 收路径不收名字。
//!
//! 终端无论住在哪都拒绝:后续按键会到达一个无 denylist 的 shell。

use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use point_computer_core::types::{ComputerUseError, LaunchIdentity, MAX_LAUNCH_SUGGESTIONS, fill};

use crate::apps;

/// 可启动 exe 所在的根,最信任的在前(同名时系统目录胜出)。
///
/// 用户可写位置刻意缺席:Start Menu、App Paths、WindowsApps、桌面。
pub const APP_ROOTS: [&str; 3] = [r"C:\Windows\System32", r"C:\Program Files", r"C:\Program Files (x86)"];

const EXE_SUFFIX: &str = ".exe";
const WRITE_PROBE_NAME: &str = ".point-launch-write-probe";

const REFUSED_EXES: [&str; 12] = [
	"cmd",
	"cmd.exe",
	"powershell",
	"powershell.exe",
	"pwsh",
	"pwsh.exe",
	"wt",
	"wt.exe",
	"windowsterminal",
	"windowsterminal.exe",
	"conhost",
	"conhost.exe",
];

const ERR_WRITABLE_ROOT: &str = "'{name}' is installed where this user can replace it, so it was not launched: an executable anyone can overwrite is indistinguishable from one the operator installed. Install it under C:\\Windows\\System32 or C:\\Program Files, or open it yourself";
const ERR_SHELL_TARGET: &str = "'{name}' is a terminal, so it is not a launch target: a shell takes its instructions from input rather than from the launch, which is the one thing the no-arguments rule cannot bound. Launch the application you want to use";
const ERR_PATH_QUERY: &str = "launch_app takes an application name, not a filesystem path";

/// 一个已安装 exe:显示名与找到它的根。
#[derive(Clone, Debug, PartialEq)]
pub struct InstalledApp {
	pub name: String,
	pub path: PathBuf,
	pub source: PathBuf,
}

pub fn installed_apps() -> Vec<InstalledApp> {
	installed_apps_in(&APP_ROOTS.map(Path::new))
}

fn installed_apps_in(roots: &[&Path]) -> Vec<InstalledApp> {
	let mut out = Vec::new();
	let mut seen: Vec<String> = Vec::new();
	for root in roots {
		push_exes(root, *root, &mut out, &mut seen);
		let Ok(entries) = std::fs::read_dir(root) else {
			continue;
		};
		let mut dirs: Vec<PathBuf> = entries
			.filter_map(|entry| entry.ok())
			.map(|entry| entry.path())
			.filter(|path| path.is_dir() && !is_symlink(path))
			.collect();
		dirs.sort();
		for dir in dirs {
			push_exes(&dir, *root, &mut out, &mut seen);
		}
	}
	out
}

fn push_exes(dir: &Path, source: &Path, out: &mut Vec<InstalledApp>, seen: &mut Vec<String>) {
	let Ok(entries) = std::fs::read_dir(dir) else {
		return;
	};
	let mut names: Vec<String> =
		entries.filter_map(|entry| entry.ok()).filter_map(|entry| entry.file_name().into_string().ok()).collect();
	names.sort();
	for entry in names {
		if !entry.to_lowercase().ends_with(EXE_SUFFIX) {
			continue;
		}
		let stem = entry[..entry.len() - EXE_SUFFIX.len()].to_string();
		let folded = stem.to_lowercase();
		if seen.contains(&folded) {
			continue;
		}
		let path = dir.join(&entry);
		if !path.is_file() || is_symlink(&path) {
			continue;
		}
		seen.push(folded);
		out.push(InstalledApp { name: stem, path, source: source.to_path_buf() });
	}
}

fn is_symlink(path: &Path) -> bool {
	std::fs::symlink_metadata(path).map(|meta| meta.file_type().is_symlink()).unwrap_or(false)
}

fn directory_is_writable(directory: &Path) -> bool {
	let probe = directory.join(WRITE_PROBE_NAME);
	match OpenOptions::new().write(true).create_new(true).open(&probe) {
		Ok(_file) => {
			let _ = std::fs::remove_file(&probe);
			true
		}
		Err(err) => match err.kind() {
			ErrorKind::PermissionDenied | ErrorKind::NotFound | ErrorKind::NotADirectory => false,
			_ => true,
		},
	}
}

fn file_is_replaceable(path: &Path) -> bool {
	match OpenOptions::new().write(true).open(path) {
		Ok(_) => true,
		Err(_) => std::fs::metadata(path).is_err(),
	}
}

fn is_trusted_catalog_root(source: &Path) -> bool {
	APP_ROOTS.iter().any(|root| Path::new(root) == source)
}

fn writable_component(app: &InstalledApp) -> bool {
	let parent = app.path.parent().unwrap_or(Path::new("/"));
	directory_is_writable(parent) || directory_is_writable(&app.path) || file_is_replaceable(&app.path)
}

pub fn resolve_target(query: &str) -> Result<(String, String), ComputerUseError> {
	resolve_in(&installed_apps(), query)
}

fn resolve_in(catalog: &[InstalledApp], query: &str) -> Result<(String, String), ComputerUseError> {
	let app = resolve_match(catalog, query)?;
	if !is_trusted_catalog_root(&app.source) && writable_component(app) {
		return Err(ComputerUseError::Denied(fill(ERR_WRITABLE_ROOT, &[("{name}", &app.name)])));
	}
	Ok((app.path.to_string_lossy().into_owned(), app.name.clone()))
}

fn looks_like_path(query: &str) -> bool {
	query.contains('/') || query.contains('\\') || query.contains(':')
}

fn resolve_match<'a>(catalog: &'a [InstalledApp], query: &str) -> Result<&'a InstalledApp, ComputerUseError> {
	let wanted = query.trim().to_lowercase();
	if wanted.is_empty() {
		return Err(ComputerUseError::NoSuchLaunchTarget { query: query.to_string(), near: String::new() });
	}
	if looks_like_path(query) {
		return Err(ComputerUseError::Denied(ERR_PATH_QUERY.to_string()));
	}
	if REFUSED_EXES.contains(&wanted.as_str()) {
		return Err(ComputerUseError::Denied(fill(ERR_SHELL_TARGET, &[("{name}", query)])));
	}
	let mut matched: Vec<&InstalledApp> = catalog.iter().filter(|app| app.name.to_lowercase() == wanted).collect();
	if matched.is_empty() {
		let prefixed: Vec<&InstalledApp> =
			catalog.iter().filter(|app| app.name.to_lowercase().starts_with(&wanted)).collect();
		if prefixed.len() > 1 {
			let mut names: Vec<String> = prefixed.iter().map(|app| app.name.clone()).collect();
			names.sort();
			names.dedup();
			names.truncate(MAX_LAUNCH_SUGGESTIONS);
			return Err(ComputerUseError::AmbiguousLaunchTarget { names: names.join(", "), count: prefixed.len() });
		}
		matched = prefixed;
	}
	let Some(app) = matched.first() else {
		let near = catalog
			.iter()
			.filter(|app| app.name.to_lowercase().contains(&wanted))
			.map(|app| app.name.clone())
			.collect::<Vec<String>>()
			.join(", ");
		return Err(ComputerUseError::NoSuchLaunchTarget { query: query.to_string(), near });
	};
	if REFUSED_EXES.contains(&app.name.to_lowercase().as_str()) {
		return Err(ComputerUseError::Denied(fill(ERR_SHELL_TARGET, &[("{name}", &app.name)])));
	}
	Ok(app)
}

pub fn target_identity(exe_path: &str, display: &str) -> LaunchIdentity {
	// 手拆最后一段:darwin CI 上 `Path::file_name` 不认 `\`。deny 规则
	// 写的是 exe 文件名,必须跨平台得到同一 key。
	let key = exe_path
		.rsplit(['\\', '/'])
		.next()
		.filter(|name| !name.is_empty())
		.unwrap_or(display)
		.to_string();
	LaunchIdentity { display: display.to_string(), key }
}

pub fn spawn_detached(exe_path: &str) -> Result<(), String> {
	#[cfg(not(windows))]
	{
		let _ = exe_path;
		return Err("launch is only available on Windows".into());
	}
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		const DETACHED_PROCESS: u32 = 0x0000_0008;
		const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
		let path = Path::new(exe_path);
		if !path.is_file() {
			return Err(format!("{exe_path} is not an executable on this host"));
		}
		crate::execution::check()?;
		match std::process::Command::new(path)
			.stdin(std::process::Stdio::null())
			.stdout(std::process::Stdio::null())
			.stderr(std::process::Stdio::null())
			.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP)
			.spawn()
		{
			Ok(child) => {
				drop(child);
				Ok(())
			}
			Err(err) => Err(err.to_string()),
		}
	}
}

pub fn running_app(name: &str) -> Option<point_computer_core::types::AppRef> {
	apps::running_app(name)
}

#[cfg(test)]
mod tests {
	use super::*;

	struct Cleanup(PathBuf);

	impl Drop for Cleanup {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.0);
		}
	}

	fn make_exe(dir: &Path, name: &str) -> PathBuf {
		std::fs::create_dir_all(dir).expect("create dir");
		let path = dir.join(format!("{name}.exe"));
		std::fs::write(&path, b"MZ").expect("write exe");
		path
	}

	fn fixture(label: &str, names_by_root: &[(&str, &[&str])]) -> (PathBuf, Cleanup) {
		let root = std::env::temp_dir().join(format!("point-win-launch-{label}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&root);
		for (dir, names) in names_by_root {
			let sub = root.join(dir);
			for name in *names {
				make_exe(&sub, name);
			}
		}
		(root.clone(), Cleanup(root))
	}

	fn catalog_at(root: &Path) -> Vec<InstalledApp> {
		let system = root.join("system");
		let programs = root.join("programs");
		installed_apps_in(&[system.as_path(), programs.as_path()])
	}

	fn paper_catalog() -> Vec<InstalledApp> {
		[
			("Notepad", r"C:\Windows\System32"),
			("mspaint", r"C:\Windows\System32"),
			("Notepad++", r"C:\Program Files"),
			("Firefox", r"C:\Program Files"),
		]
		.iter()
		.map(|(name, root)| InstalledApp {
			name: (*name).to_string(),
			path: PathBuf::from(*root).join(format!("{name}.exe")),
			source: PathBuf::from(*root),
		})
		.collect()
	}

	#[test]
	fn installed_apps_lists_sorted_deduped_exes_only() {
		let (root, _cleanup) =
			fixture("list", &[("system", &["Notepad", "Zoo"]), ("programs", &["Bar", "Zoo"])]);
		std::fs::create_dir_all(root.join("system").join("PlainDirectory")).unwrap();
		std::fs::write(root.join("system").join("Notes.txt"), b"x").unwrap();
		let catalog = catalog_at(&root);
		let names: Vec<&str> = catalog.iter().map(|app| app.name.as_str()).collect();
		assert_eq!(names, ["Notepad", "Zoo", "Bar"]);
		assert!(catalog.iter().all(|app| app.path.is_file()));
		assert_eq!(catalog[0].source, root.join("system"));
	}

	#[test]
	fn resolve_ladder_exact_prefix_ambiguous_miss() {
		let catalog = paper_catalog();
		let app = resolve_match(&catalog, "  NOTEPAD ").unwrap();
		assert_eq!(app.name, "Notepad");
		assert_eq!(resolve_match(&catalog, "fire").unwrap().name, "Firefox");
		let err = resolve_match(&catalog, "n").unwrap_err();
		let ComputerUseError::AmbiguousLaunchTarget { names, count } = err else {
			panic!("expected ambiguous, got {err}");
		};
		assert_eq!(count, 2);
		assert_eq!(names, "Notepad, Notepad++");
		let ComputerUseError::NoSuchLaunchTarget { near, .. } = resolve_match(&catalog, "zzz").unwrap_err() else {
			panic!("expected no-such");
		};
		assert!(near.is_empty(), "{near}");
		let ComputerUseError::NoSuchLaunchTarget { near, .. } = resolve_match(&catalog, "paint").unwrap_err() else {
			panic!("expected no-such");
		};
		assert!(near.contains("mspaint"), "{near}");
		assert!(matches!(resolve_match(&catalog, "   "), Err(ComputerUseError::NoSuchLaunchTarget { .. })));
	}

	#[test]
	fn terminals_are_refused_before_and_after_resolution() {
		let catalog: Vec<InstalledApp> = ["cmd", "Hype"]
			.iter()
			.map(|name| InstalledApp {
				name: (*name).to_string(),
				path: PathBuf::from(format!(r"C:\{name}.exe")),
				source: PathBuf::from(r"C:\Windows\System32"),
			})
			.collect();
		let err = resolve_match(&catalog, "powershell").unwrap_err().to_string();
		assert!(err.contains("is a terminal"), "{err}");
		assert!(err.contains("'powershell'"), "{err}");
		let err = resolve_match(&catalog, "cm").unwrap_err().to_string();
		assert!(err.contains("is a terminal"), "{err}");
		assert!(err.contains("'cmd'"), "{err}");
		assert_eq!(resolve_match(&catalog, "hype").unwrap().name, "Hype");
	}

	#[test]
	fn path_shaped_queries_are_refused() {
		let catalog = paper_catalog();
		let err = resolve_match(&catalog, r"C:\Windows\System32\notepad.exe").unwrap_err().to_string();
		assert!(err.contains("not a filesystem path"), "{err}");
		let err = resolve_match(&catalog, "../notepad").unwrap_err().to_string();
		assert!(err.contains("not a filesystem path"), "{err}");
	}

	#[test]
	fn a_writable_install_refuses_rather_than_launches() {
		let (root, _cleanup) = fixture("writable", &[("programs", &["Plant"])]);
		let catalog = catalog_at(&root);
		let err = resolve_in(&catalog, "plant").unwrap_err().to_string();
		assert!(err.contains("this user can replace it"), "{err}");
	}

	#[test]
	fn trusted_catalog_root_skips_the_writable_probe() {
		let (root, _cleanup) = fixture("trusted-root", &[("programs", &["Plant"])]);
		let mut catalog = catalog_at(&root);
		catalog[0].source = PathBuf::from(r"C:\Program Files");
		let (path, name) = resolve_in(&catalog, "plant").expect("trusted catalog root skips the probe");
		assert_eq!(name, "Plant");
		assert!(path.ends_with("Plant.exe"), "{path}");
	}

	#[test]
	fn target_identity_uses_the_exe_filename() {
		let identity = target_identity(r"C:\Windows\System32\notepad.exe", "Notepad");
		assert_eq!(identity.display, "Notepad");
		assert_eq!(identity.key, "notepad.exe");
	}

	#[test]
	fn spawn_off_windows_is_a_named_refusal() {
		if cfg!(windows) {
			return;
		}
		let err = spawn_detached("/tmp/nope.exe").unwrap_err();
		assert!(err.contains("only available on Windows"), "{err}");
	}
}
