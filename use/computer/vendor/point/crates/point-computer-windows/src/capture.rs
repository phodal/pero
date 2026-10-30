//! Window JPEG capture. UIA security gates run before any capture API.
//! A PrintWindow result is never reported as Windows Graphics Capture.

use std::cell::RefCell;

use point_computer_core::types::{MAX_SCREENSHOT_MAX_PX, MIN_SCREENSHOT_MAX_PX, Snapshot};

use crate::ffi;

const QUALITY_SCALE: f64 = 100.0;
const MAX_SOURCE_PIXELS: usize = 8_388_608;

/// Bound source allocation before creating a capture pool or CPU pixel buffer.
pub fn bounded_frame_pixels(width: i32, height: i32) -> Result<usize, &'static str> {
	if width <= 0 || height <= 0 {
		return Err("empty_window");
	}
	let pixels = (width as usize).checked_mul(height as usize).ok_or("image_budget_exceeded")?;
	if pixels > MAX_SOURCE_PIXELS {
		return Err("image_budget_exceeded");
	}
	Ok(pixels)
}

thread_local! {
	static CAPTURE_OVERRIDE: RefCell<Option<fn() -> WindowImage>> = const { RefCell::new(None) };
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameIdentity {
	pub process: String,
	pub pid: i32,
	pub hwnd: u32,
	pub width: i32,
	pub height: i32,
}

impl FrameIdentity {
	pub fn none() -> Self {
		Self { process: String::new(), pid: 0, hwnd: 0, width: 0, height: 0 }
	}
}

#[derive(Clone, Debug)]
pub struct Attempt {
	pub bytes: Vec<u8>,
	pub width: u32,
	pub height: u32,
	pub error: &'static str,
	pub cleaned: bool,
	pub before: FrameIdentity,
	pub after: FrameIdentity,
}

impl Attempt {
	pub fn failed(error: &'static str) -> Self {
		Self {
			bytes: Vec::new(),
			width: 0,
			height: 0,
			error,
			cleaned: true,
			before: FrameIdentity::none(),
			after: FrameIdentity::none(),
		}
	}
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowImage {
	pub bytes: Vec<u8>,
	pub width: u32,
	pub height: u32,
	pub backend: &'static str,
	pub error: &'static str,
	pub fallback: &'static str,
}

impl WindowImage {
	pub fn empty(backend: &'static str, error: &'static str, fallback: &'static str) -> Self {
		Self { bytes: Vec::new(), width: 0, height: 0, backend, error, fallback }
	}
}

pub fn security_block(snap: &Snapshot) -> Option<&'static str> {
	if snap.has_secure {
		Some("uia_security_gate")
	} else if snap.truncated {
		Some("uia_tree_truncated")
	} else if snap.depth_truncated {
		Some("uia_depth_truncated")
	} else {
		None
	}
}

pub fn accept_frame(before: &FrameIdentity, after: &FrameIdentity) -> Result<(), &'static str> {
	if before.process.is_empty() || after.process.is_empty() || before.hwnd == 0 || after.hwnd == 0 || before.pid <= 0 {
		return Err("window_identity_unclear");
	}
	if before.process != after.process || before.pid != after.pid || before.hwnd != after.hwnd {
		return Err("window_identity_changed");
	}
	if before.width <= 0 || before.height <= 0 || after.width <= 0 || after.height <= 0 {
		return Err("empty_window");
	}
	if before.width != after.width || before.height != after.height {
		return Err("resize");
	}
	Ok(())
}

