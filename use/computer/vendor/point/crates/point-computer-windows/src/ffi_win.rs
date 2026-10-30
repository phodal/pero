//! Windows 目标上的 Win32 助手。`extern "C"` 只在 [`super::sys`];本文件只调它们。

use std::ffi::OsString;
use std::mem::size_of;
use std::os::windows::ffi::OsStringExt;
use std::ptr;
use std::sync::OnceLock;

use point_computer_core::types::MouseButton;

use super::sys::{
	self, BITMAPINFO, BITMAPINFOHEADER, BOOL, DWORD, HANDLE, HBITMAP, HWND, INPUT, INPUT_UNION, KEYBDINPUT, LONG,
	LPARAM, MOUSEINPUT, POINT, RECT, UINT,
};
use super::{WINDOW_LAYER_NORMAL, WINDOW_LAYER_TOPMOST, WindowInfo};

const WHEEL_DELTA: i32 = 120;

pub fn set_dpi_aware() {
	static ONCE: OnceLock<()> = OnceLock::new();
	ONCE.get_or_init(|| {
		unsafe { sys::SetProcessDPIAware() };
	});
}

/// 操作者真指针位置。读失败 → None,overlay 只画落点,不猜光标。
pub fn cursor_position() -> Option<(f64, f64)> {
	set_dpi_aware();
	let mut point = POINT { x: 0, y: 0 };
	if unsafe { sys::GetCursorPos(&mut point) } == 0 {
		return None;
	}
	Some((point.x as f64, point.y as f64))
}

pub fn window_list() -> Vec<WindowInfo> {
	set_dpi_aware();
	let mut out: Vec<WindowInfo> = Vec::new();
	unsafe { sys::EnumWindows(enum_windows_cb, &mut out as *mut Vec<WindowInfo> as LPARAM) };
	out
}

unsafe extern "C" fn enum_windows_cb(hwnd: HWND, lparam: LPARAM) -> BOOL {
	let out = unsafe { &mut *(lparam as *mut Vec<WindowInfo>) };
	if let Some(info) = read_window(hwnd) {
		out.push(info);
	}
	1
}

fn read_window(hwnd: HWND) -> Option<WindowInfo> {
	unsafe {
		if sys::IsWindowVisible(hwnd) == 0 || sys::IsIconic(hwnd) != 0 {
			return None;
		}
		let mut pid: DWORD = 0;
		sys::GetWindowThreadProcessId(hwnd, &mut pid);
		if pid == 0 {
			return None;
		}
		let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
		if sys::GetWindowRect(hwnd, &mut rect) == 0 {
			return None;
		}
		let width = (rect.right - rect.left) as f64;
		let height = (rect.bottom - rect.top) as f64;
		let bounds = (width > 0.0 && height > 0.0).then_some((rect.left as f64, rect.top as f64, width, height));
		let ex = sys::GetWindowLongW(hwnd, sys::GWL_EXSTYLE) as u32;
		let layer = if ex & (sys::WS_EX_TOPMOST | sys::WS_EX_TOOLWINDOW) != 0 {
			WINDOW_LAYER_TOPMOST
		} else {
			WINDOW_LAYER_NORMAL
		};
		Some(WindowInfo {
			window_id: hwnd as usize as u32,
			pid: pid as i32,
			owner_name: pid_image_name(pid as i32),
			title: window_text(hwnd),
			layer,
			bounds,
		})
	}
}

fn window_text(hwnd: HWND) -> String {
	unsafe {
		let len = sys::GetWindowTextLengthW(hwnd);
		if len <= 0 {
			return String::new();
		}
		let mut buf = vec![0u16; len as usize + 1];
		let n = sys::GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
		if n <= 0 {
			return String::new();
		}
		wide_to_string(&buf[..n as usize])
	}
}

