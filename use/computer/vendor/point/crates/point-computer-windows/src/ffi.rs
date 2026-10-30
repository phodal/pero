//! 唯一触碰 Win32 原生符号的模块。本包其它代码经由这里的类型化助手到达
//! 系统;`extern "C"` 只允许出现在本文件(README 审计线)。
//!
//! **darwin CI 必须纯编译。** `sys` 与真实调用全部 `#[cfg(windows)]`;非
//! Windows 目标导出同一组助手,返回空列表 / 空 JPEG / 明确错误,这样
//! `apps`/`driver` 的纯核心(z 序命中、按名拒绝)可离线单测。
//!
//! M4 像素踏板绑定的表面:
//! * 顶层窗口枚举(z 序,前到后)—— `list_apps` 与 `pid_owns_point` 的唯一真相源;
//! * `SendInput` 真指针(仅 `click_method 'global'` 可达);
//! * `PrintWindow`/`BitBlt` 像素 + GDI+ JPEG。
//!
//! UIAutomationCore 不在本刀。

#![allow(non_camel_case_types)]

use std::ffi::c_void;

/// 在屏顶层窗口。`window_id` 是 HWND 的低 32 位(user32 句柄高位为 0)。
#[derive(Clone, Debug)]
pub struct WindowInfo {
	pub window_id: u32,
	pub pid: i32,
	pub owner_name: String,
	pub title: String,
	/// 0 = 普通重叠窗口;非 0 = topmost/tool(owns_point **不**跳过)。
	pub layer: i64,
	/// 左上原点屏幕矩形 `(x, y, w, h)`;不可用时 `None`(最小化、零面积)。
	pub bounds: Option<(f64, f64, f64, f64)>,
}

/// 普通应用窗口层。与 macOS `CG_WINDOW_LAYER_NORMAL` 同义,便于 `owns_point` 对照。
pub const WINDOW_LAYER_NORMAL: i64 = 0;
pub const WINDOW_LAYER_TOPMOST: i64 = 1;

/// 拖拽最少中间事件数:少于此时 SendInput 常被当成点击而非拖。
pub const DRAG_STEPS: u16 = 8;

#[cfg(windows)]
pub(crate) mod sys {
	#![allow(dead_code, non_snake_case)]

	use std::ffi::c_void;
	use std::os::raw::{c_int, c_uint};

	pub type BOOL = c_int;
	pub type HWND = *mut c_void;
	pub type HANDLE = *mut c_void;
	pub type HDC = *mut c_void;
	pub type HGDIOBJ = *mut c_void;
	pub type HBITMAP = *mut c_void;
	pub type DWORD = u32;
	pub type UINT = c_uint;
	pub type LONG = i32;
	pub type LPARAM = isize;
	pub type WNDENUMPROC = unsafe extern "C" fn(HWND, LPARAM) -> BOOL;

	pub const INPUT_MOUSE: u32 = 0;
	pub const INPUT_KEYBOARD: u32 = 1;
	pub const MOUSEEVENTF_MOVE: u32 = 0x0001;
	pub const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
	pub const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
	pub const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
	pub const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;
	pub const MOUSEEVENTF_MIDDLEDOWN: u32 = 0x0020;
	pub const MOUSEEVENTF_MIDDLEUP: u32 = 0x0040;
	pub const MOUSEEVENTF_WHEEL: u32 = 0x0800;
	pub const MOUSEEVENTF_HWHEEL: u32 = 0x1000;
	pub const MOUSEEVENTF_ABSOLUTE: u32 = 0x8000;
	pub const MOUSEEVENTF_VIRTUALDESK: u32 = 0x4000;
	pub const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
	pub const KEYEVENTF_KEYUP: u32 = 0x0002;
	pub const KEYEVENTF_UNICODE: u32 = 0x0004;
	pub const SM_XVIRTUALSCREEN: c_int = 76;
	pub const SM_YVIRTUALSCREEN: c_int = 77;
	pub const SM_CXVIRTUALSCREEN: c_int = 78;
	pub const SM_CYVIRTUALSCREEN: c_int = 79;
	pub const GWL_EXSTYLE: c_int = -20;
	pub const WS_EX_TOPMOST: u32 = 0x0000_0008;
	pub const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
	pub const PROCESS_QUERY_LIMITED_INFORMATION: DWORD = 0x1000;
	pub const SRCCOPY: DWORD = 0x00CC_0020;
	pub const DIB_RGB_COLORS: UINT = 0;
	pub const BI_RGB: DWORD = 0;
	pub const PW_RENDERFULLCONTENT: UINT = 0x0000_0002;

	#[repr(C)]
	#[derive(Clone, Copy)]
	pub struct RECT {
		pub left: LONG,
		pub top: LONG,
		pub right: LONG,
		pub bottom: LONG,
	}

	#[repr(C)]
	#[derive(Clone, Copy)]
	pub struct POINT {
		pub x: LONG,
		pub y: LONG,
	}

