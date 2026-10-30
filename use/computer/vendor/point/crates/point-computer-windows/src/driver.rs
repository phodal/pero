//! Windows: bounded UIA, focused Unicode/logical keys, JPEG and explicit global pointer.
//! Unsupported control patterns fail closed; UIA targets never fall back to coordinates.

use std::panic::{AssertUnwindSafe, catch_unwind};

use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_backend::launch::{LaunchAdapter, run_launch_default};
use point_computer_core::cursor_motion;
use point_computer_core::types::{
	AppRef, BackendStatus, ClickMethod, ClickRequest, DEFAULT_DRAG_STEPS, DragPath, DragRequest, DriverResult,
	ERR_POINT_NOT_OWNED, ERR_POINT_REQUIRED, ElementRec, MouseButton, PERMISSION_UNSUPPORTED, PLATFORM_WINDOWS,
	PermissionProbe, REFUSAL_ACCESSIBILITY_NEEDS_INDEX, ScrollDirection, SnapshotRequest, fill,
};

use crate::{apps, capture, ffi, launch, snapshot};

/// Remaining patterns require their own native implementation and acceptance.
pub const NOT_IMPLEMENTED_REASON: &str =
	"set_value, scroll and perform_action patterns are unavailable in this Windows release";

/// 无 UIA Focus 不盲打。前台窗口也不能证明键会落到模型点名的控件上。
pub const REFUSE_NO_UIA_FOCUS: &str =
	"typing and keypress require an observed, focused UIA element; keystrokes were NOT sent";

// ── 按名拒绝(REF 逐字;平台事实,随实现保留) ──

/// `app_post`:macOS 专属。Windows 没有任何按进程鼠标路由。
pub const REFUSE_APP_POST: &str = "click_method 'app_post' is macOS-only: it delivers a mouse event to one process, and Windows has no per-process mouse route at all. Use an element_index (no pointer is moved), or name click_method 'global' to move the real cursor";
/// `sky_click`:macOS 专属(私有 window-server 路径,无 Windows 等价物)。
pub const REFUSE_SKY_CLICK: &str = "click_method 'sky_click' is macOS-only (a private window-server path with no Windows equivalent). Use an element_index, or name click_method 'global'";
/// `auto` + 坐标:auto 永不解析到动指针的方法,而 Windows 唯一的坐标路由
/// 恰恰动指针 —— 两者不相容,拒绝而非悄悄弯曲操作者的光标。
pub const REFUSE_AUTO_POINT: &str = "click_method 'auto' with coordinates cannot be served on Windows: the only coordinate route here moves the operator's real cursor, and 'auto' never resolves onto a pointer-moving method. Pass an element_index instead (no pointer is moved), or name click_method 'global' explicitly to accept the cursor move";
/// 非 `global` 的拖拽:Windows 上唯一拖拽路由是真光标,必须显式点名。
/// `{method}` 填请求的方法名(默认是 macOS 的 `app_post`)。
pub const REFUSE_DRAG_METHOD: &str = "dragging on Windows moves the operator's real cursor, so it must be requested explicitly: pass click_method 'global'. The default '{method}' is the macOS app-scoped route, which has no Windows equivalent";
/// 元素路径的非左键:UIA 没有 pattern 能开上下文菜单(无 `AXShowMenu` 等价
/// 物),唯一路由是真光标 —— 调用方必须点名。`{button}`/`{index}`/`{app}`。
pub const REFUSE_ELEMENT_BUTTON: &str = "a {button}-button click cannot be delivered to element {index} in {app}: UIA exposes no pattern that opens a context menu, so there is no route that leaves the operator's pointer alone. Name click_method 'global' with coordinates to accept the cursor move, or address the command you want directly if the menu it would open is itself in computer_get_state";

/// 像素踏板可用时 `status().reason` 的说明:doctor JSON 仍能读到,CLI 在
/// `supported: true` 时不打印它。
pub const PIXEL_PEDAL_REASON: &str = "bounded UIA observation, focused Unicode/key input, JPEG and explicit global pointer; native acceptance is separate";

/// Windows native backend; input is always revalidated at execution.
///
/// 刻意实现 trait 而非包一层 Unsupported:按名拒绝需要看请求参数,这是
/// Unsupported 的「不看参数、同一文案」刻意做不到的。
pub struct WindowsBackend;