pub fn pid_image_name(pid: i32) -> String {
	if pid <= 0 {
		return String::new();
	}
	unsafe {
		let handle: HANDLE = sys::OpenProcess(sys::PROCESS_QUERY_LIMITED_INFORMATION, 0, pid as DWORD);
		if handle.is_null() {
			return String::new();
		}
		let mut buf = [0u16; 260];
		let mut size = buf.len() as DWORD;
		let ok = sys::QueryFullProcessImageNameW(handle, 0, buf.as_mut_ptr(), &mut size);
		sys::CloseHandle(handle);
		if ok == 0 || size == 0 {
			return String::new();
		}
		let path = wide_to_string(&buf[..size as usize]);
		std::path::Path::new(&path).file_name().and_then(|name| name.to_str()).unwrap_or("").to_string()
	}
}

pub fn foreground_pid() -> i32 {
	unsafe {
		let hwnd = sys::GetForegroundWindow();
		if hwnd.is_null() {
			return 0;
		}
		let mut pid: DWORD = 0;
		sys::GetWindowThreadProcessId(hwnd, &mut pid);
		pid as i32
	}
}

fn wide_to_string(units: &[u16]) -> String {
	OsString::from_wide(units).to_string_lossy().into_owned()
}

fn virtual_screen() -> (i32, i32, i32, i32) {
	unsafe {
		(
			sys::GetSystemMetrics(sys::SM_XVIRTUALSCREEN),
			sys::GetSystemMetrics(sys::SM_YVIRTUALSCREEN),
			sys::GetSystemMetrics(sys::SM_CXVIRTUALSCREEN).max(1),
			sys::GetSystemMetrics(sys::SM_CYVIRTUALSCREEN).max(1),
		)
	}
}

fn abs_mouse(x: f64, y: f64) -> (i32, i32) {
	let (vx, vy, vw, vh) = virtual_screen();
	let nx = ((x - f64::from(vx)) * 65535.0 / f64::from(vw)).round() as i32;
	let ny = ((y - f64::from(vy)) * 65535.0 / f64::from(vh)).round() as i32;
	(nx.clamp(0, 65535), ny.clamp(0, 65535))
}

