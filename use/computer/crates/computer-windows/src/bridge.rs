//! The only Point-to-Pero value conversion for this native library.
use computer_core::{ControlId, ObservedControl, Window, WindowBounds, WindowImage};
use computer_runtime::WindowObservation;
use pero_contracts::computer_use::ComputerImageType;
use point_computer_core::types as native;
use std::num::NonZeroU32;

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
pub fn observation(mut source: native::Snapshot) -> WindowObservation<native::Snapshot> {
    let elements = source
        .elements
        .iter()
        .map(|e| {
            ObservedControl {
                index: ControlId(e.index),
                role: e.role.clone(),
                label: e.title.clone(),
                value: e.value.clone(),
                depth: e.depth,
                enabled: e.enabled,
                secure: e.secure,
                invocable: e.actions.iter().any(|action| action == "AXPress"),
            }
            .into_element()
        })
        .collect();
    let bytes = std::mem::take(&mut source.image_jpeg);
    let image = if bytes.is_empty() {
        None
    } else {
        NonZeroU32::new(source.image_width)
            .zip(NonZeroU32::new(source.image_height))
            .map(|(width, height)| WindowImage {
                bytes,
                width,
                height,
                media_type: ComputerImageType::Jpeg,
            })
    };
    WindowObservation {
        bounds: source.window_bounds.map(bounds),
        truncated: source.truncated || source.depth_truncated,
        elements,
        image,
        source,
    }
}