/// Timeout, device loss, UIPI and identity failure never borrow the fallback
/// frame. PrintWindow is only a labeled fallback when WGC itself is unavailable.
pub fn resolve(wgc: &Attempt, fallback: Option<&Attempt>) -> WindowImage {
	if !wgc.cleaned {
		return WindowImage::empty("windows.graphics.capture", "cleanup_incomplete", "");
	}
	if wgc.error.is_empty() {
		if wgc.bytes.is_empty() || wgc.width == 0 || wgc.height == 0 {
			return WindowImage::empty("windows.graphics.capture", "no_frame", "");
		}
		return match accept_frame(&wgc.before, &wgc.after) {
			Ok(()) => WindowImage {
				bytes: wgc.bytes.clone(),
				width: wgc.width,
				height: wgc.height,
				backend: "windows.graphics.capture",
				error: "",
				fallback: "",
			},
			Err(error) => WindowImage::empty("windows.graphics.capture", error, ""),
		};
	}
	if wgc.error == "wgc_api_unavailable" {
		let Some(print) = fallback else {
			return WindowImage::empty("unavailable", "wgc_api_unavailable", "");
		};
		if !print.cleaned {
			return WindowImage::empty("print_window", "cleanup_incomplete", "wgc_api_unavailable");
		}
		if !print.error.is_empty() {
			return WindowImage::empty("print_window", print.error, "wgc_api_unavailable");
		}
		if print.bytes.is_empty() || print.width == 0 || print.height == 0 {
			return WindowImage::empty("print_window", "no_frame", "wgc_api_unavailable");
		}
		return match accept_frame(&print.before, &print.after) {
			Ok(()) => WindowImage {
				bytes: print.bytes.clone(),
				width: print.width,
				height: print.height,
				backend: "print_window",
				error: "",
				fallback: "wgc_api_unavailable",
			},
			Err(error) => WindowImage::empty("print_window", error, "wgc_api_unavailable"),
		};
	}
	WindowImage::empty("windows.graphics.capture", wgc.error, "")
}

pub fn set_capture_override(next: Option<fn() -> WindowImage>) {
	CAPTURE_OVERRIDE.with(|slot| *slot.borrow_mut() = next);
}

pub fn attach_image(snap: Snapshot, max_px: u32, quality: u8) -> Snapshot {
	if let Some(reason) = security_block(&snap) {
		return suppressed(snap, reason);
	}
	if snap.app.window_id == 0 {
		return suppressed(snap, "window_id_missing");
	}
	let image = CAPTURE_OVERRIDE.with(|slot| {
		slot.borrow().map(|capture| capture()).unwrap_or_else(|| {
			let clamped_px = max_px.clamp(MIN_SCREENSHOT_MAX_PX, MAX_SCREENSHOT_MAX_PX);
			let clamped_quality = (quality.clamp(1, 100) as f64) / QUALITY_SCALE;
			ffi::capture_window_jpeg(snap.app.window_id, snap.app.pid, clamped_px, clamped_quality)
		})
	});
	let accept = image.error.is_empty();
	Snapshot {
		image_jpeg: if accept { image.bytes } else { Vec::new() },
		image_width: if accept { image.width } else { 0 },
		image_height: if accept { image.height } else { 0 },
		capture_backend: image.backend.into(),
		capture_error: image.error.into(),
		capture_fallback: image.fallback.into(),
		..snap
	}
}

