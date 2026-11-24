//! Windows UIA, WGC/PrintWindow and explicit foreground input.
use crate::{bridge, profile};
use computer_core::{ControlId, Window, WindowBounds};
use computer_runtime::{Cancellation, DesktopDriver, WindowObservation, error};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_core::types as native;
use point_computer_windows::{apps, driver::WindowsBackend, ffi, uia};
use std::time::Duration;

fn screenshot_point(
    snap: &native::Snapshot,
    point: ComputerPoint,
) -> Result<(f64, f64), ComputerError> {
    let frame = snap.image_bounds.ok_or_else(|| {
        error(
            ComputerErrorCode::Unsupported,
            "Window screenshot geometry is unavailable",
        )
    })?;
    Ok((
        frame.x + f64::from(point.x) * frame.w / f64::from(snap.image_width),
        frame.y + f64::from(point.y) * frame.h / f64::from(snap.image_height),
    ))
}

pub struct Desktop {
    driver: WindowsBackend,
}
impl Desktop {
    pub fn connect() -> Self {
        Self {
            driver: WindowsBackend::new(),
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
        let ready = uia::session_ready(std::process::id() as i32);
        ComputerDriverStatus {
            environment: Some(self.environment()),
            available: ready.is_ok(),
            accessibility: ComputerPermissionState::Unsupported,
            screen_recording: ComputerPermissionState::Unsupported,
            message: match ready {
                Ok(()) => "Windows UIA and window capture are available. Use foreground for keyboard and pixel input. Background supports UIA invocation only.".into(),
                Err(reason) => format!("Computer Use requires an unlocked interactive Windows desktop ({reason})."),
            },
        }
    }
    fn targets(&self) -> Result<Vec<Window>, ComputerError> {
        Ok(ffi::window_list()
            .into_iter()
            .filter(|w| w.layer == 0 && w.pid > 0)
            .map(|w| native::AppRef {
                name: w.owner_name.clone(),
                bundle_id: w.owner_name,
                pid: w.pid,
                window_id: w.window_id,
                window_title: w.title,
            })
            .map(bridge::window)
            .collect())
    }
    fn open(
        &self,
        application: &ComputerApplicationSelector,
    ) -> Result<(Option<Window>, String), ComputerError> {
        let ComputerApplicationSelector::Name(name) = application else {
            return Err(error(
                ComputerErrorCode::Unsupported,
                "Bundle ID selection is available on macOS",
            ));
        };
        let name = name.as_str();
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
    fn observe(
        &self,
        app: &Window,
        options: &ComputerObserveOptions,
        _: Option<&Self::Snapshot>,
    ) -> Result<WindowObservation<Self::Snapshot>, ComputerError> {
        let defaults = ComputerObserveOptions::default();
        if options.root.is_some()
            || options.max_nodes != defaults.max_nodes
            || options.max_depth != defaults.max_depth
        {
            return Err(error(
                ComputerErrorCode::Unsupported,
                "This platform does not support bounded accessibility subtree observations",
            ));
        }

        let app = &bridge::native_window(app);
        let result = self.driver.snapshot(
            app,
            native::SnapshotRequest {
                want_image: options.want_image,
                image_max_px: 1600,
                ..Default::default()
            },
        );
        result
            .snapshot
            .filter(|_| result.ok)
            .map(|snapshot| bridge::observation(snapshot, options.want_image))
            .ok_or_else(|| error(ComputerErrorCode::PermissionRequired, result.text))
    }
    fn admit(&self, snap: &native::Snapshot, action: &ComputerAction) -> Result<(), ComputerError> {
        let anchor = match &action.input {
            ComputerInput::Move { anchor }
            | ComputerInput::Hover { anchor, .. }
            | ComputerInput::Hold { anchor, .. } => anchor,
            _ => return Ok(()),
        };
        let ComputerAnchor::Pixel { point, .. } = anchor else {
            return Err(error(
                ComputerErrorCode::Unsupported,
                "Windows pointer movement and holds require a screenshot pixel",
            ));
        };
        let (x, y) = screenshot_point(snap, *point)?;
        if !ffi::window_owns_point(snap.app.window_id, snap.app.pid, x, y) {
            return Err(error(
                ComputerErrorCode::TargetUnavailable,
                "Expose the selected window at the requested pixel",
            ));
        }
        Ok(())
    }
    fn input(
        &self,
        app: &Window,
        snap: &native::Snapshot,
        action: ComputerAction,
        cancellation: &Cancellation,
    ) -> Result<Option<ComputerExecution>, ComputerError> {
        let app = &bridge::native_window(app);
        let bounds = snap.window_bounds.ok_or_else(|| {
            error(
                ComputerErrorCode::Unsupported,
                "Window input geometry is unavailable",
            )
        })?;
        let point = |point| screenshot_point(snap, point);
        let element = |anchor: &ComputerAnchor| {
            let ComputerAnchor::Element { element_id } = anchor else {
                return None;
            };
            snap.elements
                .iter()
                .find(|e| element_id.as_str() == ControlId(e.index).reference().as_str())
        };
        let location = |anchor: &ComputerAnchor| -> Result<(f64, f64), ComputerError> {
            match anchor {
                ComputerAnchor::Pixel { point: p, .. } => point(*p),
                _ => element(anchor)
                    .and_then(|e| e.frame)
                    .map(|f| (bounds.x + f.x + f.w / 2., bounds.y + f.y + f.h / 2.))
                    .ok_or_else(|| {
                        error(
                            ComputerErrorCode::Unsupported,
                            "The element has no input geometry",
                        )
                    }),
            }
        };
        let aim = |anchor: &ComputerAnchor, press| -> Result<(), ComputerError> {
            let (x, y) = location(anchor)?;
            cancellation.wait(Duration::ZERO)?;
            ffi::send_pointer(x, y, press)
                .map_err(|message| error(ComputerErrorCode::Failed, message))
        };
        let foreground = action.delivery == ComputerDelivery::Foreground;
        let result = match action.input {
            ComputerInput::Click {
                anchor,
                button,
                count,
            } => {
                let button = bridge::mouse_button(button);
                if !foreground {
                    let target = element(&anchor)
                        .filter(|_| button == native::MouseButton::Left && u8::from(count) == 1);
                    let Some(target) = target else {
                        return Err(error(
                            ComputerErrorCode::Unsupported,
                            "Background Windows input requires a single left click on a UIA element",
                        ));
                    };
                    uia::invoke_background(app, target)
                        .map_err(|message| error(ComputerErrorCode::Failed, message))?;
                    return Ok(None);
                } else {
                    self.driver.click(
                        app,
                        None,
                        native::ClickRequest {
                            method: native::ClickMethod::Global,
                            point: Some(location(&anchor)?),
                            button,
                            count: count.into(),
                        },
                    )
                }
            }
            ComputerInput::Move { anchor } => {
                aim(&anchor, None)?;
                return Ok(None);
            }
            ComputerInput::Hover { anchor, dwell_ms } => {
                aim(&anchor, None)?;
                cancellation.wait(dwell_ms.duration())?;
                return Ok(None);
            }
            ComputerInput::Hold {
                anchor,
                button,
                hold_ms,
            } => {
                aim(&anchor, Some(bridge::mouse_button(button)))?;
                let held = cancellation.wait(hold_ms.duration());
                ffi::release_tracked()
                    .map_err(|message| error(ComputerErrorCode::Failed, message))?;
                held?;
                return Ok(None);
            }
            ComputerInput::FocusWindow {}
            | ComputerInput::SetValue { .. }
            | ComputerInput::SelectText { .. }
            | ComputerInput::Paste { .. }
            | ComputerInput::PerformAction { .. } => {
                return Err(error(
                    ComputerErrorCode::Unsupported,
                    "This input is not implemented on this platform",
                ));
            }
            ComputerInput::Drag { from, to, .. } => self.driver.drag(
                app,
                native::DragRequest {
                    method: native::ClickMethod::Global,
                    start: point(from)?,
                    end: point(to)?,
                    ..Default::default()
                },
            ),
            ComputerInput::TypeText { anchor, text } => {
                let target = element(&anchor).ok_or_else(|| {
                    error(
                        ComputerErrorCode::Unsupported,
                        "Windows typing requires an observed focused UIA element",
                    )
                })?;
                self.driver.type_text(app, Some(target), text.as_str())
            }
            ComputerInput::PressKey { anchor, keys } => {
                let target = element(&anchor).ok_or_else(|| {
                    error(
                        ComputerErrorCode::Unsupported,
                        "Windows keys require an observed focused UIA element",
                    )
                })?;
                let key = keys
                    .keys()
                    .iter()
                    .map(|k| match k.as_str() {
                        "ArrowLeft" => "left",
                        "ArrowRight" => "right",
                        "ArrowUp" => "up",
                        "ArrowDown" => "down",
                        other => other,
                    })
                    .collect::<Vec<_>>()
                    .join("+")
                    .to_ascii_lowercase();
                self.driver.press_key(app, Some(target), &key)
            }
            ComputerInput::Scroll {
                anchor,
                delta_x,
                delta_y,
            } => {
                let (x, y) = location(&anchor)?;
                if !apps::pid_owns_point(app.pid, x, y) {
                    return Err(error(
                        ComputerErrorCode::TargetUnavailable,
                        "Expose this window before foreground scrolling",
                    ));
                }
                // Wheel-based platforms quantize logical pixels to 120-pixel notches.
                let notches =
                    |delta: i32| delta.signum() * delta.unsigned_abs().div_ceil(120) as i32;
                ffi::send_mouse_wheel(x, y, notches(delta_x), -notches(delta_y))
                    .map_err(|message| error(ComputerErrorCode::Failed, message))?;
                return Ok(None);
            }
        };
        if result.ok {
            Ok(None)
        } else {
            Err(error(ComputerErrorCode::Failed, result.text))
        }
    }
}