	#[repr(C)]
	#[derive(Clone, Copy)]
	pub struct MOUSEINPUT {
		pub dx: i32,
		pub dy: i32,
		pub mouseData: u32,
		pub dwFlags: u32,
		pub time: u32,
		pub dwExtraInfo: usize,
	}

	#[repr(C)]
	#[derive(Clone, Copy)]
	pub struct KEYBDINPUT {
		pub wVk: u16,
		pub wScan: u16,
		pub dwFlags: u32,
		pub time: u32,
		pub dwExtraInfo: usize,
	}

	#[repr(C)]
	pub union INPUT_UNION {
		pub mi: MOUSEINPUT,
		pub ki: KEYBDINPUT,
	}

	#[repr(C)]
	pub struct INPUT {
		pub type_: u32,
		pub u: INPUT_UNION,
	}

	#[repr(C)]
	pub struct BITMAPINFOHEADER {
		pub biSize: DWORD,
		pub biWidth: LONG,
		pub biHeight: LONG,
		pub biPlanes: u16,
		pub biBitCount: u16,
		pub biCompression: DWORD,
		pub biSizeImage: DWORD,
		pub biXPelsPerMeter: LONG,
		pub biYPelsPerMeter: LONG,
		pub biClrUsed: DWORD,
		pub biClrImportant: DWORD,
	}

	#[repr(C)]
	pub struct BITMAPINFO {
		pub bmiHeader: BITMAPINFOHEADER,
		pub bmiColors: [u32; 1],
	}

	#[link(name = "user32")]
	unsafe extern "C" {
		pub fn EnumWindows(lpEnumFunc: WNDENUMPROC, lParam: LPARAM) -> BOOL;
		pub fn IsWindowVisible(hWnd: HWND) -> BOOL;
		pub fn IsIconic(hWnd: HWND) -> BOOL;
		pub fn GetWindowThreadProcessId(hWnd: HWND, lpdwProcessId: *mut DWORD) -> DWORD;
		pub fn GetWindowTextW(hWnd: HWND, lpString: *mut u16, nMaxCount: c_int) -> c_int;
		pub fn GetWindowTextLengthW(hWnd: HWND) -> c_int;
		pub fn GetWindowRect(hWnd: HWND, lpRect: *mut RECT) -> BOOL;
		pub fn GetWindowLongW(hWnd: HWND, nIndex: c_int) -> i32;
		pub fn GetForegroundWindow() -> HWND;
		pub fn GetAsyncKeyState(vKey: c_int) -> i16;
		pub fn GetCursorPos(lpPoint: *mut POINT) -> BOOL;
		pub fn GetSystemMetrics(nIndex: c_int) -> c_int;
		pub fn SendInput(cInputs: UINT, pInputs: *const INPUT, cbSize: c_int) -> UINT;
		pub fn GetDC(hWnd: HWND) -> HDC;
		pub fn ReleaseDC(hWnd: HWND, hDC: HDC) -> c_int;
		pub fn PrintWindow(hWnd: HWND, hdcBlt: HDC, nFlags: UINT) -> BOOL;
		pub fn SetProcessDPIAware() -> BOOL;
	}

	#[link(name = "kernel32")]
	unsafe extern "C" {
		pub fn OpenProcess(dwDesiredAccess: DWORD, bInheritHandle: BOOL, dwProcessId: DWORD) -> HANDLE;
		pub fn CloseHandle(hObject: HANDLE) -> BOOL;
		pub fn QueryFullProcessImageNameW(
			hProcess: HANDLE,
			dwFlags: DWORD,
			lpExeName: *mut u16,
			lpdwSize: *mut DWORD,
		) -> BOOL;
	}

	#[link(name = "gdi32")]
	unsafe extern "C" {
		pub fn CreateCompatibleDC(hdc: HDC) -> HDC;
		pub fn CreateCompatibleBitmap(hdc: HDC, cx: c_int, cy: c_int) -> HBITMAP;
		pub fn SelectObject(hdc: HDC, h: HGDIOBJ) -> HGDIOBJ;
		pub fn BitBlt(
			hdc: HDC,
			x: c_int,
			y: c_int,
			cx: c_int,
			cy: c_int,
			hdcSrc: HDC,
			x1: c_int,
			y1: c_int,
			rop: DWORD,
		) -> BOOL;
		pub fn DeleteDC(hdc: HDC) -> BOOL;
		pub fn DeleteObject(ho: HGDIOBJ) -> BOOL;
		pub fn GetDIBits(
			hdc: HDC,
			hbm: HBITMAP,
			start: UINT,
			cLines: UINT,
			lpvBits: *mut c_void,
			lpbmi: *mut BITMAPINFO,
			usage: UINT,
		) -> c_int;
	}
}

#[cfg(windows)]
#[path = "ffi_win.rs"]
mod win;

#[cfg(windows)]
pub use win::{
	capture_window_jpeg, cursor_position, foreground_pid, pid_image_name, release_tracked, send_key, send_mouse_click,
	send_mouse_drag, send_mouse_wheel, send_unicode_text, set_dpi_aware, window_list,
};

