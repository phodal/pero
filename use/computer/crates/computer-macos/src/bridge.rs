//! The only Point-to-Pero value conversion for this native library.
use computer_core::{Window, WindowBounds};
use point_computer_core::types as native;

pub fn window(app: native::AppRef) -> Window {
    Window {
        pid: app.pid,
        window_id: app.window_id,
        application_id: app.bundle_id,
        name: app.name,
        title: app.window_title,
    }
}
pub fn native_window(app: &Window) -> native::AppRef {
    native::AppRef {
        pid: app.pid,
        window_id: app.window_id,
        bundle_id: app.application_id.clone(),
        name: app.name.clone(),
        window_title: app.title.clone(),
    }
}
pub fn bounds(frame: native::Frame) -> WindowBounds {
    WindowBounds {
        x: frame.x,
        y: frame.y,
        w: frame.w,
        h: frame.h,
    }
}