impl WindowsBackend {
	pub fn new() -> Self {
		WindowsBackend
	}

	/// Control patterns outside the current bounded implementation.
	fn refuse_unimplemented(&self) -> DriverResult {
		DriverResult::refuse(NOT_IMPLEMENTED_REASON)
	}

	fn snapshot_result(app: &AppRef, req: SnapshotRequest) -> DriverResult {
		match snapshot::build_snapshot_with(app, req) {
			Ok(snap) => {
				let snap = if req.want_image {
					capture::attach_image(snap, req.image_max_px, req.image_quality)
				} else {
					snap
				};
				DriverResult { ok: true, text: String::new(), apps: Vec::new(), app: None, snapshot: Some(snap) }
			}
			Err(err) => DriverResult::refuse(err.to_string()),
		}
	}

	fn click_inner(&self, app: &AppRef, rec: Option<&ElementRec>, req: ClickRequest) -> DriverResult {
		match req.method {
			ClickMethod::Accessibility => {
				let Some(rec) = rec else {
					return DriverResult::refuse(REFUSAL_ACCESSIBILITY_NEEDS_INDEX);
				};
				if req.button != MouseButton::Left {
					return DriverResult::refuse(fill(
						REFUSE_ELEMENT_BUTTON,
						&[
							("{button}", req.button.as_str()),
							("{index}", rec.index.to_string().as_str()),
							("{app}", app_identity(app)),
						],
					));
				}
				match crate::uia::invoke(app, rec) {
					Ok(()) => ok_for_app("UIA action dispatched; observe to verify", app),
					Err(error) => DriverResult::refuse(error),
				}
			}
			ClickMethod::AppPost => DriverResult::refuse(REFUSE_APP_POST),
			ClickMethod::SkyClick => DriverResult::refuse(REFUSE_SKY_CLICK),
			ClickMethod::Auto => DriverResult::refuse(REFUSE_AUTO_POINT),
			ClickMethod::Global => {
				let Some(point) = req.point else {
					return DriverResult::refuse(fill(ERR_POINT_REQUIRED, &[("{method}", req.method.as_str())]));
				};
				let (x, y) = point;
				if !apps::pid_owns_point(app.pid, x, y) {
					return DriverResult::refuse(fill(
						ERR_POINT_NOT_OWNED,
						&[("{app}", &app.name), ("{x}", &format!("{x:.0}")), ("{y}", &format!("{y:.0}"))],
					));
				}
				let _ = point_computer_overlay::decorate_global_click(ffi::cursor_position(), (x, y));
				match ffi::send_mouse_click(x, y, req.button, req.count) {
					Ok(()) => ok_for_app(click_text(&req, app), app),
					Err(err) => DriverResult::refuse(err),
				}
			}
		}
	}

	fn drag_inner(&self, app: &AppRef, req: DragRequest) -> DriverResult {
		if req.method != ClickMethod::Global {
			return DriverResult::refuse(fill(REFUSE_DRAG_METHOD, &[("{method}", req.method.as_str())]));
		}
		let steps = req.steps.max(ffi::DRAG_STEPS);
		let shaped = steps > DEFAULT_DRAG_STEPS || req.path != DragPath::Straight;
		let points = shaped.then(|| cursor_motion::drag_points(req.start, req.end, steps, req.path));
		let endpoints = [req.start, req.end];
		let chord: &[(f64, f64)] = points.as_deref().unwrap_or(endpoints.as_slice());
		for &(x, y) in chord {
			if !apps::pid_owns_point(app.pid, x, y) {
				return DriverResult::refuse(fill(
					ERR_POINT_NOT_OWNED,
					&[("{app}", &app.name), ("{x}", &format!("{x:.0}")), ("{y}", &format!("{y:.0}"))],
				));
			}
		}
		let _ = point_computer_overlay::decorate_global_drag(chord, 200);
		match ffi::send_mouse_drag(chord, req.button) {
			Ok(()) => ok_for_app(
				format!(
					"dragged with the {} button from ({:.0}, {:.0}) to ({:.0}, {:.0}) in '{}' ({})",
					req.button.as_str(),
					req.start.0,
					req.start.1,
					req.end.0,
					req.end.1,
					app.name,
					req.method.as_str(),
				),
				app,
			),
			Err(err) => DriverResult::refuse(err),
		}
	}
}

