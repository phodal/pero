//! UIA objects remain within the caller's COM MTA. No COM handles in model refs.
use point_computer_core::types::{AppRef, ElementRec, Snapshot, SnapshotRequest};

#[cfg(not(windows))]
pub fn snapshot(_app: &AppRef, _req: SnapshotRequest) -> Result<Snapshot, String> {
	Err("WINDOWS_UIA_UNAVAILABLE".into())
}
#[cfg(not(windows))]
pub fn validate_focus(_app: &AppRef, _rec: &ElementRec, _editable: bool) -> Result<(), String> {
	Err("WINDOWS_UIA_UNAVAILABLE".into())
}
#[cfg(not(windows))]
pub fn invoke(_app: &AppRef, _rec: &ElementRec) -> Result<(), String> {
	Err("WINDOWS_UIA_UNAVAILABLE".into())
}
#[cfg(not(windows))]
pub fn process_identity(_pid: i32) -> Result<String, String> {
	Err("WINDOWS_SESSION_UNAVAILABLE".into())
}
#[cfg(not(windows))]
pub fn login_session() -> Result<u32, String> {
	Err("WINDOWS_SESSION_UNAVAILABLE".into())
}

#[cfg(windows)]
pub use native::*;
#[cfg(windows)]
mod native {
	use super::*;
	use point_computer_core::types::Frame;
	use point_computer_core::{clock, render};
	use windows::Win32::Foundation::*;
	use windows::Win32::Security::*;
	use windows::Win32::System::{Com::*, Ole::*, RemoteDesktop::*, StationsAndDesktops::*, Threading::*};
	use windows::Win32::UI::{Accessibility::*, WindowsAndMessaging::*};
	use windows::core::PWSTR;