#[cfg(not(windows))]
pub fn window_list() -> Vec<WindowInfo> {
	Vec::new()
}

#[cfg(not(windows))]
pub fn pid_image_name(_pid: i32) -> String {
	String::new()
}

#[cfg(not(windows))]
pub fn foreground_pid() -> i32 {
	0
}

#[cfg(not(windows))]
pub fn cursor_position() -> Option<(f64, f64)> {
	None
}

#[cfg(not(windows))]
pub fn set_dpi_aware() {}

#[cfg(not(windows))]
pub fn send_mouse_click(
	_x: f64,
	_y: f64,
	_button: point_computer_core::types::MouseButton,
	_count: u8,
) -> Result<(), String> {
	Err("SendInput is only available on Windows".into())
}

#[cfg(not(windows))]
pub fn send_mouse_drag(_points: &[(f64, f64)], _button: point_computer_core::types::MouseButton) -> Result<(), String> {
	Err("SendInput is only available on Windows".into())
}

#[cfg(not(windows))]
pub fn send_mouse_wheel(_x: f64, _y: f64, _delta_x: i32, _delta_y: i32) -> Result<(), String> {
	Err("SendInput is only available on Windows".into())
}

#[cfg(not(windows))]
pub fn send_unicode_text(_text: &str, _validate: impl Fn() -> Result<(), String>) -> Result<(), String> {
	Err("SendInput is only available on Windows".into())
}

#[cfg(not(windows))]
pub fn send_key(_vk: u16, _modifiers: &[u16]) -> Result<(), String> {
	Err("SendInput is only available on Windows".into())
}

#[cfg(not(windows))]
pub fn capture_window_jpeg(_window_id: u32, _pid: i32, _max_px: u32, _quality: f64) -> crate::capture::WindowImage {
	crate::capture::WindowImage::empty("unavailable", "wgc_api_unavailable", "")
}

#[cfg(not(windows))]
pub fn release_tracked() -> Result<(), String> {
	let _ = crate::stop::take_held();
	Ok(())
}

/// 手工扫 JPEG SOF,报编码后宽高。非 JPEG / 空 → `(0, 0)`。
pub fn jpeg_dimensions(raw: &[u8]) -> (u32, u32) {
	const MARKER: u8 = 0xFF;
	const SOI: u8 = 0xD8;
	const EOI: u8 = 0xD9;
	const SOF_OFFSET: usize = 5;
	const RST_FIRST: u8 = 0xD0;
	const RST_LAST: u8 = 0xD7;
	const SOF: &[u8] = &[0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];
	if raw.len() < 4 || raw[0] != MARKER || raw[1] != SOI {
		return (0, 0);
	}
	let mut pos = 2;
	while pos + 3 < raw.len() {
		if raw[pos] != MARKER {
			pos += 1;
			continue;
		}
		let marker = raw[pos + 1];
		if marker == MARKER || marker == SOI || marker == EOI || (RST_FIRST..=RST_LAST).contains(&marker) {
			pos += 2;
			continue;
		}
		if SOF.contains(&marker) {
			let start = pos + SOF_OFFSET;
			if start + 4 > raw.len() {
				return (0, 0);
			}
			let height = u16::from_be_bytes([raw[start], raw[start + 1]]);
			let width = u16::from_be_bytes([raw[start + 2], raw[start + 3]]);
			return (u32::from(width), u32::from(height));
		}
		let segment = u16::from_be_bytes([raw[pos + 2], raw[pos + 3]]);
		if segment < 2 {
			return (0, 0);
		}
		pos += 2 + usize::from(segment);
	}
	(0, 0)
}

#[allow(dead_code)]
fn _hwnd_as_void_marker(ptr: *mut c_void) -> usize {
	ptr as usize
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn jpeg_dimensions_reads_sof() {
		let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08];
		jpeg.push(0x08);
		jpeg.extend_from_slice(&1000u16.to_be_bytes());
		jpeg.extend_from_slice(&2000u16.to_be_bytes());
		jpeg.push(0x01);
		assert_eq!(jpeg_dimensions(&jpeg), (2000, 1000), "width first, big-endian");
		assert_eq!(jpeg_dimensions(&[]), (0, 0));
		assert_eq!(jpeg_dimensions(b"not a jpeg at all"), (0, 0));
		assert_eq!(jpeg_dimensions(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01]), (0, 0));
	}

	#[test]
	fn off_windows_helpers_are_empty_or_refusing() {
		if cfg!(windows) {
			return;
		}
		assert!(window_list().is_empty());
		assert!(pid_image_name(1).is_empty());
		assert_eq!(foreground_pid(), 0);
		assert!(send_mouse_click(0.0, 0.0, point_computer_core::types::MouseButton::Left, 1).is_err());
		let image = capture_window_jpeg(1, 1, 1280, 0.55);
		assert!(image.bytes.is_empty());
		assert_eq!(image.backend, "unavailable");
		assert_eq!(image.error, "wgc_api_unavailable");
		assert!(release_tracked().is_ok());
	}
}