impl Default for WindowsBackend {
	fn default() -> Self {
		Self::new()
	}
}

/// REF `app.bundle_id or app.name` —— 拒绝文案里的应用身份。
fn app_identity(app: &AppRef) -> &str {
	if app.bundle_id.is_empty() { app.name.as_str() } else { app.bundle_id.as_str() }
}

impl ComputerUseBackend for WindowsBackend {
	fn platform_id(&self) -> &'static str {
		PLATFORM_WINDOWS
	}

	fn status(&self) -> BackendStatus {
		BackendStatus { supported: true, platform_id: PLATFORM_WINDOWS.into(), reason: PIXEL_PEDAL_REASON.into() }
	}

	/// Windows has no TCC grant. Session/integrity checks occur per operation;
	/// this probe does not certify desktop access.
	fn probe_permissions(&self) -> PermissionProbe {
		PermissionProbe {
			accessibility: PERMISSION_UNSUPPORTED,
			screen_recording: PERMISSION_UNSUPPORTED,
			responsible_hint: String::new(),
		}
	}

	fn list_apps(&self) -> DriverResult {
		guarded("list_apps", || DriverResult::apps(apps::list_apps()))
	}

	fn resolve_app(&self, query: &str) -> DriverResult {
		guarded("resolve_app", || match apps::resolve_app(query) {
			Ok(app) => DriverResult { ok: true, text: String::new(), apps: Vec::new(), app: Some(app), snapshot: None },
			Err(err) => DriverResult::refuse(err.to_string()),
		})
	}

	fn launch_app(&self, query: &str, permit: LaunchPermit<'_>) -> DriverResult {
		guarded("launch_app", || {
			if let Err(error) = crate::execution::check() {
				return DriverResult::refuse(error);
			}
			let adapter = LaunchAdapter {
				resolve: &launch::resolve_target,
				find: &launch::running_app,
				spawn: &launch::spawn_detached,
				identity: Some(&launch::target_identity),
			};
			run_launch_default(&adapter, permit, query)
		})
	}

	fn snapshot(&self, app: &AppRef, req: SnapshotRequest) -> DriverResult {
		guarded("snapshot", || Self::snapshot_result(app, req))
	}

	fn click(&self, app: &AppRef, rec: Option<&ElementRec>, req: ClickRequest) -> DriverResult {
		guarded("click", || self.click_inner(app, rec, req))
	}

	fn drag(&self, app: &AppRef, req: DragRequest) -> DriverResult {
		guarded("drag", || self.drag_inner(app, req))
	}

	fn type_text(&self, app: &AppRef, rec: Option<&ElementRec>, text: &str) -> DriverResult {
		let Some(rec) = rec else {
			return DriverResult::refuse(REFUSE_NO_UIA_FOCUS);
		};
		match ffi::send_unicode_text(text, || crate::uia::validate_focus(app, rec, true)) {
			Ok(()) => ok_for_app("Unicode input dispatched; observe to verify", app),
			Err(error) => DriverResult::refuse(error),
		}
	}

	fn press_key(&self, app: &AppRef, rec: Option<&ElementRec>, key: &str) -> DriverResult {
		let Some(rec) = rec else {
			return DriverResult::refuse(REFUSE_NO_UIA_FOCUS);
		};
		match crate::keys::translate(key).and_then(|(vk, modifiers)| {
			crate::uia::validate_focus(app, rec, false)?;
			ffi::send_key(vk, &modifiers)
		}) {
			Ok(()) => ok_for_app("Key input dispatched; observe to verify", app),
			Err(error) => DriverResult::refuse(error),
		}
	}

	fn set_value(&self, _app: &AppRef, _rec: &ElementRec, _value: &str) -> DriverResult {
		self.refuse_unimplemented()
	}

	fn scroll(&self, _app: &AppRef, _rec: &ElementRec, _direction: ScrollDirection, _pages: f64) -> DriverResult {
		self.refuse_unimplemented()
	}

	fn perform_action(&self, _app: &AppRef, _rec: &ElementRec, _action: &str) -> DriverResult {
		self.refuse_unimplemented()
	}

	fn close(&self) {}
}