fn mouse_input(dx: i32, dy: i32, data: u32, flags: u32) -> INPUT {
	INPUT {
		type_: sys::INPUT_MOUSE,
		u: INPUT_UNION { mi: MOUSEINPUT { dx, dy, mouseData: data, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
	}
}

/// Track the inserted prefix, including matching ups. Cleanup never sends an
/// up for a key/button this worker has already released.
fn outstanding_releases(inputs: &[INPUT]) -> Vec<INPUT> {
	let mut releases: Vec<INPUT> = Vec::new();
	for input in inputs {
		unsafe {
			if input.type_ == sys::INPUT_KEYBOARD {
				let key = input.u.ki;
				if key.dwFlags & sys::KEYEVENTF_KEYUP == 0 {
					releases.push(INPUT {
						type_: sys::INPUT_KEYBOARD,
						u: INPUT_UNION { ki: KEYBDINPUT { dwFlags: key.dwFlags | sys::KEYEVENTF_KEYUP, ..key } },
					});
				} else {
					releases.retain(|prior| {
						!(prior.type_ == sys::INPUT_KEYBOARD
							&& prior.u.ki.wVk == key.wVk
							&& prior.u.ki.wScan == key.wScan
							&& prior.u.ki.dwFlags & sys::KEYEVENTF_UNICODE == key.dwFlags & sys::KEYEVENTF_UNICODE)
					});
				}
			} else if input.type_ == sys::INPUT_MOUSE {
				let mouse = input.u.mi;
				for (down, up) in [
					(sys::MOUSEEVENTF_LEFTDOWN, sys::MOUSEEVENTF_LEFTUP),
					(sys::MOUSEEVENTF_RIGHTDOWN, sys::MOUSEEVENTF_RIGHTUP),
					(sys::MOUSEEVENTF_MIDDLEDOWN, sys::MOUSEEVENTF_MIDDLEUP),
				] {
					if mouse.dwFlags & down != 0 {
						releases.push(mouse_input(0, 0, 0, up));
					}
					if mouse.dwFlags & up != 0 {
						releases.retain(|prior| !(prior.type_ == sys::INPUT_MOUSE && prior.u.mi.dwFlags & up != 0));
					}
				}
			}
		}
	}
	releases.reverse();
	releases
}

struct Injecting;
impl Injecting {
	fn begin() -> Self {
		crate::stop::begin_inject();
		Self
	}
}
impl Drop for Injecting {
	fn drop(&mut self) {
		crate::stop::end_inject();
	}
}

fn note_batch(inputs: &[INPUT]) {
	for input in inputs {
		unsafe {
			if input.type_ == sys::INPUT_KEYBOARD {
				let key = input.u.ki;
				if key.dwFlags & sys::KEYEVENTF_UNICODE != 0 {
					continue;
				}
				if key.dwFlags & sys::KEYEVENTF_KEYUP == 0 {
					crate::stop::note_key_down(key.wVk);
				} else {
					crate::stop::note_key_up(key.wVk);
				}
			} else if input.type_ == sys::INPUT_MOUSE {
				let mouse = input.u.mi;
				for (down, up, button) in [
					(sys::MOUSEEVENTF_LEFTDOWN, sys::MOUSEEVENTF_LEFTUP, 0u8),
					(sys::MOUSEEVENTF_RIGHTDOWN, sys::MOUSEEVENTF_RIGHTUP, 1),
					(sys::MOUSEEVENTF_MIDDLEDOWN, sys::MOUSEEVENTF_MIDDLEUP, 2),
				] {
					if mouse.dwFlags & down != 0 {
						crate::stop::note_button_down(button);
					}
					if mouse.dwFlags & up != 0 {
						crate::stop::note_button_up(button);
					}
				}
			}
		}
	}
}

fn send_inputs(inputs: &[INPUT]) -> Result<(), String> {
	crate::execution::check()?;
	// Do not clear or inherit an operator's held modifiers/buttons.
	for key in [0x10, 0x11, 0x12, 0x5b, 0x5c, 0x01, 0x02, 0x04] {
		if unsafe { sys::GetAsyncKeyState(key) } < 0 {
			return Err("WINDOWS_EXTERNAL_INPUT_ACTIVE".into());
		}
	}
	if inputs.is_empty() {
		return Ok(());
	}
	let _injecting = Injecting::begin();
	let sent = unsafe { sys::SendInput(inputs.len() as UINT, inputs.as_ptr(), size_of::<INPUT>() as i32) };
	note_batch(&inputs[..sent as usize]);
	if sent as usize != inputs.len() {
		// Release only keys/buttons our successfully inserted prefix pressed.
		// Cleanup deliberately does not require the now-expired input permit.
		let releases = outstanding_releases(&inputs[..sent as usize]);
		if releases.is_empty() {
			return Err(format!("SendInput delivered {sent} of {} events", inputs.len()));
		}
		let released = unsafe { sys::SendInput(releases.len() as UINT, releases.as_ptr(), size_of::<INPUT>() as i32) };
		note_batch(&releases[..released as usize]);
		if released != releases.len() as UINT {
			return Err("WINDOWS_INPUT_RELEASE_UNKNOWN".into());
		}
		return Err(format!("SendInput delivered {sent} of {} events", inputs.len()));
	}
	Ok(())
}

/// Ups for keys and buttons this worker still holds. This bypasses the input
/// permit and the physical-stop latch; otherwise a latched stop could not
/// release what this worker pressed.
pub fn release_tracked() -> Result<(), String> {
	let (keys, buttons) = crate::stop::take_held();
	if keys.is_empty() && buttons.is_empty() {
		return Ok(());
	}
	let mut inputs = Vec::new();
	for vk in keys {
		inputs.push(key_input(vk, sys::KEYEVENTF_KEYUP));
	}
	for button in buttons {
		let up = match button {
			0 => sys::MOUSEEVENTF_LEFTUP,
			1 => sys::MOUSEEVENTF_RIGHTUP,
			2 => sys::MOUSEEVENTF_MIDDLEUP,
			_ => continue,
		};
		inputs.push(mouse_input(0, 0, 0, up));
	}
	if inputs.is_empty() {
		return Ok(());
	}
	let _injecting = Injecting::begin();
	let sent = unsafe { sys::SendInput(inputs.len() as UINT, inputs.as_ptr(), size_of::<INPUT>() as i32) };
	if sent as usize != inputs.len() {
		// Keep ownership of only the ups that Windows did not accept. The
		// control loop can release that known remainder without clearing keys
		// pressed by another process or replaying a user mutation.
		for input in &inputs[sent as usize..] {
			unsafe {
				if input.type_ == sys::INPUT_KEYBOARD {
					crate::stop::note_key_down(input.u.ki.wVk);
				} else if input.type_ == sys::INPUT_MOUSE {
					for (flag, button) in
						[(sys::MOUSEEVENTF_LEFTUP, 0), (sys::MOUSEEVENTF_RIGHTUP, 1), (sys::MOUSEEVENTF_MIDDLEUP, 2)]
					{
						if input.u.mi.dwFlags & flag != 0 {
							crate::stop::note_button_down(button);
						}
					}
				}
			}
		}
		return Err("WINDOWS_INPUT_RELEASE_UNKNOWN".into());
	}
	Ok(())
}

fn button_flags(button: MouseButton) -> (u32, u32) {
	match button {
		MouseButton::Left => (sys::MOUSEEVENTF_LEFTDOWN, sys::MOUSEEVENTF_LEFTUP),
		MouseButton::Right => (sys::MOUSEEVENTF_RIGHTDOWN, sys::MOUSEEVENTF_RIGHTUP),
		MouseButton::Middle => (sys::MOUSEEVENTF_MIDDLEDOWN, sys::MOUSEEVENTF_MIDDLEUP),
	}
}

const MOVE_FLAGS: u32 = sys::MOUSEEVENTF_MOVE | sys::MOUSEEVENTF_ABSOLUTE | sys::MOUSEEVENTF_VIRTUALDESK;

pub fn send_mouse_click(x: f64, y: f64, button: MouseButton, count: u8) -> Result<(), String> {
	set_dpi_aware();
	let (dx, dy) = abs_mouse(x, y);
	let (down, up) = button_flags(button);
	let mut inputs = vec![mouse_input(dx, dy, 0, MOVE_FLAGS)];
	for _ in 0..count.max(1) {
		inputs.push(mouse_input(dx, dy, 0, down));
		inputs.push(mouse_input(dx, dy, 0, up));
	}
	send_inputs(&inputs)
}

pub fn send_mouse_drag(points: &[(f64, f64)], button: MouseButton) -> Result<(), String> {
	set_dpi_aware();
	if points.is_empty() {
		return Err("drag needs at least one point".into());
	}
	let (down, up) = button_flags(button);
	let mut inputs = Vec::with_capacity(points.len() + 2);
	let (sx, sy) = abs_mouse(points[0].0, points[0].1);
	inputs.push(mouse_input(sx, sy, 0, MOVE_FLAGS));
	inputs.push(mouse_input(sx, sy, 0, down));
	for &(x, y) in points.iter().skip(1) {
		let (dx, dy) = abs_mouse(x, y);
		inputs.push(mouse_input(dx, dy, 0, MOVE_FLAGS));
	}
	let last = *points.last().expect("non-empty");
	let (ex, ey) = abs_mouse(last.0, last.1);
	inputs.push(mouse_input(ex, ey, 0, up));
	send_inputs(&inputs)
}

pub fn send_mouse_wheel(x: f64, y: f64, delta_x: i32, delta_y: i32) -> Result<(), String> {
	set_dpi_aware();
	let (dx, dy) = abs_mouse(x, y);
	let mut inputs = vec![mouse_input(dx, dy, 0, MOVE_FLAGS)];
	if delta_y != 0 {
		inputs.push(mouse_input(dx, dy, (delta_y * WHEEL_DELTA) as u32, sys::MOUSEEVENTF_WHEEL));
	}
	if delta_x != 0 {
		inputs.push(mouse_input(dx, dy, (delta_x * WHEEL_DELTA) as u32, sys::MOUSEEVENTF_HWHEEL));
	}
	send_inputs(&inputs)
}

fn key_input(vk: u16, flags: u32) -> INPUT {
	INPUT {
		type_: sys::INPUT_KEYBOARD,
		u: INPUT_UNION { ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
	}
}

pub fn send_unicode_text(text: &str, validate: impl Fn() -> Result<(), String>) -> Result<(), String> {
	set_dpi_aware();
	// VK_PACKET state is shared: a single queued batch can be interpreted as
	// repeated final characters by modern Notepad. Pace UTF-16 units, including
	// surrogate halves, and revalidate the target/permit before every insertion.
	for ch in crate::keys::text_units(text)? {
		validate()?;
		if ch == 0x0d {
			send_inputs(&[key_input(0x0d, 0), key_input(0x0d, sys::KEYEVENTF_KEYUP)])?;
			std::thread::sleep(std::time::Duration::from_millis(80));
			continue;
		}
		let inputs = [
			INPUT {
				type_: sys::INPUT_KEYBOARD,
				u: INPUT_UNION {
					ki: KEYBDINPUT { wVk: 0, wScan: ch, dwFlags: sys::KEYEVENTF_UNICODE, time: 0, dwExtraInfo: 0 },
				},
			},
			INPUT {
				type_: sys::INPUT_KEYBOARD,
				u: INPUT_UNION {
					ki: KEYBDINPUT {
						wVk: 0,
						wScan: ch,
						dwFlags: sys::KEYEVENTF_UNICODE | sys::KEYEVENTF_KEYUP,
						time: 0,
						dwExtraInfo: 0,
					},
				},
			},
		];
		send_inputs(&inputs)?;
		std::thread::sleep(std::time::Duration::from_millis(80));
	}
	Ok(())
}

pub fn send_key(vk: u16, modifiers: &[u16]) -> Result<(), String> {
	set_dpi_aware();
	let mut inputs = Vec::new();
	for &m in modifiers {
		inputs.push(key_input(m, 0));
	}
	inputs.push(key_input(vk, 0));
	inputs.push(key_input(vk, sys::KEYEVENTF_KEYUP));
	for &m in modifiers.iter().rev() {
		inputs.push(key_input(m, sys::KEYEVENTF_KEYUP));
	}
	send_inputs(&inputs)
}

pub fn capture_window_jpeg(window_id: u32, pid: i32, max_px: u32, quality: f64) -> crate::capture::WindowImage {
	set_dpi_aware();
	let wgc = crate::wgc::capture_window(window_id, pid, max_px, quality);
	let fallback = (wgc.error == "wgc_api_unavailable").then(|| print_window_attempt(window_id, pid, max_px, quality));
	crate::capture::resolve(&wgc, fallback.as_ref())
}

fn print_window_attempt(window_id: u32, pid: i32, max_px: u32, quality: f64) -> crate::capture::Attempt {
	let before = crate::wgc::sample_identity(window_id);
	if before.process.is_empty() || before.hwnd == 0 || before.pid <= 0 || before.pid != pid {
		let error = if before.process.is_empty() || before.hwnd == 0 || before.pid <= 0 {
			"window_identity_unclear"
		} else {
			"window_identity_changed"
		};
		return crate::capture::Attempt {
			bytes: Vec::new(),
			width: 0,
			height: 0,
			error,
			cleaned: true,
			before: before.clone(),
			after: before,
		};
	}
	let hwnd = window_id as usize as HWND;
	let mut rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
	let grabbed = unsafe {
		if hwnd.is_null() || sys::GetWindowRect(hwnd, &mut rect) == 0 {
			None
		} else {
			let width = (rect.right - rect.left).max(0);
			let height = (rect.bottom - rect.top).max(0);
			if crate::capture::bounded_frame_pixels(width, height).is_err() {
				None
			} else {
				grab_bgra(hwnd, width, height).map(|bgra| (bgra, width, height))
			}
		}
	};
	let after = crate::wgc::sample_identity(window_id);
	let Some((bgra, width, height)) = grabbed else {
		return crate::capture::Attempt {
			bytes: Vec::new(),
			width: 0,
			height: 0,
			error: "print_window_failed",
			cleaned: true,
			before,
			after,
		};
	};
	let (bytes, out_w, out_h) = encode_jpeg(&bgra, width as u32, height as u32, max_px, quality);
	if bytes.is_empty() {
		return crate::capture::Attempt {
			bytes: Vec::new(),
			width: 0,
			height: 0,
			error: "print_window_failed",
			cleaned: true,
			before,
			after,
		};
	}
	crate::capture::Attempt { bytes, width: out_w, height: out_h, error: "", cleaned: true, before, after }
}

fn grab_bgra(hwnd: HWND, width: LONG, height: LONG) -> Option<Vec<u8>> {
	unsafe {
		let window_dc = sys::GetDC(hwnd);
		if window_dc.is_null() {
			return None;
		}
		let mem_dc = sys::CreateCompatibleDC(window_dc);
		if mem_dc.is_null() {
			sys::ReleaseDC(hwnd, window_dc);
			return None;
		}
		let bitmap: HBITMAP = sys::CreateCompatibleBitmap(window_dc, width, height);
		if bitmap.is_null() {
			sys::DeleteDC(mem_dc);
			sys::ReleaseDC(hwnd, window_dc);
			return None;
		}
		let old = sys::SelectObject(mem_dc, bitmap);
		if sys::PrintWindow(hwnd, mem_dc, sys::PW_RENDERFULLCONTENT) == 0 {
			sys::SelectObject(mem_dc, old);
			sys::DeleteObject(bitmap);
			sys::DeleteDC(mem_dc);
			sys::ReleaseDC(hwnd, window_dc);
			return None;
		}
		let mut info = BITMAPINFO {
			bmiHeader: BITMAPINFOHEADER {
				biSize: size_of::<BITMAPINFOHEADER>() as DWORD,
				biWidth: width,
				biHeight: -height,
				biPlanes: 1,
				biBitCount: 32,
				biCompression: sys::BI_RGB,
				biSizeImage: 0,
				biXPelsPerMeter: 0,
				biYPelsPerMeter: 0,
				biClrUsed: 0,
				biClrImportant: 0,
			},
			bmiColors: [0],
		};
		let mut pixels = vec![0u8; (width as usize) * (height as usize) * 4];
		let copied = sys::GetDIBits(
			mem_dc,
			bitmap,
			0,
			height as UINT,
			pixels.as_mut_ptr() as *mut _,
			&mut info,
			sys::DIB_RGB_COLORS,
		);
		sys::SelectObject(mem_dc, old);
		sys::DeleteObject(bitmap);
		sys::DeleteDC(mem_dc);
		sys::ReleaseDC(hwnd, window_dc);
		(copied != 0).then_some(pixels)
	}
}

/// Baseline JPEG, 4:2:0 最近邻降采样。无第三方图像库;失败返回空。
fn encode_jpeg(bgra: &[u8], width: u32, height: u32, max_px: u32, quality: f64) -> (Vec<u8>, u32, u32) {
	let _ = (bgra, width, height, max_px, quality, ptr::null::<POINT>());
	crate::jpeg::encode_bgra(bgra, width, height, max_px, quality)
}

#[cfg(test)]
mod tests {
	use super::*;
	#[test]
	fn partial_input_releases_only_still_held_owned_keys_and_buttons() {
		let prefix = [key_input(0x11, 0), key_input(0x53, 0), key_input(0x53, sys::KEYEVENTF_KEYUP)];
		let releases = outstanding_releases(&prefix);
		assert_eq!(releases.len(), 1);
		assert_eq!(unsafe { releases[0].u.ki.wVk }, 0x11);
		let mouse = [
			mouse_input(0, 0, 0, sys::MOUSEEVENTF_LEFTDOWN),
			mouse_input(0, 0, 0, sys::MOUSEEVENTF_LEFTUP),
			mouse_input(0, 0, 0, sys::MOUSEEVENTF_RIGHTDOWN),
		];
		let releases = outstanding_releases(&mouse);
		assert_eq!(releases.len(), 1);
		assert_eq!(unsafe { releases[0].u.mi.dwFlags }, sys::MOUSEEVENTF_RIGHTUP);
		assert!(outstanding_releases(&[key_input(0x11, 0), key_input(0x11, sys::KEYEVENTF_KEYUP)]).is_empty());
	}
}