	fn err(e: windows::core::Error) -> String {
		format!("WINDOWS_UIA_ERROR: {}", e.code())
	}
	// windows-rs projects a successful null COM pointer as Error::empty()
	// (S_OK). Only nullable TreeWalker navigation has this end-of-tree meaning;
	// E_POINTER and other actual failures must still fail the observation.
	fn nullable_node<T>(result: windows::core::Result<T>) -> Result<Option<T>, String> {
		match result {
			Ok(value) => Ok(Some(value)),
			Err(error) if error.code() == S_OK => Ok(None),
			Err(error) => Err(err(error)),
		}
	}
	struct Apartment;
	impl Drop for Apartment {
		fn drop(&mut self) {
			unsafe {
				CoUninitialize();
			}
		}
	}
	fn automation() -> Result<(Apartment, IUIAutomation), String> {
		unsafe {
			CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(err)?;
			let apartment = Apartment;
			let client = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).map_err(err)?;
			Ok((apartment, client))
		}
	}
	pub fn login_session() -> Result<u32, String> {
		unsafe {
			let mut session = 0;
			ProcessIdToSessionId(GetCurrentProcessId(), &mut session).map_err(err)?;
			if session == 0 {
				return Err("WINDOWS_NONINTERACTIVE_SESSION".into());
			}
			Ok(session)
		}
	}
	pub fn display_identity(window: u32) -> Result<String, String> {
		unsafe {
			if GetSystemMetrics(SM_CMONITORS) != 1 {
				return Err("WINDOWS_MULTIMONITOR_UNSUPPORTED".into());
			}
			let dpi = windows::Win32::UI::HiDpi::GetDpiForWindow(HWND(window as usize as _));
			if dpi == 0 {
				return Err("WINDOWS_DISPLAY_ID_UNAVAILABLE".into());
			}
			Ok(format!("single:{}:{}:{dpi}", GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)))
		}
	}
	fn session_ready(pid: i32) -> Result<(), String> {
		unsafe {
			let session = login_session()?;
			let mut target = 0;
			ProcessIdToSessionId(pid as u32, &mut target).map_err(err)?;
			if session != target {
				return Err("WINDOWS_LOGIN_SESSION_CHANGED".into());
			}
			let mut data = PWSTR::null();
			let mut bytes = 0;
			WTSQuerySessionInformationW(None, session, WTSConnectState, &mut data, &mut bytes).map_err(err)?;
			let active = bytes >= 4 && !data.is_null() && *(data.0 as *const i32) == WTSActive.0;
			WTSFreeMemory(data.0 as _);
			if !active {
				return Err("WINDOWS_SESSION_DISCONNECTED".into());
			}
			let desktop = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS)
				.map_err(|_| "WINDOWS_SCREEN_LOCKED_OR_SECURE_DESKTOP")?;
			let mut name = [0u16; 128];
			let mut needed = 0;
			let read = GetUserObjectInformationW(
				HANDLE(desktop.0),
				UOI_NAME,
				Some(name.as_mut_ptr() as _),
				256,
				Some(&mut needed),
			);
			let _ = CloseDesktop(desktop);
			read.map_err(err)?;
			let count = name.iter().position(|c| *c == 0).unwrap_or(name.len());
			if String::from_utf16_lossy(&name[..count]) != "Default" {
				return Err("WINDOWS_SCREEN_LOCKED_OR_SECURE_DESKTOP".into());
			}
			let own = GetThreadDesktop(GetCurrentThreadId()).map_err(err)?;
			let mut own_name = [0u16; 128];
			GetUserObjectInformationW(HANDLE(own.0), UOI_NAME, Some(own_name.as_mut_ptr() as _), 256, None)
				.map_err(err)?;
			if own_name != name {
				return Err("WINDOWS_NONINTERACTIVE_DESKTOP".into());
			}
			Ok(())
		}
	}
	pub fn process_identity(pid: i32) -> Result<String, String> {
		unsafe {
			let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid as u32).map_err(err)?;
			let mut created = FILETIME::default();
			let mut exit = created;
			let mut kernel = created;
			let mut user = created;
			let result = GetProcessTimes(process, &mut created, &mut exit, &mut kernel, &mut user);
			let _ = CloseHandle(process);
			result.map_err(err)?;
			Ok(format!("{pid}:{}:{}", created.dwHighDateTime, created.dwLowDateTime))
		}
	}
	fn integrity(pid: u32) -> Result<u32, String> {
		unsafe {
			let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).map_err(err)?;
			let mut token = HANDLE::default();
			let opened = OpenProcessToken(process, TOKEN_QUERY, &mut token);
			let _ = CloseHandle(process);
			opened.map_err(err)?;
			let mut needed = 0;
			let _ = GetTokenInformation(token, TokenIntegrityLevel, None, 0, &mut needed);
			// Aligned allocation: TOKEN_MANDATORY_LABEL contains a pointer.
			let mut storage = vec![0usize; (needed as usize).div_ceil(std::mem::size_of::<usize>())];
			let read =
				GetTokenInformation(token, TokenIntegrityLevel, Some(storage.as_mut_ptr() as _), needed, &mut needed);
			let _ = CloseHandle(token);
			read.map_err(err)?;
			let label = &*(storage.as_ptr() as *const TOKEN_MANDATORY_LABEL);
			let n = *GetSidSubAuthorityCount(label.Label.Sid);
			if n == 0 {
				return Err("WINDOWS_INTEGRITY_UNAVAILABLE".into());
			}
			Ok(*GetSidSubAuthority(label.Label.Sid, n as u32 - 1))
		}
	}
	unsafe fn runtime_id(element: &IUIAutomationElement) -> Result<String, String> {
		unsafe {
			let array = element.GetRuntimeId().map_err(err)?;
			let result = (|| {
				if array.is_null() || SafeArrayGetDim(array) != 1 || SafeArrayGetElemsize(array) != 4 {
					return Err("WINDOWS_UIA_ID_UNAVAILABLE".into());
				}
				let low = SafeArrayGetLBound(array, 1).map_err(err)?;
				let high = SafeArrayGetUBound(array, 1).map_err(err)?;
				if high < low || high - low > 64 {
					return Err("WINDOWS_UIA_ID_UNAVAILABLE".into());
				}
				let mut ids = Vec::new();
				for i in low..=high {
					let mut value: i32 = 0;
					SafeArrayGetElement(array, &i, &mut value as *mut _ as _).map_err(err)?;
					ids.push(value.to_string());
				}
				Ok(format!("UIA:{}", ids.join(".")))
			})();
			if !array.is_null() {
				let _ = SafeArrayDestroy(array);
			}
			result
		}
	}
	unsafe fn target_ref(element: &IUIAutomationElement) -> Result<String, String> {
		unsafe {
			Ok(format!("{}@{}", runtime_id(element)?, process_identity(element.CurrentProcessId().map_err(err)?)?))
		}
	}
	unsafe fn ancestry_secure(
		client: &IUIAutomation,
		element: &IUIAutomationElement,
		root: &IUIAutomationElement,
		pid: i32,
	) -> Result<bool, String> {
		unsafe {
			let walker = client.ControlViewWalker().map_err(err)?;
			let mut current = element.clone();
			for _ in 0..64 {
				if current.CurrentProcessId().map_err(err)? != pid {
					return Err("WINDOWS_TARGET_CHANGED".into());
				}
				if current.CurrentIsPassword().map_err(err)?.as_bool() {
					return Ok(true);
				}
				if client.CompareElements(&current, root).map_err(err)?.as_bool() {
					return Ok(false);
				}
				current = walker.GetParentElement(&current).map_err(err)?;
			}
			Err("WINDOWS_UIA_ANCESTRY_UNAVAILABLE".into())
		}
	}
	#[allow(non_upper_case_globals)]
	fn role(kind: UIA_CONTROLTYPE_ID) -> String {
		match kind {
			UIA_EditControlTypeId => "AXTextField",
			UIA_DocumentControlTypeId => "AXTextArea",
			UIA_ButtonControlTypeId => "AXButton",
			UIA_WindowControlTypeId => "AXWindow",
			UIA_ComboBoxControlTypeId => "AXComboBox",
			UIA_MenuItemControlTypeId => "AXMenuItem",
			_ => return format!("UIAControl{}", kind.0),
		}
		.into()
	}
	unsafe fn record(
		el: &IUIAutomationElement,
		index: u32,
		depth: u16,
		bounds: Frame,
		req: SnapshotRequest,
		inherited_secure: bool,
	) -> Result<ElementRec, String> {
		unsafe {
			// Password state must be known before any value is read.
			let secure = inherited_secure || el.CurrentIsPassword().map_err(err)?.as_bool();
			let kind = el.CurrentControlType().map_err(err)?;
			let rect = el.CurrentBoundingRectangle().map_err(err)?;
			let mut rec = ElementRec {
				index,
				role: role(kind),
				subrole: target_ref(el)?,
				title: if secure { String::new() } else { el.CurrentName().map_err(err)?.to_string() },
				depth,
				secure,
				enabled: el.CurrentIsEnabled().map_err(err)?.as_bool(),
				focused: el.CurrentHasKeyboardFocus().map_err(err)?.as_bool(),
				frame: Some(Frame {
					x: rect.left as f64 - bounds.x,
					y: rect.top as f64 - bounds.y,
					w: (rect.right - rect.left) as f64,
					h: (rect.bottom - rect.top) as f64,
				}),
				..Default::default()
			};
			if !secure {
				if let Ok(value) = el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId) {
					if !value.CurrentIsReadOnly().map_err(err)?.as_bool() {
						rec.traits.push("editable".into());
					}
					rec.value = value.CurrentValue().map_err(err)?.to_string().chars().take(req.text_limit).collect();
				} else if kind == UIA_DocumentControlTypeId
					&& let Ok(text) = el.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
				{
					rec.value =
						text.DocumentRange().map_err(err)?.GetText(req.text_limit as i32).map_err(err)?.to_string();
					// Document may be read-only: only TextEditPattern proves editable.
					if el.GetCurrentPatternAs::<IUIAutomationTextEditPattern>(UIA_TextEditPatternId).is_ok() {
						rec.traits.push("editable".into());
					}
				}
			}
			if el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId).is_ok() {
				rec.actions.push("press".into());
			}
			Ok(rec)
		}
	}
	pub fn snapshot(app: &AppRef, req: SnapshotRequest) -> Result<Snapshot, String> {
		let identity = process_identity(app.pid)?;
		let first = snapshot_once(app, req);
		if first.as_ref().is_err_and(|error| error == "WINDOWS_UIA_ERROR: 0x80040201") {
			// A control disappeared while walking. Drop the entire partial tree
			// (including password ancestry) and reacquire only this exact HWND.
			// This is a bounded read retry, never an input retry or target switch.
			crate::execution::check()?;
			if process_identity(app.pid)? != identity {
				return Err("WINDOWS_TARGET_CHANGED".into());
			}
			return snapshot_once(app, req);
		}
		first
	}
	fn snapshot_once(app: &AppRef, req: SnapshotRequest) -> Result<Snapshot, String> {
		session_ready(app.pid)?;
		crate::ffi::set_dpi_aware();
		let (_apartment, client) = automation()?;
		unsafe {
			let root = client.ElementFromHandle(HWND(app.window_id as usize as _)).map_err(err)?;
			if root.CurrentProcessId().map_err(err)? != app.pid {
				return Err("WINDOWS_TARGET_CHANGED".into());
			}
			let bounds = crate::apps::window_bounds(app.window_id, app.pid).ok_or("WINDOWS_WINDOW_GONE")?;
			let walker = client.ControlViewWalker().map_err(err)?;
			let mut stack = vec![(root.clone(), 0u16, false)];
			let mut elements = Vec::new();
			let mut truncated = false;
			let mut depth_truncated = false;
			let mut focused_el: Option<IUIAutomationElement> = None;
			let mut focused_secure = false;
			while let Some((el, depth, inherited_secure)) = stack.pop() {
				if elements.len() >= req.max_nodes {
					truncated = true;
					break;
				}
				let rec = record(&el, elements.len() as u32, depth, bounds, req, inherited_secure)?;
				let secure = rec.secure;
				if rec.focused {
					if secure {
						focused_secure = true;
						focused_el = None;
					} else if focused_el.is_none() || rec.traits.iter().any(|trait_name| trait_name == "editable") {
						focused_el = Some(el.clone());
					}
				}
				elements.push(rec);
				let mut children = Vec::new();
				match nullable_node(walker.GetFirstChildElement(&el))? {
					Some(mut child) => {
						if depth as usize >= req.max_depth {
							depth_truncated = true;
							continue;
						}
						loop {
							children.push((child.clone(), depth + 1, secure));
							if children.len() + elements.len() > req.max_nodes {
								truncated = true;
								break;
							}
							match nullable_node(walker.GetNextSiblingElement(&child))? {
								Some(next) => child = next,
								None => break,
							}
						}
					}
					None => {}
				}
				stack.extend(children.into_iter().rev());
			}
			let has_secure = elements.iter().any(|r| r.secure);
			let mut snap = Snapshot {
				app: app.clone(),
				has_secure,
				elements,
				window_title: app.window_title.clone(),
				window_bounds: Some(bounds),
				captured_at: clock::now(),
				truncated,
				depth_truncated,
				..Default::default()
			};
			let tree_complete = !truncated && !depth_truncated;
			// Truncation or any secure node makes the tree untrusted. Text is not
			// read, including focused text, until the whole ancestry is clear.
			let security = if focused_secure || has_secure {
				crate::text::Security::Secure
			} else if !tree_complete {
				crate::text::Security::Unknown
			} else {
				crate::text::Security::Clear
			};
			apply_text(
				&client,
				&root,
				app.pid,
				focused_el.as_ref(),
				security,
				tree_complete,
				has_secure,
				req,
				&mut snap,
			);
			Ok(snap)
		}
	}
	fn assign_text(snap: &mut Snapshot, enrichment: crate::text::Enrichment) {
		snap.focused_text = enrichment.focused.unwrap_or_default();
		snap.selected_text = enrichment.selected.unwrap_or_default();
		snap.document_text = enrichment.document.unwrap_or_default();
		snap.text_state = enrichment.state.into();
		snap.text_reason = enrichment.reason.into();
	}
	fn apply_text(
		client: &IUIAutomation,
		root: &IUIAutomationElement,
		pid: i32,
		focused: Option<&IUIAutomationElement>,
		security: crate::text::Security,
		tree_complete: bool,
		has_secure: bool,
		req: SnapshotRequest,
		snap: &mut Snapshot,
	) {
		let has_focused = focused.is_some();
		if !crate::text::read_allowed(security, tree_complete, has_focused, has_secure) {
			snap.focused_text.clear();
			snap.selected_text.clear();
			snap.document_text.clear();
			if security != crate::text::Security::Clear {
				assign_text(
					snap,
					crate::text::project(
						security,
						tree_complete,
						crate::text::Pattern::Supported,
						"",
						"",
						"",
						req.text_limit,
					),
				);
			} else if !tree_complete {
				snap.text_state = "unavailable".into();
				snap.text_reason = "tree_unconfirmed".into();
			} else {
				snap.text_state = "unavailable".into();
				snap.text_reason = "no_focused_element".into();
			}
			return;
		}
		let element = focused.expect("read_allowed requires a focused element");
		if let Err(_code) = crate::execution::check() {
			snap.focused_text.clear();
			snap.selected_text.clear();
			snap.document_text.clear();
			snap.text_state = "unavailable".into();
			snap.text_reason = "input_guard".into();
			return;
		}
		let Some(read) = crate::text::read_if_safe(security, || unsafe {
			read_focused_text(client, root, pid, element, tree_complete, req)
		}) else {
			assign_text(
				snap,
				crate::text::project(
					security,
					tree_complete,
					crate::text::Pattern::Supported,
					"",
					"",
					"",
					req.text_limit,
				),
			);
			return;
		};
		match read {
			Ok(enrichment) => assign_text(snap, enrichment),
			Err(TextRead::Suppressed(reason)) => {
				snap.focused_text.clear();
				snap.selected_text.clear();
				snap.document_text.clear();
				snap.text_state = "suppressed".into();
				snap.text_reason = reason.into();
			}
			Err(TextRead::Unavailable(reason)) => {
				snap.focused_text.clear();
				snap.selected_text.clear();
				snap.document_text.clear();
				snap.text_state = "unavailable".into();
				snap.text_reason = reason.into();
			}
		}
	}
	enum TextRead {
		Suppressed(&'static str),
		Unavailable(&'static str),
	}
	unsafe fn read_focused_text(
		client: &IUIAutomation,
		root: &IUIAutomationElement,
		pid: i32,
		element: &IUIAutomationElement,
		tree_complete: bool,
		req: SnapshotRequest,
	) -> Result<crate::text::Enrichment, TextRead> {
		if !tree_complete {
			return Err(TextRead::Unavailable("tree_unconfirmed"));
		}
		unsafe {
			// Recheck the live ancestry immediately before acquiring text. A
			// provider can move or secure an element after the original walk.
			if ancestry_secure(client, element, root, pid).unwrap_or(true) {
				return Err(TextRead::Suppressed("secure_or_unknown"));
			}
			let cache = client.CreateCacheRequest().map_err(|_| TextRead::Unavailable("text_read_failed"))?;
			cache.AddProperty(UIA_IsPasswordPropertyId).map_err(|_| TextRead::Suppressed("secure_or_unknown"))?;
			cache.AddProperty(UIA_HasKeyboardFocusPropertyId).map_err(|_| TextRead::Unavailable("text_read_failed"))?;
			cache.AddPattern(UIA_TextPatternId).map_err(|_| TextRead::Unavailable("text_pattern_unavailable"))?;
			let updated = element.BuildUpdatedCache(&cache).map_err(|_| TextRead::Unavailable("text_read_failed"))?;
			match updated.CachedIsPassword() {
				Ok(value) if value.as_bool() => return Err(TextRead::Suppressed("secure_or_unknown")),
				Err(_) => return Err(TextRead::Suppressed("secure_or_unknown")),
				Ok(_) => {}
			}
			match updated.CachedHasKeyboardFocus() {
				Ok(value) if !value.as_bool() => return Err(TextRead::Unavailable("focus_changed")),
				Err(_) => return Err(TextRead::Unavailable("text_read_failed")),
				Ok(_) => {}
			}
			let pattern = match updated.GetCachedPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
				Ok(pattern) => pattern,
				Err(_) => {
					return Ok(crate::text::project(
						crate::text::Security::Clear,
						tree_complete,
						crate::text::Pattern::Unsupported,
						"",
						"",
						"",
						req.text_limit,
					));
				}
			};
			// One extra UTF-16 unit keeps a provider's GetText bound from
			// splitting a surrogate at the output budget. project trims scalars.
			let limit = i32::try_from(req.text_limit).unwrap_or(i32::MAX - 1).saturating_add(1);
			let selected = selection_text(&pattern, limit)?;
			let focused = pattern
				.DocumentRange()
				.map_err(|_| TextRead::Unavailable("text_read_failed"))?
				.GetText(limit)
				.map_err(|_| TextRead::Unavailable("text_read_failed"))?
				.to_string();
			let document = if tree_complete { focused.clone() } else { String::new() };
			Ok(crate::text::project(
				crate::text::Security::Clear,
				tree_complete,
				crate::text::Pattern::Supported,
				&focused,
				&selected,
				&document,
				req.text_limit,
			))
		}
	}
	unsafe fn selection_text(pattern: &IUIAutomationTextPattern, limit: i32) -> Result<String, TextRead> {
		unsafe {
			let ranges = pattern.GetSelection().map_err(|_| TextRead::Unavailable("text_read_failed"))?;
			let count = ranges.Length().map_err(|_| TextRead::Unavailable("text_read_failed"))?;
			if count <= 0 {
				return Ok(String::new());
			}
			Ok(ranges
				.GetElement(0)
				.map_err(|_| TextRead::Unavailable("text_read_failed"))?
				.GetText(limit)
				.map_err(|_| TextRead::Unavailable("text_read_failed"))?
				.to_string())
		}
	}
	#[cfg(test)]
	mod tests {
		use super::*;
		#[test]
		fn tree_navigation_null_is_end_but_invalid_pointers_are_errors() {
			assert_eq!(nullable_node::<u8>(Err(windows::core::Error::empty())).unwrap(), None);
			assert_eq!(nullable_node(Ok(7u8)).unwrap(), Some(7));
			assert!(nullable_node::<u8>(Err(E_POINTER.into())).is_err());
			assert!(nullable_node::<u8>(Err(E_ACCESSDENIED.into())).is_err());
		}
	}
	pub fn validate_focus(app: &AppRef, rec: &ElementRec, editable: bool) -> Result<(), String> {
		session_ready(app.pid)?;
		unsafe {
			if integrity(app.pid as u32)? > integrity(GetCurrentProcessId())? {
				return Err("WINDOWS_HIGHER_INTEGRITY_BLOCKED".into());
			}
			if GetForegroundWindow() != HWND(app.window_id as usize as _) {
				return Err("WINDOWS_FOCUS_CHANGED".into());
			}
			let (_apartment, client) = automation()?;
			let focused = client.GetFocusedElement().map_err(err)?;
			if focused.CurrentProcessId().map_err(err)? != app.pid || target_ref(&focused)? != rec.subrole {
				return Err("WINDOWS_FOCUS_CHANGED".into());
			}
			let bounds = crate::apps::window_bounds(app.window_id, app.pid).ok_or("WINDOWS_WINDOW_GONE")?;
			let root = client.ElementFromHandle(HWND(app.window_id as usize as _)).map_err(err)?;
			let secure = rec.secure || ancestry_secure(&client, &focused, &root, app.pid)?;
			let fresh = record(&focused, rec.index, rec.depth, bounds, SnapshotRequest::default(), secure)?;
			if render::fingerprint(&fresh) != render::fingerprint(rec)
				|| fresh.frame != rec.frame
				|| !fresh.focused
				|| !fresh.enabled
				|| fresh.secure
				|| (editable && !fresh.traits.iter().any(|v| v == "editable"))
			{
				return Err("WINDOWS_TARGET_CHANGED_OR_NOT_EDITABLE".into());
			}
			session_ready(app.pid)?;
			if GetForegroundWindow() != HWND(app.window_id as usize as _) {
				return Err("WINDOWS_FOCUS_CHANGED".into());
			}
			Ok(())
		}
	}
	pub fn invoke(app: &AppRef, rec: &ElementRec) -> Result<(), String> {
		crate::execution::check()?;
		session_ready(app.pid)?;
		let (_apartment, client) = automation()?;
		unsafe {
			if integrity(app.pid as u32)? > integrity(GetCurrentProcessId())? {
				return Err("WINDOWS_HIGHER_INTEGRITY_BLOCKED".into());
			}
			if GetForegroundWindow() != HWND(app.window_id as usize as _) {
				return Err("WINDOWS_FOCUS_CHANGED".into());
			}
			let root = client.ElementFromHandle(HWND(app.window_id as usize as _)).map_err(err)?;
			let walker = client.ControlViewWalker().map_err(err)?;
			let mut stack = vec![root.clone()];
			let mut count = 0;
			while let Some(el) = stack.pop() {
				count += 1;
				if count > 1200 {
					return Err("WINDOWS_UIA_WALK_LIMIT".into());
				}
				if target_ref(&el)? == rec.subrole {
					if el.CurrentIsPassword().map_err(err)?.as_bool() || !el.CurrentIsEnabled().map_err(err)?.as_bool()
					{
						return Err("WINDOWS_TARGET_BLOCKED".into());
					}
					let bounds = crate::apps::window_bounds(app.window_id, app.pid).ok_or("WINDOWS_WINDOW_GONE")?;
					let secure = rec.secure || ancestry_secure(&client, &el, &root, app.pid)?;
					let fresh = record(&el, rec.index, rec.depth, bounds, SnapshotRequest::default(), secure)?;
					if fresh.secure {
						return Err("WINDOWS_TARGET_BLOCKED".into());
					}
					if fresh.frame != rec.frame || render::fingerprint(&fresh) != render::fingerprint(rec) {
						return Err("WINDOWS_TARGET_CHANGED".into());
					}
					crate::execution::check()?;
					session_ready(app.pid)?;
					if GetForegroundWindow() != HWND(app.window_id as usize as _) {
						return Err("WINDOWS_FOCUS_CHANGED".into());
					}
					if el.CurrentProcessId().map_err(err)? != app.pid {
						return Err("WINDOWS_TARGET_CHANGED".into());
					}
					if let Ok(pattern) = el.GetCurrentPatternAs::<IUIAutomationInvokePattern>(UIA_InvokePatternId) {
						return pattern.Invoke().map_err(err);
					}
					if fresh.traits.iter().any(|t| t == "editable") {
						return el.SetFocus().map_err(err);
					}
					return Err("WINDOWS_UIA_PATTERN_UNAVAILABLE".into());
				}
				match nullable_node(walker.GetFirstChildElement(&el))? {
					Some(mut child) => loop {
						stack.push(child.clone());
						if stack.len() > 1200 {
							return Err("WINDOWS_UIA_WALK_LIMIT".into());
						}
						match nullable_node(walker.GetNextSiblingElement(&child))? {
							Some(next) => child = next,
							None => break,
						}
					},
					None => {}
				}
			}
			Err("WINDOWS_TARGET_CHANGED".into())
		}
	}
}
