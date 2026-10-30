//! Pixel-unit scroll is an adapter operation; Point's public scroll helper uses lines.
use super::window_input::WindowInput;
use pero_contracts::computer_use::{ComputerError, ComputerErrorCode};
use std::ffi::c_void;

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceCreate(state: i32) -> *mut c_void;
    fn CGEventCreateScrollWheelEvent2(
        source: *mut c_void,
        units: u32,
        count: u32,
        first: i32,
        second: i32,
        third: i32,
    ) -> *mut c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFRelease(value: *mut c_void);
}
struct Owned(*mut c_void);
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe { CFRelease(self.0) }
    }
}
pub fn pixels(
    target: &WindowInput<'_>,
    (x, y): (f64, f64),
    delta_x: i32,
    delta_y: i32,
) -> Result<(), ComputerError> {
    let event = pixel_event(delta_x, delta_y)?;
    target.post(event.0, (x, y))?;
    Ok(())
}
fn pixel_event(delta_x: i32, delta_y: i32) -> Result<Owned, ComputerError> {
    let (Some(horizontal), Some(vertical)) = (delta_x.checked_neg(), delta_y.checked_neg()) else {
        return Err(ComputerError {
            code: ComputerErrorCode::Unsupported,
            message: "Scroll delta cannot be represented by macOS".into(),
        });
    };
    // Private source avoids live user modifiers. Apple's non-variadic API sets
    // pixel and line fields consistently, with correct arm64 argument passing.
    let source = unsafe { CGEventSourceCreate(-1) };
    if source.is_null() {
        return Err(ComputerError {
            code: ComputerErrorCode::Failed,
            message: "Cannot create a native input source".into(),
        });
    }
    let source = Owned(source);
    let event = unsafe { CGEventCreateScrollWheelEvent2(source.0, 0, 2, vertical, horizontal, 0) };
    if event.is_null() {
        return Err(ComputerError {
            code: ComputerErrorCode::Failed,
            message: "Cannot create a pixel scroll event".into(),
        });
    }
    Ok(Owned(event))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[link(name = "CoreGraphics", kind = "framework")]
    unsafe extern "C" {
        fn CGEventGetIntegerValueField(event: *mut c_void, field: u32) -> i64;
    }
    #[test]
    fn pixel_scroll_units_and_direction() {
        for (x, y) in [(120, 0), (0, 120), (-35, 40), (9, -60)] {
            let event = pixel_event(x, y).unwrap();
            // PointDeltaAxis1/2 are the pixel deltas delivered to AppKit.
            assert_eq!(
                unsafe { CGEventGetIntegerValueField(event.0, 96) },
                -i64::from(y)
            );
            assert_eq!(
                unsafe { CGEventGetIntegerValueField(event.0, 97) },
                -i64::from(x)
            );
        }
    }
}