fn suppressed(snap: Snapshot, reason: &'static str) -> Snapshot {
	Snapshot {
		image_jpeg: Vec::new(),
		image_width: 0,
		image_height: 0,
		capture_backend: "suppressed".into(),
		capture_error: reason.into(),
		capture_fallback: String::new(),
		..snap
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use point_computer_core::types::AppRef;
	use point_computer_core::types::Frame;

	#[test]
	fn source_allocation_accepts_4k_and_rejects_empty_or_excessive_frames() {
		assert_eq!(bounded_frame_pixels(3840, 2160), Ok(8_294_400));
		assert_eq!(bounded_frame_pixels(7680, 4320), Err("image_budget_exceeded"));
		assert_eq!(bounded_frame_pixels(i32::MAX, i32::MAX), Err("image_budget_exceeded"));
		assert_eq!(bounded_frame_pixels(0, 1080), Err("empty_window"));
		assert_eq!(bounded_frame_pixels(1920, -1), Err("empty_window"));
	}

	fn snap() -> Snapshot {
		Snapshot {
			app: AppRef {
				name: "Notepad".into(),
				pid: 9,
				bundle_id: "notepad.exe".into(),
				window_id: 7,
				window_title: "notes".into(),
			},
			window_bounds: Some(Frame { x: 0.0, y: 0.0, w: 100.0, h: 80.0 }),
			..Snapshot::default()
		}
	}

	fn identity() -> FrameIdentity {
		FrameIdentity { process: "9:1:2".into(), pid: 9, hwnd: 7, width: 100, height: 80 }
	}

	fn attempt(error: &'static str, bytes: Vec<u8>, before: FrameIdentity, after: FrameIdentity) -> Attempt {
		Attempt { bytes, width: 2, height: 2, error, cleaned: true, before, after }
	}

	struct OverrideGuard;
	impl Drop for OverrideGuard {
		fn drop(&mut self) {
			set_capture_override(None);
		}
	}

	#[test]
	fn security_gates_skip_capture_and_do_not_return_pixels() {
		let _guard = OverrideGuard;
		set_capture_override(Some(|| panic!("capture ran behind the UIA gate")));
		for (flag, reason) in
			[("secure", "uia_security_gate"), ("truncated", "uia_tree_truncated"), ("depth", "uia_depth_truncated")]
		{
			let mut sample = snap();
			match flag {
				"secure" => sample.has_secure = true,
				"truncated" => sample.truncated = true,
				_ => sample.depth_truncated = true,
			}
			let out = attach_image(sample, 1280, 55);
			assert!(out.image_jpeg.is_empty());
			assert_eq!(out.capture_backend, "suppressed");
			assert_eq!(out.capture_error, reason);
		}
		let mut missing = snap();
		missing.app.window_id = 0;
		assert_eq!(attach_image(missing, 1280, 55).capture_error, "window_id_missing");
	}

	#[test]
	fn timeout_identity_and_cleanup_reject_frames_without_relabeling_printwindow() {
		let good = identity();
		let wgc_bytes = vec![1, 2, 3];
		let print_bytes = vec![9, 9];
		let ok = attempt("", wgc_bytes.clone(), good.clone(), good.clone());
		assert_eq!(resolve(&ok, None).backend, "windows.graphics.capture");
		assert_eq!(resolve(&ok, None).bytes, wgc_bytes);
		assert_eq!(resolve(&attempt("", Vec::new(), good.clone(), good.clone()), None).error, "no_frame");

		let mut resized = good.clone();
		resized.width = 40;
		let resize = attempt("", wgc_bytes.clone(), good.clone(), resized);
		let rejected = resolve(&resize, Some(&attempt("", print_bytes.clone(), good.clone(), good.clone())));
		assert!(rejected.bytes.is_empty());
		assert_eq!(rejected.error, "resize");
		assert_eq!(rejected.backend, "windows.graphics.capture");
		assert_eq!(rejected.fallback, "");

		let mut reused = good.clone();
		reused.process = "9:3:4".into();
		assert_eq!(
			resolve(&attempt("", wgc_bytes.clone(), good.clone(), reused), None).error,
			"window_identity_changed"
		);
		assert_eq!(accept_frame(&FrameIdentity::none(), &good).unwrap_err(), "window_identity_unclear");

		let timeout = attempt("timeout", wgc_bytes.clone(), good.clone(), good.clone());
		let timed = resolve(&timeout, Some(&attempt("", print_bytes.clone(), good.clone(), good.clone())));
		assert!(timed.bytes.is_empty());
		assert_eq!(timed.error, "timeout");
		assert_eq!(timed.backend, "windows.graphics.capture");
		for error in ["no_frame", "empty_window", "device_lost", "uipi_or_secure_desktop"] {
			let failed = resolve(&attempt(error, wgc_bytes.clone(), good.clone(), good.clone()), None);
			assert_eq!(failed.error, error);
			assert_eq!(failed.fallback, "");
			assert_ne!(failed.backend, "print_window");
		}

		let mut dirty = attempt("timeout", wgc_bytes, good.clone(), good.clone());
		dirty.cleaned = false;
		assert_eq!(resolve(&dirty, None).error, "cleanup_incomplete");
		assert!(resolve(&dirty, None).bytes.is_empty());
	}

	#[test]
	fn printwindow_fallback_is_explicit_and_only_for_api_unavailable() {
		let good = identity();
		let print = attempt("", vec![4, 5], good.clone(), good.clone());
		let image = resolve(&attempt("wgc_api_unavailable", vec![1], good.clone(), good.clone()), Some(&print));
		assert_eq!(image.backend, "print_window");
		assert_eq!(image.fallback, "wgc_api_unavailable");
		assert_eq!(image.bytes, vec![4, 5]);
		assert_ne!(image.backend, "windows.graphics.capture");
		let missing = resolve(&Attempt::failed("wgc_api_unavailable"), None);
		assert_eq!(missing.backend, "unavailable");
		assert!(missing.bytes.is_empty());
	}

	#[test]
	fn off_windows_capture_reports_unavailable_instead_of_wgc_success() {
		if cfg!(windows) {
			return;
		}
		let out = attach_image(snap(), 1280, 55);
		assert!(out.image_jpeg.is_empty());
		assert_eq!(out.capture_backend, "unavailable");
		assert_eq!(out.capture_error, "wgc_api_unavailable");
		assert_eq!(out.app.window_id, 7);
	}
}
