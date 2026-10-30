//! Windows 应用发现:只从 HWND 枚举,绝不进程名搜索。
//! `pid_owns_point` 是 global 点击的收容:z 序第一个盖住该像素的窗口必须属于获批 pid。

use std::collections::HashMap;

use point_computer_core::policy;
use point_computer_core::types::{AppRef, ComputerUseError, ERR_APP_NOT_FOUND, Frame, TOOL_LIST_APPS, fill};

use crate::ffi::{self, WINDOW_LAYER_NORMAL, WindowInfo};

/// 有在屏普通窗口的应用,每 pid 一条。标题命中拒绝名单的窗口优先保留。
pub fn list_apps() -> Vec<AppRef> {
	list_from(&ffi::window_list())
}

pub(crate) fn list_from(windows: &[WindowInfo]) -> Vec<AppRef> {
	let mut seen: HashMap<i32, AppRef> = HashMap::new();
	for info in windows {
		if info.layer != WINDOW_LAYER_NORMAL {
			continue;
		}
		if info.pid <= 0 || info.owner_name.is_empty() {
			continue;
		}
		if let Some(existing) = seen.get(&info.pid)
			&& policy::title_is_denied(&existing.window_title)
		{
			continue;
		}
		if let Some(existing) = seen.get(&info.pid)
			&& !policy::title_is_denied(&info.title)
			&& (!existing.window_title.is_empty() || info.title.is_empty())
		{
			continue;
		}
		seen.insert(info.pid, app_from(info));
	}
	seen.into_values().collect()
}

fn app_from(info: &WindowInfo) -> AppRef {
	let hosted = is_host_broker(&info.owner_name);
	let label = if hosted && !info.title.is_empty() { info.title.clone() } else { info.owner_name.clone() };
	AppRef {
		name: label.clone(),
		pid: info.pid,
		bundle_id: label,
		window_id: info.window_id,
		window_title: info.title.clone(),
	}
}

fn is_host_broker(owner: &str) -> bool {
	let lower = owner.to_lowercase();
	lower == "applicationframehost.exe" || lower == "wwahost.exe"
}

pub fn resolve_app(query: &str) -> Result<AppRef, ComputerUseError> {
	let needle = query.trim().to_lowercase();
	if needle.is_empty() {
		return Err(app_not_found(query));
	}
	resolve_from(&list_apps(), &needle).ok_or_else(|| app_not_found(query))
}

fn resolve_from(apps: &[AppRef], needle: &str) -> Option<AppRef> {
	let exact_bundle = apps.iter().find(|app| !app.bundle_id.is_empty() && app.bundle_id.to_lowercase() == needle);
	if exact_bundle.is_some() {
		return exact_bundle.cloned();
	}
	let exact_name = apps.iter().find(|app| !app.name.is_empty() && app.name.to_lowercase() == needle);
	if exact_name.is_some() {
		return exact_name.cloned();
	}
	let sub_bundle = apps.iter().find(|app| !app.bundle_id.is_empty() && app.bundle_id.to_lowercase().contains(needle));
	if sub_bundle.is_some() {
		return sub_bundle.cloned();
	}
	apps.iter().find(|app| !app.name.is_empty() && app.name.to_lowercase().contains(needle)).cloned()
}

fn app_not_found(query: &str) -> ComputerUseError {
	ComputerUseError::Denied(fill(ERR_APP_NOT_FOUND, &[("{query}", query), ("{tool}", TOOL_LIST_APPS)]))
}

/// 按显示名或 exe 键找已运行窗口(launch 确认用)。
pub fn running_app(name: &str) -> Option<AppRef> {
	let wanted = name.trim().to_lowercase();
	if wanted.is_empty() {
		return None;
	}
	running_from(&list_apps(), &wanted)
}
fn running_from(apps: &[AppRef], wanted: &str) -> Option<AppRef> {
	apps.iter()
		.find(|app| {
			[&app.name, &app.bundle_id].iter().any(|label| {
				let label = label.to_lowercase();
				label == wanted || label.strip_suffix(".exe") == Some(wanted)
			})
		})
		.cloned()
}

pub fn pid_owns_point(pid: i32, x: f64, y: f64) -> bool {
	owns_point(&ffi::window_list(), pid, x, y)
}

/// z 序第一个包含该点的窗口必须属于 *pid* 且为普通层。
/// 无 bounds 的窗口无法命中测试,跳过;扫完仍无命中 → false(fail-closed)。
pub(crate) fn owns_point(windows: &[WindowInfo], pid: i32, x: f64, y: f64) -> bool {
	for info in windows {
		let Some((left, top, width, height)) = info.bounds else {
			continue;
		};
		if !(left <= x && x < left + width && top <= y && y < top + height) {
			continue;
		}
		return info.pid == pid && info.layer == WINDOW_LAYER_NORMAL;
	}
	false
}

pub fn window_bounds(window_id: u32, pid: i32) -> Option<Frame> {
	for info in ffi::window_list() {
		if info.window_id == window_id && info.pid == pid {
			let (x, y, w, h) = info.bounds?;
			return Some(Frame { x, y, w, h });
		}
	}
	None
}

pub fn window_for_app(app: &AppRef) -> Option<WindowInfo> {
	let windows = ffi::window_list();
	windows
		.iter()
		.find(|info| info.window_id == app.window_id && info.pid == app.pid)
		.cloned()
		.or_else(|| windows.into_iter().find(|info| info.pid == app.pid && info.layer == WINDOW_LAYER_NORMAL))
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn launch_stem_matches_native_executable_identity_without_prefix_aliases() {
		let app = AppRef { name: "Notepad.exe".into(), bundle_id: "Notepad.exe".into(), pid: 42, ..Default::default() };
		assert_eq!(running_from(std::slice::from_ref(&app), "notepad"), Some(app.clone()));
		assert_eq!(running_from(std::slice::from_ref(&app), "notepad.exe"), Some(app.clone()));
		assert!(running_from(std::slice::from_ref(&app), "note").is_none());
		assert!(
			running_from(
				&[AppRef { name: "Notepad++.exe".into(), bundle_id: "Notepad++.exe".into(), ..app }],
				"notepad"
			)
			.is_none()
		);
	}
}
