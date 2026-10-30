//! Physical Escape is an operator stop. Injected and semantic Escape are not.
//! The hook callback only stores an atomic; it does not wait on UIA or capture.
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, MutexGuard};

pub const VK_ESCAPE: u32 = 0x1b;
pub const LLKHF_INJECTED: u32 = 0x10;
pub const LLKHF_LOWER_IL_INJECTED: u32 = 0x02;

static SIGNAL: AtomicBool = AtomicBool::new(false);
static LATCHED: AtomicBool = AtomicBool::new(false);
static INJECTING: AtomicU32 = AtomicU32::new(0);
static HELD: Mutex<Held> = Mutex::new(Held { keys: Vec::new(), buttons: Vec::new() });

#[derive(Default)]
struct Held {
	keys: Vec<u16>,
	buttons: Vec<u8>,
}

fn held() -> MutexGuard<'static, Held> {
	HELD.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// A non-injected Escape is the operator, including while this worker is inside
/// SendInput. Injected flags are the only semantic-Escape exclusion.
pub fn is_physical_escape(vk: u32, flags: u32, _worker_injecting: bool) -> bool {
	vk == VK_ESCAPE && flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED) == 0
}

pub fn observe_key(vk: u32, flags: u32) {
	if is_physical_escape(vk, flags, INJECTING.load(Ordering::SeqCst) > 0) {
		SIGNAL.store(true, Ordering::SeqCst);
	}
}

pub fn blocked() -> bool {
	SIGNAL.load(Ordering::SeqCst) || LATCHED.load(Ordering::SeqCst)
}

pub fn set_latched(active: bool) {
	LATCHED.store(active, Ordering::SeqCst);
	if !active {
		SIGNAL.store(false, Ordering::SeqCst);
	}
}

pub fn clear_latch() {
	set_latched(false);
}

pub fn consume_signal() -> bool {
	SIGNAL.swap(false, Ordering::SeqCst)
}

pub fn note_key_down(vk: u16) {
	let mut held = held();
	if !held.keys.contains(&vk) {
		held.keys.push(vk);
	}
}

pub fn note_key_up(vk: u16) {
	held().keys.retain(|key| *key != vk);
}

pub fn note_button_down(button: u8) {
	let mut held = held();
	if !held.buttons.contains(&button) {
		held.buttons.push(button);
	}
}

pub fn note_button_up(button: u8) {
	held().buttons.retain(|item| *item != button);
}

pub fn take_held() -> (Vec<u16>, Vec<u8>) {
	let mut held = held();
	(std::mem::take(&mut held.keys), std::mem::take(&mut held.buttons))
}

pub fn has_held() -> bool {
	let held = held();
	!held.keys.is_empty() || !held.buttons.is_empty()
}

pub fn begin_inject() {
	INJECTING.fetch_add(1, Ordering::SeqCst);
}

pub fn end_inject() {
	INJECTING.fetch_sub(1, Ordering::SeqCst);
}

pub fn worker_is_injecting() -> bool {
	INJECTING.load(Ordering::SeqCst) > 0
}

/// Release only keys and buttons this worker still holds. Callers must not
/// invoke this from the hook callback.
pub fn release_held() -> Result<(), String> {
	crate::ffi::release_tracked()
}

#[cfg(windows)]
pub struct EscapeListener {
	thread: Option<std::thread::JoinHandle<()>>,
	thread_id: u32,
}

#[cfg(windows)]
pub fn start_listener() -> Result<EscapeListener, String> {
	let (ready, started) = std::sync::mpsc::sync_channel::<Result<u32, String>>(1);
	let thread = std::thread::Builder::new()
		.name("point-escape".into())
		.spawn(move || {
			use windows::Win32::UI::WindowsAndMessaging::{
				GetMessageW, MSG, PM_NOREMOVE, PeekMessageW, SetWindowsHookExW, UnhookWindowsHookEx, WH_KEYBOARD_LL,
			};
			// The queue must exist before the hook and before the ready ack, or a
			// later WM_QUIT can be posted into a thread that has no queue yet.
			let mut message = MSG::default();
			unsafe {
				let _ = PeekMessageW(&mut message, None, 0, 0, PM_NOREMOVE);
			}
			let hook = unsafe { SetWindowsHookExW(WH_KEYBOARD_LL, Some(escape_hook), None, 0) };
			let Ok(hook) = hook else {
				let _ = ready.send(Err("WINDOWS_ESCAPE_HOOK_UNAVAILABLE".into()));
				return;
			};
			let thread_id = unsafe { windows::Win32::System::Threading::GetCurrentThreadId() };
			let _ = ready.send(Ok(thread_id));
			// GetMessageW returns 0 for WM_QUIT and -1 for an error. A nonzero
			// check would treat the error as another message and loop forever.
			loop {
				let code = unsafe { GetMessageW(&mut message, None, 0, 0) };
				if code.0 <= 0 {
					break;
				}
			}
			let _ = unsafe { UnhookWindowsHookEx(hook) };
		})
		.map_err(|error| error.to_string())?;
	let thread_id =
		started.recv_timeout(std::time::Duration::from_secs(2)).map_err(|_| "WINDOWS_ESCAPE_HOOK_TIMEOUT")??;
	Ok(EscapeListener { thread: Some(thread), thread_id })
}