/// panic 折成模型可读拒绝(不带内部路径)。
fn guarded(label: &str, run: impl FnOnce() -> DriverResult) -> DriverResult {
	match catch_unwind(AssertUnwindSafe(run)) {
		Ok(result) => result,
		Err(payload) => DriverResult::refuse(format!("{label} failed unexpectedly ({})", panic_message(payload))),
	}
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
	if let Some(text) = payload.downcast_ref::<&str>() {
		(*text).to_string()
	} else if let Some(text) = payload.downcast_ref::<String>() {
		text.clone()
	} else {
		"panic".to_string()
	}
}

fn ok_for_app(text: impl Into<String>, app: &AppRef) -> DriverResult {
	DriverResult { ok: true, text: text.into(), apps: Vec::new(), app: Some(app.clone()), snapshot: None }
}

fn click_text(req: &ClickRequest, app: &AppRef) -> String {
	let (x, y) = req.point.unwrap_or((0.0, 0.0));
	let times = if req.count == 1 { String::new() } else { format!(" x{}", req.count) };
	format!("{} click{times} at ({:.0}, {:.0}) in '{}' ({})", req.button.as_str(), x, y, app.name, req.method.as_str())
}

#[cfg(test)]
mod tests {
	use super::*;
	use point_computer_core::policy;
	use point_computer_core::types::Frame;

	fn app() -> AppRef {
		AppRef {
			name: "Notepad".into(),
			pid: 900,
			bundle_id: "notepad.exe".into(),
			window_id: 7,
			window_title: "notes.txt".into(),
		}
	}

	fn rec(index: u32) -> ElementRec {
		ElementRec {
			index,
			role: "button".into(),
			frame: Some(Frame { x: 1.0, y: 2.0, w: 3.0, h: 4.0 }),
			..ElementRec::default()
		}
	}

	#[test]
	fn status_reports_native_subset() {
		let status = WindowsBackend::new().status();
		assert_eq!(status.platform_id, "windows");
		assert!(status.supported);
		assert_eq!(status.reason, PIXEL_PEDAL_REASON);
		let probe = WindowsBackend::new().probe_permissions();
		assert_eq!(probe.accessibility, PERMISSION_UNSUPPORTED);
		assert_eq!(probe.screen_recording, PERMISSION_UNSUPPORTED);
	}

	#[test]
	fn click_refuses_macos_routes_by_name() {
		let b = WindowsBackend::new();
		let app = app();
		// app_post / sky_click / auto:逐字文案,点名可用替代。
		let out = b.click(
			&app,
			None,
			ClickRequest { method: ClickMethod::AppPost, point: Some((5.0, 5.0)), ..ClickRequest::default() },
		);
		assert!(!out.ok && out.text.contains("macOS-only"), "{}", out.text);
		let out = b.click(&app, None, ClickRequest { method: ClickMethod::SkyClick, ..ClickRequest::default() });
		assert!(out.text.contains("sky_click' is macOS-only"), "{}", out.text);
		let out = b.click(
			&app,
			None,
			ClickRequest { method: ClickMethod::Auto, point: Some((5.0, 5.0)), ..ClickRequest::default() },
		);
		assert!(out.text.contains("'auto' with coordinates cannot be served"), "{}", out.text);
		// 均不带 Error: 前缀(dispatch 层加)。
		assert!(!out.text.starts_with("Error: "));
	}

	#[test]
	fn click_accessibility_shape_refusals_come_before_implementation_status() {
		let b = WindowsBackend::new();
		let app = app();
		// 无 index:REFUSAL_ACCESSIBILITY_NEEDS_INDEX(纯形状,先行)。
		let out = b.click(&app, None, ClickRequest { method: ClickMethod::Accessibility, ..ClickRequest::default() });
		assert_eq!(out.text, REFUSAL_ACCESSIBILITY_NEEDS_INDEX);
		// 非左键:按名拒绝,点名元素/应用/替代。
		let out = b.click(
			&app,
			Some(&rec(4)),
			ClickRequest { method: ClickMethod::Accessibility, button: MouseButton::Right, ..ClickRequest::default() },
		);
		assert!(!out.ok);
		assert!(
			out.text.contains("right-button click cannot be delivered to element 4 in notepad.exe"),
			"{}",
			out.text
		);
		// Fabricated HWND/runtime identity is refused on every platform.
		let out = b.click(
			&app,
			Some(&rec(4)),
			ClickRequest { method: ClickMethod::Accessibility, ..ClickRequest::default() },
		);
		assert!(!out.ok, "fabricated target must be refused");
	}

