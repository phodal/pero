//! HWND Windows Graphics Capture. Public APIs only: no monitor capture,
//! no border suppression, and no new permission request.
//! Runs on the owned observation lane. The controller remains responsive and
//! terminates its owned worker on a stalled native call; no detached capture
//! thread can accumulate across display polls.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use windows::Foundation::TypedEventHandler;
use windows::Graphics::Capture::{Direct3D11CaptureFramePool, GraphicsCaptureItem, GraphicsCaptureSession};
use windows::Graphics::DirectX::Direct3D11::IDirect3DDevice;
use windows::Graphics::DirectX::DirectXPixelFormat;
use windows::Graphics::SizeInt32;
use windows::Win32::Foundation::{HMODULE, HWND, RECT, RPC_E_CHANGED_MODE};
use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
use windows::Win32::Graphics::Direct3D11::{
	D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
	D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11DeviceContext,
	ID3D11Texture2D,
};
use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
use windows::Win32::Graphics::Dxgi::IDXGIDevice;
use windows::Win32::System::WinRT::Direct3D11::{CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess};
use windows::Win32::System::WinRT::Graphics::Capture::IGraphicsCaptureItemInterop;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize};
use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, GetWindowThreadProcessId};
use windows::core::{Interface, factory};

use crate::capture::{Attempt, FrameIdentity};

const FRAME_WAIT: Duration = Duration::from_millis(800);

struct WinRt {
	owned: bool,
}
impl Drop for WinRt {
	fn drop(&mut self) {
		if self.owned {
			unsafe { RoUninitialize() };
		}
	}
}

pub(crate) fn sample_identity(window_id: u32) -> FrameIdentity {
	unsafe {
		let hwnd = HWND(window_id as usize as *mut _);
		let mut pid = 0u32;
		let _thread = GetWindowThreadProcessId(hwnd, Some(&mut pid));
		let process = crate::uia::process_identity(pid as i32).unwrap_or_default();
		let mut rect = RECT::default();
		let (mut width, mut height) = (0i32, 0i32);
		if GetWindowRect(hwnd, &mut rect).is_ok() {
			width = rect.right.saturating_sub(rect.left);
			height = rect.bottom.saturating_sub(rect.top);
		}
		FrameIdentity { process, pid: pid as i32, hwnd: window_id, width, height }
	}
}

fn classify(error: &windows::core::Error) -> &'static str {
	match error.code().0 as u32 {
		0x8007_0005 | 0x8007_02E4 => "uipi_or_secure_desktop",
		0x887A_0005 | 0x887A_0006 | 0x887A_0007 => "device_lost",
		0x8004_0154 | 0x8000_4002 | 0x8004_0111 => "wgc_api_unavailable",
		_ => "wgc_failed",
	}
}

fn rejected(error: &'static str, before: FrameIdentity) -> Attempt {
	let after = sample_identity(before.hwnd);
	Attempt { bytes: Vec::new(), width: 0, height: 0, error, cleaned: true, before, after }
}

/// Capture one window. The caller does not keep a frame that arrives after the deadline.
pub(crate) fn capture_window(window_id: u32, pid: i32, max_px: u32, quality: f64) -> Attempt {
	capture_bounded(window_id, pid, max_px, quality)
}

fn capture_bounded(window_id: u32, pid: i32, max_px: u32, quality: f64) -> Attempt {
	let before = sample_identity(window_id);
	if before.process.is_empty() || before.hwnd == 0 || before.pid <= 0 {
		return rejected("window_identity_unclear", before);
	}
	if before.pid != pid || before.hwnd != window_id {
		return rejected("window_identity_changed", before);
	}
	if before.width <= 0 || before.height <= 0 {
		return rejected("empty_window", before);
	}
	let winrt = match unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
		Ok(()) => WinRt { owned: true },
		Err(error) if error.code() == RPC_E_CHANGED_MODE => WinRt { owned: false },
		Err(error) => return rejected(classify(&error), before),
	};
	match GraphicsCaptureSession::IsSupported() {
		Ok(true) => {}
		Ok(false) => return rejected("wgc_api_unavailable", before),
		Err(error) => return rejected(classify(&error), before),
	}
	let mut attempt = match unsafe { grab(window_id, &before, max_px, quality) } {
		Ok(attempt) => attempt,
		Err(error) => rejected(error, before.clone()),
	};
	attempt.before = before;
	attempt.after = sample_identity(window_id);
	drop(winrt);
	attempt
}

struct Live {
	pool: Option<Direct3D11CaptureFramePool>,
	token: Option<i64>,
	session: Option<GraphicsCaptureSession>,
	frame_open: bool,
	context: Option<ID3D11DeviceContext>,
	staging: Option<ID3D11Texture2D>,
	mapped: bool,
}

