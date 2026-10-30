//! macOS AX, ScreenCaptureKit and window-scoped input implementation.
use crate::{bridge, profile};
use crate::{capture, scroll, window_input};
use computer_core::{Window, WindowBounds};
use computer_runtime::{DesktopDriver, WindowObservation, error};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_core::types as native;
use point_computer_macos::{apps, driver::MacOsBackend, ffi, snapshot};

pub struct Desktop {
    driver: MacOsBackend,
}
impl Desktop {
    pub fn connect() -> Self {
        Self {
            driver: MacOsBackend::new(),
        }
    }
}
impl DesktopDriver for Desktop {
    type Snapshot = native::Snapshot;
    fn environment(&self) -> ComputerEnvironment {
        profile::environment()
    }
    fn observations(&self) -> Vec<ComputerObservationKind> {
        profile::observations()
    }
    fn actions(&self) -> Vec<ComputerActionSupport> {
        profile::actions()
    }
    fn status(&self) -> ComputerDriverStatus {
        let probe = self.driver.probe_permissions();
        let state = |value: &str| {
            if value == "granted" {
                ComputerPermissionState::Granted
            } else {
                ComputerPermissionState::NotDetected
            }
        };
        ComputerDriverStatus {
            environment: Some(self.environment()),
            available: true,
            accessibility: state(probe.accessibility),
            screen_recording: state(probe.screen_recording),
            message: format!(
                "Permission owner: {}. Preflight is advisory; observing a window checks actual access.",
                point_computer_macos::permissions::responsible_process_name()
            ),
        }
    }
    fn targets(&self) -> Result<Vec<Window>, ComputerError> {
        let result = self.driver.list_apps();
        if result.ok {
            Ok(result.apps.into_iter().map(bridge::window).collect())
        } else {
            Err(error(ComputerErrorCode::PermissionRequired, result.text))
        }
    }
    fn open(&self, name: &str) -> Result<(Option<Window>, String), ComputerError> {
        let result = self.driver.launch_app(name, LaunchPermit::none());
        if result.ok {
            Ok((result.app.map(bridge::window), result.text))
        } else {
            Err(error(ComputerErrorCode::Failed, result.text))
        }
    }
    fn bounds(&self, app: &Window) -> Option<WindowBounds> {
        apps::window_bounds(app.window_id, app.pid).map(bridge::bounds)
    }
    fn observe(&self, app: &Window) -> Result<WindowObservation<Self::Snapshot>, ComputerError> {
        let app = &bridge::native_window(app);
        // Recent macOS can acknowledge an AX read while returning the application
        // itself for every window. Do not walk that cycle or expose its menus.
        if let Some(root) = ffi::ax_app_element(app.pid) {
            let windows = ffi::ax_retained_elements(&root, "AXWindows", 16);
            if !windows.is_empty()
                && windows
                    .iter()
                    .all(|window| ffi::ax_str(window, "AXRole") == "AXApplication")
            {
                return Err(error(
                    ComputerErrorCode::PermissionRequired,
                    "macOS is withholding window controls despite its permission preflight. Grant this application's Accessibility and Screen & System Audio Recording permissions, then fully quit and reopen it. On macOS 27, also check Device Control and Data Access.",
                ));
            }
        }
        // Capture stays in memory. Point's snapshot capture persists to its own
        // user directory; Pero's Desktop owns all evidence paths instead.
        let result = self.driver.snapshot(
            app,
            native::SnapshotRequest {
                want_image: false,
                ..Default::default()
            },
        );
        let mut snap = result
            .snapshot
            .filter(|_| result.ok)
            .ok_or_else(|| error(ComputerErrorCode::PermissionRequired, result.text))?;
        if !snap.has_secure
            && !snap.truncated
            && !snap.depth_truncated
            && ffi::preflight_screen_capture()
            && let Some(image) = capture::window(app.window_id)
        {
            snap.image_jpeg = image.jpeg;
            snap.image_width = image.width;
            snap.image_height = image.height;
        }
        Ok(bridge::observation(snap))
    }
    fn input(
        &self,
        app: &Window,
        observation: &native::Snapshot,
        action: ComputerAction,
    ) -> Result<(), ComputerError> {
        let app = &bridge::native_window(app);
        let window = window_input::WindowInput::new(app, observation.window_bounds.as_ref())?;
        let rec = |anchor: &ComputerAnchor| -> Option<&native::ElementRec> {
            let ComputerAnchor::Element { element_id } = anchor else {
                return None;
            };
            observation
                .elements
                .iter()
                .find(|element| element_id.as_str() == format!("element-{}", element.index))
        };
        let point = |point: ComputerPoint| -> Result<(f64, f64), ComputerError> {
            let bounds = window.bounds;
            Ok((
                bounds.x + f64::from(point.x) * bounds.w / f64::from(observation.image_width),
                bounds.y + f64::from(point.y) * bounds.h / f64::from(observation.image_height),
            ))
        };
        let result = match action.input {
            ComputerInput::Click {
                anchor,
                button,
                count,
            } => {
                let button = match button {
                    ComputerMouseButton::Left => native::MouseButton::Left,
                    ComputerMouseButton::Right => native::MouseButton::Right,
                    ComputerMouseButton::Middle => native::MouseButton::Middle,
                };
                match &anchor {
                    ComputerAnchor::Element { .. }
                        if u8::from(count) == 1
                            && action.delivery == ComputerDelivery::Background =>
                    {
                        self.driver.click(
                            app,
                            rec(&anchor),
                            native::ClickRequest {
                                method: native::ClickMethod::Accessibility,
                                point: None,
                                button,
                                count: 1,
                            },
                        )
                    }
                    ComputerAnchor::Element { .. } => {
                        let frame = rec(&anchor)
                            .and_then(|element| element.frame.as_ref())
                            .ok_or_else(|| {
                                error(
                                    ComputerErrorCode::Unsupported,
                                    "This element has no click geometry",
                                )
                            })?;
                        let bounds = window.bounds;
                        let location = (
                            bounds.x + frame.x + frame.w / 2.0,
                            bounds.y + frame.y + frame.h / 2.0,
                        );
                        if action.delivery == ComputerDelivery::Background {
                            window.click(location, button, count.into())?;
                            return Ok(());
                        }
                        window.foreground_click(location, button, count.into())?;
                        return Ok(());
                    }
                    ComputerAnchor::Pixel {
                        point: location, ..
                    } => {
                        let location = point(*location)?;
                        if action.delivery == ComputerDelivery::Background {
                            window.click(location, button, count.into())?;
                            return Ok(());
                        }
                        window.foreground_click(location, button, count.into())?;
                        return Ok(());
                    }
                }
            }
            ComputerInput::TypeText { anchor, text } => {
                if let Some(target) = rec(&anchor) {
                    self.driver.type_text(app, Some(target), text.as_str())
                } else if let ComputerAnchor::Pixel {
                    point: location, ..
                } = anchor
                {
                    let (x, y) = point(location)?;
                    window.click((x, y), native::MouseButton::Left, 1)?;
                    ffi::post_text(app.pid, text.as_str());
                    return Ok(());
                } else {
                    return Err(error(
                        ComputerErrorCode::Unsupported,
                        "The text anchor has no native target",
                    ));
                }
            }
            ComputerInput::PressKey { anchor, keys } => {
                let key = keys
                    .keys()
                    .iter()
                    .map(|key| match key.as_str() {
                        "ArrowLeft" => "left",
                        "ArrowRight" => "right",
                        "ArrowUp" => "up",
                        "ArrowDown" => "down",
                        other => other,
                    })
                    .collect::<Vec<_>>()
                    // Point treats an uppercase glyph as implicit Shift. Our
                    // input names physical keys; Shift is an explicit modifier.
                    .join("+")
                    .to_ascii_lowercase();
                let (code, flags) =
                    point_computer_core::keymap::parse_key(&key).map_err(|failure| {
                        error(ComputerErrorCode::Unsupported, failure.to_string())
                    })?;
                if let Some(target) = rec(&anchor) {
                    let (element, _) = snapshot::resolve_element(app, target).ok_or_else(|| {
                        error(
                            ComputerErrorCode::StaleObservation,
                            "The key element has changed; observe again",
                        )
                    })?;
                    if ffi::ax_set_true(&element, "AXFocused") != ffi::AX_ERR_SUCCESS {
                        return Err(error(
                            ComputerErrorCode::Failed,
                            "Cannot focus the observed key element",
                        ));
                    }
                    window.key(code, flags)?;
                    return Ok(());
                } else if let ComputerAnchor::Pixel {
                    point: location, ..
                } = anchor
                {
                    let (x, y) = point(location)?;
                    window.click((x, y), native::MouseButton::Left, 1)?;
                    window.key(code, flags)?;
                    return Ok(());
                } else {
                    return Err(error(
                        ComputerErrorCode::Unsupported,
                        "The key anchor has no native target",
                    ));
                }
            }
            ComputerInput::Scroll {
                anchor,
                delta_x,
                delta_y,
            } => {
                let location = match &anchor {
                    ComputerAnchor::Pixel {
                        point: location, ..
                    } => point(*location)?,
                    ComputerAnchor::Element { .. } => {
                        let frame = rec(&anchor)
                            .and_then(|element| element.frame.as_ref())
                            .ok_or_else(|| {
                                error(
                                    ComputerErrorCode::Unsupported,
                                    "The scroll element has no geometry",
                                )
                            })?;
                        let bounds = window.bounds;
                        (
                            bounds.x + frame.x + frame.w / 2.0,
                            bounds.y + frame.y + frame.h / 2.0,
                        )
                    }
                };
                scroll::pixels(&window, location, delta_x, delta_y)?;
                return Ok(());
            }
            ComputerInput::Drag { from, to, .. } => {
                if action.delivery == ComputerDelivery::Background {
                    window.drag(point(from)?, point(to)?)?;
                    return Ok(());
                }
                window.foreground_drag(point(from)?, point(to)?)?;
                return Ok(());
            }
        };
        if result.ok {
            Ok(())
        } else {
            Err(error(ComputerErrorCode::Failed, result.text))
        }
    }
}
