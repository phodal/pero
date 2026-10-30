//! Native action dispatch against retained observation handles, never a reindexed tree.
use crate::{
    bridge,
    observation::{self, Snapshot},
    scroll,
    window_input::WindowInput,
};
use computer_core::Window;
use computer_runtime::error;
use pero_contracts::computer_use::*;
use point_computer_core::types::MouseButton;
use point_computer_macos::ffi;

pub fn execute(
    app: &Window,
    snapshot: &Snapshot,
    action: ComputerAction,
    cancellation: &computer_runtime::Cancellation,
) -> Result<Option<ComputerExecution>, ComputerError> {
    cancellation.wait(std::time::Duration::ZERO)?;
    let mut execution = ComputerExecution {
        route: if action.delivery == ComputerDelivery::Foreground {
            ComputerExecutionRoute::ForegroundEvent
        } else {
            ComputerExecutionRoute::WindowEvent
        },
        semantic_action: None,
    };
    let result = (|| {
        let control = |id: &ComputerRef| {
            let control = snapshot.control(id)?;
            if !observation::belongs(&control.handle, app)
                || ffi::ax_str(&control.handle, "AXRole") != control.public.role
            {
                return Err(error(
                    ComputerErrorCode::StaleObservation,
                    "The observed control no longer belongs to this window",
                ));
            }
            if !ffi::ax_bool(&control.handle, "AXEnabled", true)
                || ffi::ax_str(&control.handle, "AXSubrole") == "AXSecureTextField"
            {
                return Err(error(
                    ComputerErrorCode::Unsupported,
                    "This control is disabled or secure",
                ));
            }
            Ok(control)
        };
        // Value replacement and explicit AX actions need neither geometry nor keyboard focus.
        match &action.input {
            ComputerInput::FocusWindow {} => {
                crate::applications::activate(app.pid)?;
                execution.route = ComputerExecutionRoute::Semantic;
                return ax_result(ffi::ax_perform(&snapshot.window, "AXRaise"));
            }
            ComputerInput::SetValue { element_id, value } => {
                let control = control(element_id)?;
                if !ffi::ax_is_settable(&control.handle, "AXValue") {
                    return Err(error(
                        ComputerErrorCode::Unsupported,
                        "This control's value is read-only",
                    ));
                }
                execution.route = ComputerExecutionRoute::Semantic;
                return ax_result(ffi::ax_set_str(&control.handle, "AXValue", value.as_str()));
            }
            ComputerInput::PerformAction { element_id, action } => {
                let control = control(element_id)?;
                let name = observation::semantic_name(*action);
                if !ffi::ax_actions(&control.handle, 32)
                    .iter()
                    .any(|a| a == name)
                {
                    return Err(error(
                        ComputerErrorCode::StaleObservation,
                        "This semantic action is no longer available",
                    ));
                }
                execution.route = ComputerExecutionRoute::Semantic;
                execution.semantic_action = Some(*action);
                return ax_result(ffi::ax_perform(&control.handle, name));
            }
            _ => {}
        }
        let native = bridge::native_window(app);
        let window = WindowInput::new(&native, snapshot.bounds.as_ref())?;
        let point = |p: ComputerPoint| -> (f64, f64) {
            (
                window.bounds.x + f64::from(p.x) * window.bounds.w / f64::from(snapshot.width),
                window.bounds.y + f64::from(p.y) * window.bounds.h / f64::from(snapshot.height),
            )
        };
        let location = |anchor: &ComputerAnchor| -> Result<(f64, f64), ComputerError> {
            match anchor {
                ComputerAnchor::Pixel { point: p, .. } => Ok(point(*p)),
                ComputerAnchor::Element { element_id } => {
                    let control = control(element_id)?;
                    let frame = ffi::ax_frame(&control.handle).ok_or_else(|| {
                        error(
                            ComputerErrorCode::Unsupported,
                            "This control has no input geometry",
                        )
                    })?;
                    let old = control.frame.ok_or_else(|| {
                        error(
                            ComputerErrorCode::StaleObservation,
                            "Observe this control's geometry first",
                        )
                    })?;
                    if frame != (old.x, old.y, old.w, old.h) {
                        return Err(error(
                            ComputerErrorCode::StaleObservation,
                            "The control moved or resized; observe again",
                        ));
                    }
                    Ok((frame.0 + frame.2 / 2., frame.1 + frame.3 / 2.))
                }
            }
        };
        match action.input {
            ComputerInput::Click {
                anchor,
                button,
                count,
            } => {
                let button = match button {
                    ComputerMouseButton::Left => MouseButton::Left,
                    ComputerMouseButton::Right => MouseButton::Right,
                    ComputerMouseButton::Middle => MouseButton::Middle,
                };
                if action.delivery == ComputerDelivery::Background
                    && u8::from(count) == 1
                    && let ComputerAnchor::Element { element_id } = &anchor
                {
                    let control = control(element_id)?;
                    // A middle-button input always retains physical mouse semantics.
                    let name = match button {
                        MouseButton::Left => Some("AXPress"),
                        MouseButton::Right => Some("AXShowMenu"),
                        MouseButton::Middle => None,
                    };
                    if let Some(name) = name.filter(|name| {
                        ffi::ax_actions(&control.handle, 32)
                            .iter()
                            .any(|a| a == name)
                    }) {
                        execution.route = ComputerExecutionRoute::Semantic;
                        execution.semantic_action = Some(if name == "AXPress" {
                            ComputerSemanticAction::Press
                        } else {
                            ComputerSemanticAction::ShowMenu
                        });
                        return ax_result(ffi::ax_perform(&control.handle, name));
                    }
                }
                let location = location(&anchor)?;
                if action.delivery == ComputerDelivery::Foreground {
                    window.foreground_click(location, button, count.into())
                } else {
                    window.click(location, button, count.into())
                }
            }
            ComputerInput::TypeText { anchor, text } => {
                match anchor {
                    ComputerAnchor::Element { element_id } => {
                        ax_result(ffi::ax_set_true(&control(&element_id)?.handle, "AXFocused"))?;
                    }
                    ComputerAnchor::Pixel { point: p, .. } => {
                        window.click(point(p), MouseButton::Left, 1)?
                    }
                }
                window.text(text.as_str())
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
                    .join("+")
                    .to_ascii_lowercase();
                let (code, flags) =
                    point_computer_core::keymap::parse_key(&key).map_err(|failure| {
                        error(ComputerErrorCode::Unsupported, failure.to_string())
                    })?;
                match anchor {
                    ComputerAnchor::Element { element_id } => {
                        ax_result(ffi::ax_set_true(&control(&element_id)?.handle, "AXFocused"))?;
                    }
                    ComputerAnchor::Pixel { point: p, .. } => {
                        window.click(point(p), MouseButton::Left, 1)?
                    }
                }
                window.key(code, flags)
            }
            ComputerInput::Scroll {
                anchor,
                delta_x,
                delta_y,
            } => scroll::pixels(&window, location(&anchor)?, delta_x, delta_y),
            ComputerInput::Drag { from, to, .. } => {
                window.drag(point(from), point(to), action.delivery, cancellation)
            }
            ComputerInput::Hold {
                anchor,
                button,
                hold_ms,
            } => {
                let button = match button {
                    ComputerMouseButton::Left => MouseButton::Left,
                    ComputerMouseButton::Right => MouseButton::Right,
                    ComputerMouseButton::Middle => MouseButton::Middle,
                };
                window.hold(
                    location(&anchor)?,
                    button,
                    u16::from(hold_ms),
                    action.delivery,
                    cancellation,
                )
            }
            ComputerInput::FocusWindow {} => unreachable!("focus dispatched before geometry"),
            ComputerInput::Move { anchor } => window.move_to(location(&anchor)?, action.delivery),
            ComputerInput::Hover { anchor, dwell_ms } => {
                window.move_to(location(&anchor)?, action.delivery)?;
                cancellation.wait(dwell_ms.duration())
            }
            ComputerInput::SetValue { .. } | ComputerInput::PerformAction { .. } => {
                unreachable!("semantic inputs dispatched before geometry")
            }
        }
    })();
    result.map(|()| Some(execution))
}
fn ax_result(code: i32) -> Result<(), ComputerError> {
    if code == ffi::AX_ERR_SUCCESS {
        Ok(())
    } else {
        Err(error(
            ComputerErrorCode::Failed,
            format!("The application rejected this accessibility operation (AX {code})"),
        ))
    }
}