impl Live {
	fn shutdown(&mut self) -> bool {
		let mut ok = true;
		if self.mapped {
			if let (Some(context), Some(staging)) = (self.context.as_ref(), self.staging.as_ref()) {
				unsafe { context.Unmap(staging, 0) };
			}
			self.mapped = false;
		}
		if let (Some(pool), Some(token)) = (self.pool.as_ref(), self.token.take()) {
			ok &= pool.RemoveFrameArrived(token).is_ok();
		}
		if let Some(session) = self.session.take() {
			ok &= session.Close().is_ok();
		}
		if let Some(pool) = self.pool.take() {
			ok &= pool.Close().is_ok();
		}
		self.staging.take();
		self.context.take();
		ok && !self.frame_open
	}
}

impl Drop for Live {
	fn drop(&mut self) {
		let _ = self.shutdown();
	}
}

unsafe fn grab(window_id: u32, before: &FrameIdentity, max_px: u32, quality: f64) -> Result<Attempt, &'static str> {
	let mut device = None;
	let mut context = None;
	let feature = [D3D_FEATURE_LEVEL_11_0];
	unsafe {
		D3D11CreateDevice(
			None,
			D3D_DRIVER_TYPE_HARDWARE,
			HMODULE::default(),
			D3D11_CREATE_DEVICE_BGRA_SUPPORT,
			Some(&feature),
			D3D11_SDK_VERSION,
			Some(&mut device),
			None,
			Some(&mut context),
		)
	}
	.map_err(|error| classify(&error))?;
	let device = device.ok_or("device_lost")?;
	let context = context.ok_or("device_lost")?;
	let dxgi = device.cast::<IDXGIDevice>().map_err(|error| classify(&error))?;
	let inspectable = unsafe { CreateDirect3D11DeviceFromDXGIDevice(&dxgi) }.map_err(|error| classify(&error))?;
	let winrt_device = inspectable.cast::<IDirect3DDevice>().map_err(|error| classify(&error))?;
	let interop: IGraphicsCaptureItemInterop =
		factory::<GraphicsCaptureItem, IGraphicsCaptureItemInterop>().map_err(|error| classify(&error))?;
	let item: GraphicsCaptureItem =
		unsafe { interop.CreateForWindow(HWND(window_id as usize as *mut _)) }.map_err(|error| classify(&error))?;
	let size: SizeInt32 = item.Size().map_err(|error| classify(&error))?;
	crate::capture::bounded_frame_pixels(size.Width, size.Height)?;
	let pool = Direct3D11CaptureFramePool::CreateFreeThreaded(
		&winrt_device,
		DirectXPixelFormat::B8G8R8A8UIntNormalized,
		2,
		size,
	)
	.map_err(|error| classify(&error))?;
	let mut live = Live {
		pool: Some(pool),
		token: None,
		session: None,
		frame_open: false,
		context: Some(context),
		staging: None,
		mapped: false,
	};
	let outcome = (|| {
		let arrived = Arc::new(AtomicBool::new(false));
		let flag = Arc::clone(&arrived);
		let token = live
			.pool
			.as_ref()
			.ok_or("wgc_failed")?
			.FrameArrived(&TypedEventHandler::new(move |_pool, _args| {
				flag.store(true, Ordering::SeqCst);
				Ok(())
			}))
			.map_err(|error| classify(&error))?;
		live.token = Some(token);
		// The capture border stays at the system default. This path never calls
		// SetIsBorderRequired(false) and never requests a new capability.
		let session =
			live.pool.as_ref().ok_or("wgc_failed")?.CreateCaptureSession(&item).map_err(|error| classify(&error))?;
		live.session = Some(session);
		live.session.as_ref().ok_or("wgc_failed")?.StartCapture().map_err(|error| {
			let _ = live.shutdown();
			classify(&error)
		})?;
		let started = Instant::now();
		let mut frame = None;
		while started.elapsed() < FRAME_WAIT {
			if crate::stop::blocked() {
				let cleaned = live.shutdown();
				return Ok(Attempt {
					bytes: Vec::new(),
					width: 0,
					height: 0,
					error: "operator_stop",
					cleaned,
					before: before.clone(),
					after: sample_identity(window_id),
				});
			}
			if arrived.swap(false, Ordering::SeqCst)
				&& let Some(pool) = live.pool.as_ref()
			{
				match pool.TryGetNextFrame() {
					Ok(next) => {
						frame = Some(next);
						break;
					}
					Err(error) if error.code().0 == 0 => {}
					Err(error) => {
						let _ = live.shutdown();
						return Err(classify(&error));
					}
				}
			}
			std::thread::sleep(Duration::from_millis(10));
		}
		let Some(frame) = frame else {
			let reason = if started.elapsed() >= FRAME_WAIT { "timeout" } else { "no_frame" };
			let cleaned = live.shutdown();
			return Ok(Attempt {
				bytes: Vec::new(),
				width: 0,
				height: 0,
				error: if cleaned { reason } else { "cleanup_incomplete" },
				cleaned,
				before: before.clone(),
				after: sample_identity(window_id),
			});
		};
		live.frame_open = true;
		let copied = (|| {
			let content = frame.ContentSize().map_err(|error| classify(&error))?;
			if content.Width != size.Width || content.Height != size.Height {
				return Err("resize");
			}
			let width = usize::try_from(content.Width).map_err(|_| "empty_window")?;
			let height = usize::try_from(content.Height).map_err(|_| "empty_window")?;
			crate::capture::bounded_frame_pixels(content.Width, content.Height)?;
			let surface = frame.Surface().map_err(|error| classify(&error))?;
			let access = surface.cast::<IDirect3DDxgiInterfaceAccess>().map_err(|error| classify(&error))?;
			let texture = unsafe { access.GetInterface::<ID3D11Texture2D>() }.map_err(|error| classify(&error))?;
			let mut desc = unsafe { std::mem::zeroed::<D3D11_TEXTURE2D_DESC>() };
			unsafe { texture.GetDesc(&mut desc) };
			if (desc.Width as usize) < width || (desc.Height as usize) < height {
				return Err("empty_window");
			}
			desc.Usage = D3D11_USAGE_STAGING;
			desc.BindFlags = 0;
			desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
			desc.MiscFlags = 0;
			desc.SampleDesc = DXGI_SAMPLE_DESC { Count: 1, Quality: 0 };
			desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
			let context = live.context.as_ref().ok_or("device_lost")?;
			let device_ref = &device;
			let mut staging_slot = None;
			unsafe { device_ref.CreateTexture2D(&desc, None, Some(&mut staging_slot)) }
				.map_err(|error| classify(&error))?;
			let staging = staging_slot.ok_or("device_lost")?;
			unsafe { context.CopyResource(&staging, &texture) };
			unsafe { context.Flush() };
			let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
			unsafe { context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)) }
				.map_err(|error| classify(&error))?;
			live.staging = Some(staging);
			live.mapped = true;
			let pitch = mapped.RowPitch as usize;
			if mapped.pData.is_null() || pitch < width.saturating_mul(4) {
				return Err("no_frame");
			}
			let mut bgra = vec![0u8; width.saturating_mul(height).saturating_mul(4)];
			let src = mapped.pData as *const u8;
			for y in 0..height {
				unsafe {
					std::ptr::copy_nonoverlapping(src.add(y * pitch), bgra.as_mut_ptr().add(y * width * 4), width * 4);
				}
			}
			let (bytes, out_w, out_h) = crate::jpeg::encode_bgra(&bgra, width as u32, height as u32, max_px, quality);
			if bytes.is_empty() {
				return Err("empty_window");
			}
			Ok((bytes, out_w, out_h))
		})();
		let frame_closed = frame.Close().is_ok();
		live.frame_open = false;
		let cleaned = live.shutdown() && frame_closed;
		match copied {
			Ok((bytes, width, height)) if cleaned => Ok(Attempt {
				bytes,
				width,
				height,
				error: "",
				cleaned: true,
				before: before.clone(),
				after: sample_identity(window_id),
			}),
			Ok(_) => Ok(Attempt {
				bytes: Vec::new(),
				width: 0,
				height: 0,
				error: "cleanup_incomplete",
				cleaned: false,
				before: before.clone(),
				after: sample_identity(window_id),
			}),
			Err(error) => Ok(Attempt {
				bytes: Vec::new(),
				width: 0,
				height: 0,
				error: if cleaned { error } else { "cleanup_incomplete" },
				cleaned,
				before: before.clone(),
				after: sample_identity(window_id),
			}),
		}
	})();
	let final_cleanup = live.shutdown();
	let mut attempt = match outcome {
		Ok(attempt) => attempt,
		Err(error) => Attempt {
			bytes: Vec::new(),
			width: 0,
			height: 0,
			error,
			cleaned: final_cleanup,
			before: before.clone(),
			after: sample_identity(window_id),
		},
	};
	attempt.cleaned &= final_cleanup;
	if !attempt.cleaned {
		attempt.bytes.clear();
		attempt.width = 0;
		attempt.height = 0;
		attempt.error = "cleanup_incomplete";
	}
	Ok(attempt)
}