	#[test]
	fn click_global_requires_a_point_then_pid_owns_point() {
		let b = WindowsBackend::new();
		let out = b.click(&app(), None, ClickRequest { method: ClickMethod::Global, ..ClickRequest::default() });
		assert!(out.text.contains("'global' clicks a screen point"), "{}", out.text);
		let out = b.click(
			&app(),
			None,
			ClickRequest { method: ClickMethod::Global, point: Some((1.0, 1.0)), ..ClickRequest::default() },
		);
		assert!(!out.ok);
		assert!(out.text.contains("that point is not inside the 'Notepad' window"), "{}", out.text);
		assert!(!out.text.starts_with("Error: "));
	}

	#[test]
	fn drag_refuses_anything_but_global_then_pid_owns_point() {
		let b = WindowsBackend::new();
		let req = DragRequest { method: ClickMethod::AppPost, ..DragRequest::default() };
		let out = b.drag(&app(), req);
		assert!(!out.ok);
		assert!(out.text.contains("pass click_method 'global'"), "{}", out.text);
		assert!(out.text.contains("'app_post' is the macOS app-scoped route"), "{}", out.text);
		let req = DragRequest { method: ClickMethod::Global, ..DragRequest::default() };
		let out = b.drag(&app(), req);
		assert!(!out.ok);
		assert!(out.text.contains("that point is not inside the 'Notepad' window"), "{}", out.text);
	}

	#[test]
	fn enumeration_and_fabricated_observation_are_platform_bounded() {
		let b = WindowsBackend::new();
		let listed = b.list_apps();
		assert!(listed.ok, "{}", listed.text);
		assert!(listed.apps.is_empty() || cfg!(windows), "darwin CI has no HWND list");
		if !cfg!(windows) {
			let resolved = b.resolve_app("notepad");
			assert!(!resolved.ok);
			assert!(
				resolved.text.contains("no application with an on-screen window matches 'notepad'"),
				"{}",
				resolved.text
			);
			let launched = b.launch_app("notepad", LaunchPermit::none());
			assert!(!launched.ok);
			assert!(launched.text.contains("no installed application matches 'notepad'"), "{}", launched.text);
		}
		let snap = b.snapshot(&app(), SnapshotRequest::default());
		if cfg!(windows) {
			assert!(!snap.ok, "fabricated HWND must be refused");
			return;
		}
		assert!(snap.ok, "{}", snap.text);
		let tree = snap.snapshot.expect("empty tree is a complete snapshot");
		assert!(tree.elements.is_empty());
		assert!(!tree.truncated);
		b.close();
	}

	#[test]
	fn keyboard_and_element_verbs_still_need_uia() {
		let b = WindowsBackend::new();
		let app = app();
		let rec = rec(1);
		assert_eq!(b.type_text(&app, None, "hi").text, REFUSE_NO_UIA_FOCUS);
		assert_eq!(b.press_key(&app, None, "enter").text, REFUSE_NO_UIA_FOCUS);
		assert_eq!(b.set_value(&app, &rec, "v").text, NOT_IMPLEMENTED_REASON);
		assert_eq!(b.scroll(&app, &rec, ScrollDirection::Down, 1.0).text, NOT_IMPLEMENTED_REASON);
		assert_eq!(b.perform_action(&app, &rec, "invoke").text, NOT_IMPLEMENTED_REASON);
	}

	#[test]
	fn unused_policy_import_is_shape_only() {
		// 保留 policy 引用的存在性检查:XOR 规则确实约束请求形状。
		assert!(policy::check_click_target(Some(1), Some((0.0, 0.0))).is_some());
	}
}
