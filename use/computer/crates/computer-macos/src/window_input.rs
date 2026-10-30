//! Bind PID-directed pointer events to the observed window and its local coordinates.
use pero_contracts::computer_use::{ComputerError, ComputerErrorCode};
use point_computer_core::types::{AppRef, Frame, MouseButton};
use point_computer_macos::{
    ffi::{self, CfRef},
    skylight,
};
use std::{
    ffi::{c_char, c_void},
    time::Duration,
};

#[repr(C)]
struct Point {
    x: f64,
    y: f64,
}
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGEventSourceCreate(state: i32) -> *mut c_void;
    fn CGEventCreateMouseEvent(
        source: *mut c_void,
        kind: u32,
        point: Point,
        button: u32,
    ) -> *mut c_void;
    fn CGEventCreateKeyboardEvent(source: *mut c_void, key: u16, down: bool) -> *mut c_void;
    fn CGEventSetIntegerValueField(event: *mut c_void, field: u32, value: i64);
    fn CGEventSetLocation(event: *mut c_void, point: Point);
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventPostToPid(pid: i32, event: *mut c_void);
    fn CGEventPost(tap: u32, event: *mut c_void);
}
unsafe extern "C" {
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
}
pub struct WindowInput<'a> {
    pid: i32,
    id: u32,
    pub bounds: &'a Frame,
}
struct SyntheticFocus {
    psn: [u8; skylight::PSN_SIZE],
    window: u32,
    post: unsafe extern "C" fn(*const c_void, *const u8) -> i32,
}
impl Drop for SyntheticFocus {
    fn drop(&mut self) {
        std::thread::sleep(Duration::from_secs_f64(
            skylight::DELAY_BEFORE_FOCUS_RELEASE,
        ));
        unsafe {
            (self.post)(
                self.psn.as_ptr().cast(),
                skylight::activation_record(self.window, false).as_ptr(),
            );
        }
    }
}
impl<'a> WindowInput<'a> {
    pub fn new(app: &AppRef, bounds: Option<&'a Frame>) -> Result<Self, ComputerError> {
        let bounds = bounds.ok_or_else(|| ComputerError {
            code: ComputerErrorCode::Unsupported,
            message: "The observed window has no input geometry".into(),
        })?;
        Ok(Self {
            pid: app.pid,
            id: app.window_id,
            bounds,
        })
    }
    pub fn post(&self, event: *mut c_void, (x, y): (f64, f64)) -> Result<(), ComputerError> {
        // AppKit's NSEvent window-number field is not exposed as a public enum
        // case. A bare PID post leaves it zero and AppKit drops the pointer input.
        // CGEventSetLocation does not initialize AppKit's window-local position.
        // Resolve the window-local setter rather than guessing a context field.
        // Refuse when unavailable; background input never falls back to global.
        let symbol = unsafe { dlsym(-2isize as *mut c_void, c"CGEventSetWindowLocation".as_ptr()) };
        if symbol.is_null() {
            return Err(ComputerError {
                code: ComputerErrorCode::Unsupported,
                message: "This macOS cannot route background window coordinates".into(),
            });
        }
        let set_local: unsafe extern "C" fn(*mut c_void, Point) =
            unsafe { std::mem::transmute(symbol) };
        unsafe {
            CGEventSetIntegerValueField(event, 51, i64::from(self.id));
            CGEventSetLocation(event, Point { x, y });
            set_local(
                event,
                Point {
                    x: x - self.bounds.x,
                    y: y - self.bounds.y,
                },
            );
            CGEventSetFlags(event, 0);
            CGEventPostToPid(self.pid, event);
        }
        Ok(())
    }
    fn mouse(
        &self,
        kind: u32,
        point: (f64, f64),
        button: u32,
        count: u8,
    ) -> Result<(), ComputerError> {
        let source = unsafe { CfRef::from_created(CGEventSourceCreate(-1)) };
        let source = source.ok_or_else(failed)?;
        let event = unsafe {
            CfRef::from_created(CGEventCreateMouseEvent(
                source.as_ptr(),
                kind,
                Point { x: 0., y: 0. },
                button,
            ))
        };
        let event = event.ok_or_else(failed)?;
        unsafe { CGEventSetIntegerValueField(event.as_ptr(), 1, i64::from(count)) };
        self.post(event.as_ptr(), point)?;
        Ok(())
    }
    pub fn click(
        &self,
        point: (f64, f64),
        button: MouseButton,
        count: u8,
    ) -> Result<(), ComputerError> {
        let _focus = self.focus()?;
        let (number, down, up, _) = codes(button);
        for count in 1..=count {
            for kind in [down, up] {
                self.mouse(kind, point, number, count)?;
                std::thread::sleep(Duration::from_millis(12));
            }
        }
        Ok(())
    }
    fn focus(&self) -> Result<Option<SyntheticFocus>, ComputerError> {
        let frontmost = ffi::window_list()
            .into_iter()
            .find(|w| w.layer == 0)
            .is_some_and(|w| w.pid == self.pid);
        let focus = if frontmost {
            None
        } else {
            let spi = skylight::spi();
            let (Some(get), Some(post)) = (spi.get_process_for_pid, spi.post_event_record) else {
                return Err(ComputerError {
                    code: ComputerErrorCode::Unsupported,
                    message: "Background window focus is unavailable on this macOS".into(),
                });
            };
            let mut psn = [0; skylight::PSN_SIZE];
            if unsafe { get(self.pid, psn.as_mut_ptr().cast()) } != 0
                || unsafe {
                    post(
                        psn.as_ptr().cast(),
                        skylight::activation_record(self.id, true).as_ptr(),
                    )
                } != 0
            {
                return Err(failed());
            }
            std::thread::sleep(Duration::from_secs_f64(skylight::DELAY_FOCUS_SETTLE));
            Some(SyntheticFocus {
                psn,
                window: self.id,
                post,
            })
        };
        Ok(focus)
    }
    pub fn drag(
        &self,
        from: (f64, f64),
        to: (f64, f64),
        delivery: pero_contracts::computer_use::ComputerDelivery,
        cancellation: &computer_runtime::Cancellation,
    ) -> Result<(), ComputerError> {
        let foreground = delivery == pero_contracts::computer_use::ComputerDelivery::Foreground;
        if foreground {
            self.foreground_point(from)?;
            self.foreground_point(to)?;
        }
        let _focus = if foreground { None } else { self.focus()? };
        self.button_event(1, from, 0, foreground)?;
        let mut held = HeldButton {
            window: self,
            point: from,
            number: 0,
            up: 2,
            foreground,
            armed: true,
        };
        for (kind, x, y) in ffi::drag_plan(from, to, 1, 2, 6, ffi::DRAG_STEPS, None) {
            if kind != 6 {
                continue;
            }
            cancellation.wait(Duration::from_millis(12))?;
            self.button_event(kind, (x, y), 0, foreground)?;
            held.point = (x, y);
        }
        self.button_event(6, to, 0, foreground)?;
        held.point = to;
        held.release()
    }
    pub fn long_press(
        &self,
        point: (f64, f64),
        button: MouseButton,
        hold_ms: u16,
        delivery: pero_contracts::computer_use::ComputerDelivery,
        cancellation: &computer_runtime::Cancellation,
    ) -> Result<(), ComputerError> {
        let foreground = delivery == pero_contracts::computer_use::ComputerDelivery::Foreground;
        if foreground {
            self.foreground_point(point)?;
        }
        let _focus = if foreground { None } else { self.focus()? };
        let (number, down, up, _) = codes(button);
        self.button_event(down, point, number, foreground)?;
        let held = HeldButton {
            window: self,
            point,
            number,
            up,
            foreground,
            armed: true,
        };
        let result = cancellation.wait(Duration::from_millis(hold_ms.into()));
        held.release()?;
        result
    }
    fn button_event(
        &self,
        kind: u32,
        point: (f64, f64),
        button: u32,
        foreground: bool,
    ) -> Result<(), ComputerError> {
        if !foreground {
            return self.mouse(kind, point, button, 1);
        }
        let source = unsafe { CfRef::from_created(CGEventSourceCreate(-1)) }.ok_or_else(failed)?;
        let event = unsafe {
            CfRef::from_created(CGEventCreateMouseEvent(
                source.as_ptr(),
                kind,
                Point {
                    x: point.0,
                    y: point.1,
                },
                button,
            ))
        }
        .ok_or_else(failed)?;
        unsafe {
            CGEventPost(0, event.as_ptr());
        }
        Ok(())
    }
    pub fn key(&self, code: u8, flags: u64) -> Result<(), ComputerError> {
        let _focus = self.focus()?;
        let source = unsafe { CfRef::from_created(CGEventSourceCreate(-1)) }.ok_or_else(failed)?;
        for down in [true, false] {
            let event = unsafe {
                CfRef::from_created(CGEventCreateKeyboardEvent(
                    source.as_ptr(),
                    code.into(),
                    down,
                ))
            }
            .ok_or_else(failed)?;
            unsafe {
                CGEventSetIntegerValueField(event.as_ptr(), 51, i64::from(self.id));
                CGEventSetFlags(event.as_ptr(), flags);
                CGEventPostToPid(self.pid, event.as_ptr());
            }
        }
        Ok(())
    }
    pub fn text(&self, text: &str) -> Result<(), ComputerError> {
        let _focus = self.focus()?;
        ffi::post_text(self.pid, text);
        Ok(())
    }
    pub fn move_to(
        &self,
        point: (f64, f64),
        delivery: pero_contracts::computer_use::ComputerDelivery,
    ) -> Result<(), ComputerError> {
        if delivery == pero_contracts::computer_use::ComputerDelivery::Foreground {
            self.foreground_point(point)?;
            // kCGEventMouseMoved, kCGHIDEventTap; this intentionally moves the real cursor.
            let source =
                unsafe { CfRef::from_created(CGEventSourceCreate(-1)) }.ok_or_else(failed)?;
            let event = unsafe {
                CfRef::from_created(CGEventCreateMouseEvent(
                    source.as_ptr(),
                    5,
                    Point {
                        x: point.0,
                        y: point.1,
                    },
                    0,
                ))
            }
            .ok_or_else(failed)?;
            unsafe {
                CGEventPost(0, event.as_ptr());
            }
            Ok(())
        } else {
            let _focus = self.focus()?;
            self.mouse(5, point, 0, 0)
        }
    }
    fn foreground_point(&self, (x, y): (f64, f64)) -> Result<(), ComputerError> {
        let hit = ffi::ax_element_at_point(x, y);
        let hit_pid = hit.as_ref().and_then(ffi::ax_pid);
        let hit_window = hit
            .as_ref()
            .and_then(crate::observation::window_of)
            .map(|w| ffi::ax_window_id(&w));
        let valid = hit_pid == Some(self.pid) && hit_window == Some(self.id);
        if !valid {
            return Err(ComputerError {
                code: ComputerErrorCode::TargetUnavailable,
                message: format!(
                    "The foreground point does not belong to the selected window; expose the target and observe again (hit pid {:?}, window {:?}; selected pid {}, window {})",
                    hit_pid, hit_window, self.pid, self.id
                ),
            });
        }
        Ok(())
    }
    pub fn foreground_click(
        &self,
        point: (f64, f64),
        button: MouseButton,
        count: u8,
    ) -> Result<(), ComputerError> {
        self.foreground_point(point)?;
        ffi::post_mouse_global(point.0, point.1, button, count);
        Ok(())
    }
}
struct HeldButton<'a, 'b> {
    window: &'a WindowInput<'b>,
    point: (f64, f64),
    number: u32,
    up: u32,
    foreground: bool,
    armed: bool,
}
impl HeldButton<'_, '_> {
    fn release(mut self) -> Result<(), ComputerError> {
        self.armed = false;
        self.window
            .button_event(self.up, self.point, self.number, self.foreground)
    }
}
impl Drop for HeldButton<'_, '_> {
    fn drop(&mut self) {
        if self.armed {
            let _ = self
                .window
                .button_event(self.up, self.point, self.number, self.foreground);
        }
    }
}
fn failed() -> ComputerError {
    ComputerError {
        code: ComputerErrorCode::Failed,
        message: "Cannot create a window input event".into(),
    }
}
fn codes(button: MouseButton) -> (u32, u32, u32, u32) {
    match button {
        MouseButton::Left => (0, 1, 2, 6),
        MouseButton::Right => (1, 3, 4, 7),
        MouseButton::Middle => (2, 25, 26, 27),
    }
}
