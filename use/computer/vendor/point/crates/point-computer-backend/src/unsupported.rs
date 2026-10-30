//! 无 driver 平台的共享拒绝体。REF `backend.py` `UnsupportedBackend` 的移植。

use point_computer_core::types::{
	AppRef, BackendStatus, ClickRequest, DragRequest, DriverResult, ElementRec, PERMISSION_UNSUPPORTED,
	PermissionProbe, REFUSAL_UNSUPPORTED, ScrollDirection, Snapshot, SnapshotRequest, fill,
};

use crate::backend::{ComputerUseBackend, LaunchPermit};

// 非 macOS backend 上报的理由。具体而非「不支持」:Windows 用户该知道缺的
// 是什么,维护者该在这里找到下一步实现的名字。
//
// 这一条留给 Windows host 完全够不着 UI Automation 的情形。driver 在 client
// 建不起来时上报**自己的**理由(windows 骨架的 UNAVAILABLE_REASON),所以
// 这里是 driver 导入失败时的回退 —— 部分安装,而非未实现。
pub const WINDOWS_REASON: &str = "the Windows UI Automation driver could not be loaded on this host";
pub const LINUX_REASON: &str = "the Linux AT-SPI driver is not implemented yet; computer use is macOS-only in this release (Wayland has no unprivileged window capture)";
pub const UNKNOWN_PLATFORM_REASON: &str = "this operating system has no computer-use driver";
/// 原生 driver 加载失败的降级理由模板({detail} 填导入/构建失败的详情)。
pub const DRIVER_IMPORT_REASON: &str = "the native computer-use driver could not be loaded ({detail})";

/// 无 driver 平台的共享基座:每个方法以同一段文字拒绝。
///
/// 刻意**具体**:一个子类只补 platform_id 与理由,所以一个新的不支持平台
/// 约十行,**不可能**意外实现半个 driver。这里没有东西会 panic:模型得到
/// 点名平台的一致拒绝而非坏掉的能力 —— 与 REF 对 Windows PTY 的姿态相同。
///
/// REF 用子类(LinuxBackend 等)供应两个参数;Rust 侧同一结构体 + 构造器
/// 即可,平台 crate 各自带一个 `pub fn backend() -> UnsupportedBackend`。
pub struct UnsupportedBackend {
	platform_id: &'static str,
	reason: String,
}

impl UnsupportedBackend {
	pub fn new(platform_id: &'static str, reason: impl Into<String>) -> Self {
		UnsupportedBackend { platform_id, reason: reason.into() }
	}

	/// 上报给 doctor/拒绝文案的理由(诊断展示用)。
	pub fn reason(&self) -> &str {
		&self.reason
	}

	/// 每个方法返回的同一段拒绝。
	fn refuse(&self) -> DriverResult {
		DriverResult::refuse(fill(REFUSAL_UNSUPPORTED, &[("{platform}", self.platform_id), ("{reason}", &self.reason)]))
	}
}

impl ComputerUseBackend for UnsupportedBackend {
	fn platform_id(&self) -> &'static str {
		self.platform_id
	}

	fn status(&self) -> BackendStatus {
		BackendStatus { supported: false, platform_id: self.platform_id.to_string(), reason: self.reason.clone() }
	}

	fn probe_permissions(&self) -> PermissionProbe {
		PermissionProbe {
			accessibility: PERMISSION_UNSUPPORTED,
			screen_recording: PERMISSION_UNSUPPORTED,
			responsible_hint: String::new(),
		}
	}

	fn list_apps(&self) -> DriverResult {
		self.refuse()
	}

	fn resolve_app(&self, _query: &str) -> DriverResult {
		self.refuse()
	}

	fn launch_app(&self, _query: &str, _permit: LaunchPermit<'_>) -> DriverResult {
		self.refuse()
	}

	fn snapshot(&self, _app: &AppRef, _req: SnapshotRequest) -> DriverResult {
		self.refuse()
	}

	fn click(&self, _app: &AppRef, _rec: Option<&ElementRec>, _req: ClickRequest) -> DriverResult {
		self.refuse()
	}

	fn drag(&self, _app: &AppRef, _req: DragRequest) -> DriverResult {
		self.refuse()
	}

	fn type_text(&self, _app: &AppRef, _rec: Option<&ElementRec>, _text: &str) -> DriverResult {
		self.refuse()
	}

	fn press_key(&self, _app: &AppRef, _rec: Option<&ElementRec>, _key: &str) -> DriverResult {
		self.refuse()
	}

	fn set_value(&self, _app: &AppRef, _rec: &ElementRec, _value: &str) -> DriverResult {
		self.refuse()
	}

	fn scroll(&self, _app: &AppRef, _rec: &ElementRec, _direction: ScrollDirection, _pages: f64) -> DriverResult {
		self.refuse()
	}

	fn perform_action(&self, _app: &AppRef, _rec: &ElementRec, _action: &str) -> DriverResult {
		self.refuse()
	}

	fn close(&self) {
		// 无资源可释放。
	}
}

