//! Window-directed paste with scoped ownership of the macOS pasteboard.
use crate::{
    observation::{belongs, element_attribute},
    window_input::WindowInput,
};
use computer_core::Window;
use computer_runtime::{Cancellation, error};
use pero_contracts::computer_use::{ComputerError, ComputerErrorCode, ComputerPasteFormat};
use point_computer_macos::ffi::{self, CfRef};
use std::{
    ffi::c_void,
    ptr::NonNull,
    time::{Duration, Instant},
};

unsafe extern "C" {
    fn pero_pasteboard_stage(bytes: *const u8, length: usize, html: bool) -> *mut c_void;
    fn pero_pasteboard_owns(handle: *mut c_void) -> bool;
    fn pero_pasteboard_restore(handle: *mut c_void) -> bool;
}

#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXUIElementSetMessagingTimeout(element: *const c_void, seconds: f32) -> i32;
}

fn editor_state(editor: &CfRef) -> (String, Option<(isize, isize)>) {
    (
        ffi::ax_str(editor, "AXValue"),
        ffi::ax_range(editor, "AXSelectedTextRange").map(|range| (range.location, range.length)),
    )
}

struct PasteboardLease(Option<NonNull<c_void>>);

impl PasteboardLease {
    fn restore(&mut self) -> Result<(), ComputerError> {
        if let Some(handle) = self.0.take()
            && !unsafe { pero_pasteboard_restore(handle.as_ptr()) }
        {
            return Err(error(
                ComputerErrorCode::Failed,
                "macOS did not restore the previous clipboard.",
            ));
        }
        Ok(())
    }
}

impl Drop for PasteboardLease {
    fn drop(&mut self) {
        let _ = self.restore();
    }
}

pub(crate) fn paste(
    app: &Window,
    window: &WindowInput,
    text: &str,
    format: ComputerPasteFormat,
    cancellation: &Cancellation,
) -> Result<(), ComputerError> {
    let markdown = (format == ComputerPasteFormat::Md).then(|| markdown::to_html(text));
    let payload = markdown.as_deref().unwrap_or(text);
    let editor = ffi::ax_app_element(app.pid)
        .and_then(|application| element_attribute(&application, "AXFocusedUIElement"))
        .filter(|editor| {
            belongs(editor, app) && ffi::ax_str(editor, "AXSubrole") != "AXSecureTextField"
        })
        .ok_or_else(|| {
            error(
                ComputerErrorCode::StaleObservation,
                "Focus an editor in the observed window before pasting.",
            )
        })?;
    // Cancellation must be checked before the worker's shutdown deadline.
    unsafe {
        AXUIElementSetMessagingTimeout(editor.as_ptr(), 0.25);
    }
    let before = editor_state(&editor);
    cancellation.wait(Duration::ZERO)?;
    let handle = unsafe {
        pero_pasteboard_stage(
            payload.as_ptr(),
            payload.len(),
            format != ComputerPasteFormat::Text,
        )
    };
    let mut lease = PasteboardLease(Some(NonNull::new(handle).ok_or_else(|| {
        error(
            ComputerErrorCode::Failed,
            "Paste could not preserve the current clipboard.",
        )
    })?));
    let sent = (|| {
        cancellation.wait(Duration::ZERO)?;
        let (code, flags) = point_computer_core::keymap::parse_key("cmd+v")
            .expect("macOS paste key must be supported");
        window.foreground_key(code, flags)?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(2) {
            if !unsafe { pero_pasteboard_owns(handle) } {
                return Err(error(
                    ComputerErrorCode::Cancelled,
                    "The clipboard changed while sending paste. Observe the editor before repeating.",
                ));
            }
            if editor_state(&editor) != before {
                return Ok(());
            }
            cancellation.wait(Duration::from_millis(40))?;
        }
        Err(error(
            ComputerErrorCode::Timeout,
            "The editor did not confirm paste. Observe it before repeating.",
        ))
    })();
    let restored = lease.restore();
    sent.and(restored)
}