#[cfg(windows)]
impl Drop for EscapeListener {
	fn drop(&mut self) {
		unsafe {
			let _ = windows::Win32::UI::WindowsAndMessaging::PostThreadMessageW(
				self.thread_id,
				0x0012,
				windows::Win32::Foundation::WPARAM(0),
				windows::Win32::Foundation::LPARAM(0),
			);
		}
		if let Some(thread) = self.thread.take() {
			let (finished, joined) = std::sync::mpsc::channel();
			std::thread::spawn(move || {
				let _ = thread.join();
				let _ = finished.send(());
			});
			let _ = joined.recv_timeout(std::time::Duration::from_millis(500));
		}
	}
}

#[cfg(windows)]
unsafe extern "system" fn escape_hook(
	code: i32,
	wparam: windows::Win32::Foundation::WPARAM,
	lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
	if code >= 0 && (wparam.0 == 0x0100 || wparam.0 == 0x0104) && lparam.0 != 0 {
		let event = unsafe { &*(lparam.0 as *const windows::Win32::UI::WindowsAndMessaging::KBDLLHOOKSTRUCT) };
		observe_key(event.vkCode, event.flags.0);
	}
	unsafe { windows::Win32::UI::WindowsAndMessaging::CallNextHookEx(None, code, wparam, lparam) }
}

#[cfg(test)]
pub(crate) fn test_gate() -> MutexGuard<'static, ()> {
	static GATE: Mutex<()> = Mutex::new(());
	GATE.lock().unwrap_or_else(|poison| poison.into_inner())
}

#[cfg(test)]
mod tests {
	use super::*;

	struct Reset;
	impl Drop for Reset {
		fn drop(&mut self) {
			clear_latch();
			let _ = take_held();
			while INJECTING.load(Ordering::SeqCst) > 0 {
				end_inject();
			}
		}
	}

	#[test]
	fn injected_or_semantic_escape_is_not_a_physical_stop() {
		let _gate = test_gate();
		let _reset = Reset;
		assert!(is_physical_escape(VK_ESCAPE, 0, false));
		assert!(is_physical_escape(VK_ESCAPE, 0, true));
		assert!(!is_physical_escape(VK_ESCAPE, LLKHF_INJECTED, false));
		assert!(!is_physical_escape(VK_ESCAPE, LLKHF_LOWER_IL_INJECTED, true));
		assert!(!is_physical_escape(0x41, 0, false));
		begin_inject();
		observe_key(VK_ESCAPE, LLKHF_INJECTED);
		assert!(!blocked(), "injected Escape is semantic input");
		observe_key(VK_ESCAPE, 0);
		assert!(blocked(), "physical Escape during SendInput is still the operator");
		end_inject();
		assert!(consume_signal());
		assert!(!blocked());
		observe_key(VK_ESCAPE, 0);
		assert!(blocked());
		assert!(consume_signal());
		set_latched(true);
		assert!(blocked());
		clear_latch();
		assert!(!blocked());
	}

	#[test]
	fn release_list_contains_only_keys_this_worker_pressed() {
		let _gate = test_gate();
		let _reset = Reset;
		note_key_down(0x11);
		note_button_down(0);
		note_key_down(0x11);
		note_key_up(0x11);
		let (keys, buttons) = take_held();
		assert!(keys.is_empty());
		assert_eq!(buttons, vec![0]);
		assert!(take_held().0.is_empty() && take_held().1.is_empty());
	}
}