/// *app* 的空快照 —— 不支持平台上报的形状。
///
/// 与拒绝文案同住,让需要 `Snapshot`(而非 `DriverResult`)的调用方不必手
/// 拼一个而漏置 `has_secure` 之类。
pub fn unsupported_snapshot(app: &AppRef) -> Snapshot {
	Snapshot { app: app.clone(), captured_at: 0.0, ..Snapshot::default() }
}

#[cfg(test)]
mod tests {
	use super::*;
	use point_computer_core::types::{ClickMethod, DragPath, ElementRec, PLATFORM_LINUX, TOOL_LIST_APPS};

	#[test]
	fn every_method_refuses_identically_naming_the_platform() {
		let backend = UnsupportedBackend::new(PLATFORM_LINUX, LINUX_REASON);
		let expected = fill(REFUSAL_UNSUPPORTED, &[("{platform}", PLATFORM_LINUX), ("{reason}", LINUX_REASON)]);
		let app = AppRef { name: "x".into(), pid: 1, ..AppRef::default() };
		let rec = ElementRec::default();
		let click = ClickRequest::default();
		let drag = DragRequest::default();
		for (tool, result) in [
			("list_apps", backend.list_apps()),
			("resolve_app", backend.resolve_app("x")),
			("launch_app", backend.launch_app("x", LaunchPermit::none())),
			("snapshot", backend.snapshot(&app, SnapshotRequest::default())),
			("click", backend.click(&app, None, click)),
			("drag", backend.drag(&app, drag)),
			("type_text", backend.type_text(&app, None, "hi")),
			("press_key", backend.press_key(&app, None, "a")),
			("set_value", backend.set_value(&app, &rec, "v")),
			("scroll", backend.scroll(&app, &rec, ScrollDirection::Up, 1.0)),
			("perform_action", backend.perform_action(&app, &rec, "AXPress")),
		] {
			assert!(!result.ok, "{tool} must refuse");
			assert_eq!(result.text, expected, "{tool}");
			// 契约:拒绝文本不带 Error: 前缀(dispatch 层恰好加一次)。
			assert!(!result.text.starts_with("Error: "), "{tool}");
		}
		// 拒绝与工具名无关:本 trait 不看参数,文案同一。
		assert_eq!(backend.resolve_app(TOOL_LIST_APPS).text, expected);
		backend.close(); // 幂等、无 panic。
		backend.close();
	}

	#[test]
	fn status_and_probe_report_unsupported() {
		let backend = UnsupportedBackend::new("windows", WINDOWS_REASON);
		let status = backend.status();
		assert!(!status.supported);
		assert_eq!(status.platform_id, "windows");
		assert_eq!(status.reason, WINDOWS_REASON);
		assert_eq!(backend.reason(), WINDOWS_REASON);
		let probe = backend.probe_permissions();
		assert_eq!(probe.accessibility, PERMISSION_UNSUPPORTED);
		assert_eq!(probe.screen_recording, PERMISSION_UNSUPPORTED);
		assert_eq!(probe.responsible_hint, "");
	}

	#[test]
	fn drag_request_default_is_app_scoped_straight() {
		// 顺带钉住 core 契约:默认拖拽不动指针、直行、单段。
		let req = DragRequest { path: DragPath::Straight, ..DragRequest::default() };
		assert!(!req.moves_pointer());
		assert_eq!(req.method, ClickMethod::AppPost);
	}

	#[test]
	fn unsupported_snapshot_is_empty_but_complete_shape() {
		let app = AppRef { name: "Notes".into(), pid: 9, ..AppRef::default() };
		let snap = unsupported_snapshot(&app);
		assert_eq!(snap.app, app);
		assert!(snap.elements.is_empty());
		assert!(!snap.has_secure);
		assert!(!snap.truncated);
		assert_eq!(snap.captured_at, 0.0);
	}
}
