//! Windows UIA, WGC/PrintWindow and explicit foreground input.
use crate::{bridge, profile};
use computer_core::{Window, WindowBounds};
use computer_runtime::{DesktopDriver, WindowObservation, error};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_backend::backend::{ComputerUseBackend, LaunchPermit};
use point_computer_core::types as native;
use point_computer_windows::{apps, driver::WindowsBackend, ffi};

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
        ComputerDriverStatus{environment:Some(self.environment()),available:true,accessibility:ComputerPermissionState::Unsupported,screen_recording:ComputerPermissionState::Unsupported,message:"Windows UIA and window capture; no macOS permission grants apply. Use foreground for keyboard/pixel input; background supports UIA invocation only. Interactive desktop and integrity checks occur per action.".into()}
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
        let result = self.driver.snapshot(
            app,
            native::SnapshotRequest {
                want_image: true,
                image_max_px: 1600,
                ..Default::default()
            },
        );
        result
            .snapshot
            .filter(|_| result.ok)
            .map(bridge::observation)
            .ok_or_else(|| error(ComputerErrorCode::PermissionRequired, result.text))
    }
    fn input(
        &self,
        app: &Window,
        snap: &native::Snapshot,
        action: ComputerAction,
    ) -> Result<(), ComputerError> {
        let app = &bridge::native_window(app);
        let bounds = snap.window_bounds.ok_or_else(|| {
            error(
                ComputerErrorCode::Unsupported,
                "Window input geometry is unavailable",
            )
        })?;
        let point = |p: ComputerPoint| {
            (
                bounds.x + f64::from(p.x) * bounds.w / f64::from(snap.image_width),
                bounds.y + f64::from(p.y) * bounds.h / f64::from(snap.image_height),
            )
        };
        let element = |anchor: &ComputerAnchor| {
            let ComputerAnchor::Element { element_id } = anchor else {
                return None;
            };
            snap.elements
                .iter()
                .find(|e| element_id.as_str() == format!("element-{}", e.index))
        };
        let location = |anchor: &ComputerAnchor| -> Result<(f64, f64), ComputerError> {
            match anchor {
                ComputerAnchor::Pixel { point: p, .. } => Ok(point(*p)),
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
        let foreground = action.delivery == ComputerDelivery::Foreground;
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
                if !foreground {
                    if u8::from(count) != 1 || element(&anchor).is_none() {
                        return Err(error(
                            ComputerErrorCode::Unsupported,
                            "Background Windows input requires a single UIA element invocation",
                        ));
                    }
                    self.driver.click(
                        app,
                        element(&anchor),
                        native::ClickRequest {
                            method: native::ClickMethod::Accessibility,
                            point: None,
                            button,
                            count: 1,
                        },
                    )
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
            ComputerInput::Drag { from, to, .. } => self.driver.drag(
                app,
                native::DragRequest {
                    method: native::ClickMethod::Global,
                    start: point(from),
                    end: point(to),
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
