//! Modern macOS window capture; all image bytes remain in this process.
use computer_runtime::WindowText;
use std::ffi::c_void;

unsafe extern "C" {
    fn pero_modern_capture() -> bool;
    fn pero_capture_window(
        window: u32,
        max_pixels: u32,
        width: *mut u32,
        height: *mut u32,
    ) -> *mut c_void;
    fn pero_recognize_window_text(
        bytes: *const u8,
        length: usize,
        succeeded: *mut bool,
    ) -> *mut c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFDataGetLength(data: *mut c_void) -> isize;
    fn CFDataGetBytePtr(data: *mut c_void) -> *const u8;
    fn CFRelease(value: *mut c_void);
}
pub struct WindowImage {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}
pub fn window(window: u32) -> Option<WindowImage> {
    if !unsafe { pero_modern_capture() } {
        let (jpeg, width, height) =
            point_computer_macos::ffi::capture_window_jpeg(window, 1600, 0.8);
        return (!jpeg.is_empty() && width > 0 && height > 0).then_some(WindowImage {
            jpeg,
            width,
            height,
        });
    }
    let (mut width, mut height) = (0, 0);
    let data = unsafe { pero_capture_window(window, 1600, &mut width, &mut height) };
    let jpeg = take_data(data)?;
    (width > 0 && height > 0).then_some(WindowImage {
        jpeg,
        width,
        height,
    })
}

pub fn recognize_text(jpeg: &[u8]) -> WindowText {
    let mut succeeded = false;
    let data = unsafe { pero_recognize_window_text(jpeg.as_ptr(), jpeg.len(), &mut succeeded) };
    match take_data(data) {
        Some(bytes) => String::from_utf8(bytes).map_or(WindowText::Failed, |text| {
            WindowText::Recognized(text.chars().take(6000).collect())
        }),
        None if succeeded => WindowText::NoText,
        None => WindowText::Failed,
    }
}

fn take_data(data: *mut c_void) -> Option<Vec<u8>> {
    if data.is_null() {
        return None;
    }
    // C returns retained CFData. Copy before releasing it; its byte pointer is
    // borrowed only for this synchronous copy.
    let length = unsafe { CFDataGetLength(data) };
    let bytes = unsafe { CFDataGetBytePtr(data) };
    let copy = (length > 0 && !bytes.is_null())
        .then(|| unsafe { std::slice::from_raw_parts(bytes, length as usize) }.to_vec());
    unsafe { CFRelease(data) };
    copy
}
