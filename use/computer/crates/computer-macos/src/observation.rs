//! Observation-local native handles. Subtree walks produce a fresh identity space.
use crate::{bridge, capture};
use computer_core::{ControlId, Window, WindowImage};
use computer_runtime::{WindowObservation, error};
use pero_contracts::computer_use::*;
use point_computer_core::types::Frame;
use point_computer_macos::ffi::{self, CfRef};
use std::{
    num::NonZeroU32,
    time::{Duration, Instant},
};

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFEqual(a: *const std::ffi::c_void, b: *const std::ffi::c_void) -> bool;
    fn CFGetTypeID(a: *const std::ffi::c_void) -> usize;
}

pub struct Control {
    pub handle: CfRef,
    pub public: ComputerElement,
    pub frame: Option<Frame>,
}
pub struct Snapshot {
    pub controls: Vec<Control>,
    pub window: CfRef,
    pub bounds: Option<Frame>,
    pub width: u32,
    pub height: u32,
}
impl Snapshot {
    pub fn control(&self, id: &ComputerRef) -> Result<&Control, ComputerError> {
        self.controls
            .iter()
            .find(|c| &c.public.id == id)
            .ok_or_else(|| {
                error(
                    ComputerErrorCode::StaleObservation,
                    "The control is absent from this observation",
                )
            })
    }
}

pub fn semantic_name(action: ComputerSemanticAction) -> &'static str {
    use ComputerSemanticAction::*;
    match action {
        Press => "AXPress",
        Open => "AXOpen",
        Confirm => "AXConfirm",
        Cancel => "AXCancel",
        ShowMenu => "AXShowMenu",
        ScrollToVisible => "AXScrollToVisible",
        Increment => "AXIncrement",
        Decrement => "AXDecrement",
    }
}
const SEMANTIC_ACTIONS: [ComputerSemanticAction; 8] = {
    use ComputerSemanticAction::*;
    [
        Press,
        Open,
        Confirm,
        Cancel,
        ShowMenu,
        ScrollToVisible,
        Increment,
        Decrement,
    ]
};

pub fn window_of(element: &CfRef) -> Option<CfRef> {
    if ffi::ax_str(element, "AXRole") == "AXWindow" {
        return Some(element.retain());
    }
    ffi::ax_attr(element, "AXWindow")
        .ok()
        .flatten()
        .filter(|window| unsafe { CFGetTypeID(window.as_ptr()) == ffi::type_ids().ax_element })
}
pub fn belongs(element: &CfRef, window: &Window) -> bool {
    ffi::ax_pid(element) == Some(window.pid)
        && window_of(element).is_some_and(|w| ffi::ax_window_id(&w) == window.window_id)
}
pub fn bounds(window: &Window) -> Option<computer_core::WindowBounds> {
    let app = ffi::ax_app_element(window.pid)?;
    let native = ffi::ax_retained_elements(&app, "AXWindows", 128)
        .into_iter()
        .find(|w| ffi::ax_window_id(w) == window.window_id)?;
    let (x, y, w, h) = ffi::ax_frame(&native)?;
    Some(computer_core::WindowBounds { x, y, w, h })
}
pub fn observe(
    window: &Window,
    options: &ComputerObserveOptions,
    basis: Option<&Snapshot>,
) -> Result<WindowObservation<Snapshot>, ComputerError> {
    let app = ffi::ax_app_element(window.pid).ok_or_else(|| {
        error(
            ComputerErrorCode::TargetUnavailable,
            "Cannot connect to the selected application",
        )
    })?;
    // Electron exposes its content tree only after this explicit AX opt-in.
    ffi::ax_set_true(&app, "AXManualAccessibility");
    let windows = ffi::ax_retained_elements(&app, "AXWindows", 128);
    let withheld = windows.is_empty()
        || windows
            .iter()
            .all(|w| ffi::ax_str(w, "AXRole") == "AXApplication");
    let native_window = windows.into_iter().find(|w| ffi::ax_window_id(w) == window.window_id)
        .ok_or_else(|| if withheld {
            error(ComputerErrorCode::PermissionRequired, "macOS withheld accessible windows. Check Accessibility permission and reopen the application; preflight alone is advisory.")
        } else {
            error(ComputerErrorCode::Unsupported, "Cannot correlate the selected window with its native accessibility identity")
        })?;
    let bounds = ffi::ax_frame(&native_window).map(|(x, y, w, h)| Frame { x, y, w, h });
    let root = if let Some(root) = &options.root {
        let control = basis
            .ok_or_else(|| {
                error(
                    ComputerErrorCode::StaleObservation,
                    "The subtree observation expired",
                )
            })?
            .control(&root.element_id)?;
        if !belongs(&control.handle, window) {
            return Err(error(
                ComputerErrorCode::StaleObservation,
                "The subtree no longer belongs to the selected window",
            ));
        }
        control.handle.retain()
    } else {
        native_window.retain()
    };
    let mut text_remaining = 250_000usize;
    let mut text = |value: String| {
        let clipped: String = value.chars().take(text_remaining.min(2000)).collect();
        text_remaining -= clipped.chars().count();
        clipped
    };
    let mut stack = vec![(root, 0u16)];
    let mut controls: Vec<Control> = Vec::new();
    let mut truncated = false;
    let mut has_secure = false;
    let start = Instant::now();
    let max_nodes = usize::from(u16::from(options.max_nodes));
    let max_depth = u16::from(options.max_depth);
    while let Some((element, depth)) = stack.pop() {
        if controls.len() >= max_nodes || start.elapsed() > Duration::from_secs(10) {
            truncated = true;
            break;
        }
        if controls
            .iter()
            .any(|c| unsafe { CFEqual(c.handle.as_ptr(), element.as_ptr()) })
        {
            continue;
        }
        let role = ffi::ax_str(&element, "AXRole");
        let subrole = ffi::ax_str(&element, "AXSubrole");
        let secure = role.contains("Secure") || subrole == "AXSecureTextField";
        has_secure |= secure;
        let enabled = ffi::ax_bool(&element, "AXEnabled", true);
        let value_settable = !secure && enabled && ffi::ax_is_settable(&element, "AXValue");
        let native_actions = ffi::ax_actions(&element, 32);
        let semantic_actions: Vec<_> = SEMANTIC_ACTIONS
            .into_iter()
            .filter(|a| enabled && !secure && native_actions.iter().any(|s| s == semantic_name(*a)))
            .collect();
        let mut actions = Vec::new();
        let frame = ffi::ax_frame(&element).map(|(x, y, w, h)| Frame { x, y, w, h });
        if enabled && !secure {
            if frame.is_some() {
                actions.extend([
                    ComputerActionKind::Click,
                    ComputerActionKind::Move,
                    ComputerActionKind::Hover,
                    ComputerActionKind::Hold,
                ]);
            }
            if value_settable {
                actions.push(ComputerActionKind::SetValue);
            }
            if !semantic_actions.is_empty() {
                actions.push(ComputerActionKind::PerformAction);
            }
            if (value_settable
                || matches!(role.as_str(), "AXTextField" | "AXTextArea" | "AXComboBox"))
                && ffi::ax_is_settable(&element, "AXFocused")
            {
                actions.extend([ComputerActionKind::TypeText, ComputerActionKind::PressKey]);
            }
            if role.contains("Scroll") && frame.is_some() {
                actions.push(ComputerActionKind::Scroll);
            }
        }
        let label = ["AXTitle", "AXDescription", "AXHelp"]
            .into_iter()
            .map(|name| ffi::ax_str(&element, name))
            .find(|s| !s.is_empty())
            .unwrap_or_default();
        let public = ComputerElement {
            id: ControlId(controls.len() as u32 + 1).reference(),
            role: role.clone(),
            label: text(label),
            value: (!secure).then(|| text(ffi::ax_str(&element, "AXValue"))),
            depth,
            actions,
            state: Some(ComputerElementState {
                enabled,
                secure,
                focused: ffi::ax_bool(&element, "AXFocused", false),
                value_settable,
                selected: ffi::ax_bool_opt(&element, "AXSelected"),
                expanded: ffi::ax_bool_opt(&element, "AXExpanded"),
            }),
            semantic_actions,
        };
        let mut children: Vec<CfRef> = Vec::new();
        let attrs = if matches!(
            role.as_str(),
            "AXTable" | "AXOutline" | "AXList" | "AXBrowser"
        ) {
            ["AXRows", "AXVisibleChildren", "AXChildren"]
        } else {
            ["AXChildren", "AXVisibleChildren", "AXRows"]
        };
        for attr in attrs {
            let found = ffi::ax_retained_elements(&element, attr, 512);
            if found.len() == 512 {
                truncated = true;
            }
            for child in found {
                if !children
                    .iter()
                    .any(|other| unsafe { CFEqual(child.as_ptr(), other.as_ptr()) })
                {
                    children.push(child);
                }
            }
        }
        if depth >= max_depth && !children.is_empty() {
            truncated = true;
        } else {
            stack.extend(children.into_iter().rev().map(|child| (child, depth + 1)));
        }
        controls.push(Control {
            handle: element,
            public,
            frame,
        });
    }
    // A subtree cannot establish that the rest of the window is free of secure fields.
    let image = if options.want_image
        && options.root.is_none()
        && !has_secure
        && !truncated
        && ffi::preflight_screen_capture()
    {
        capture::window(window.window_id).and_then(|image| {
            Some(WindowImage {
                width: NonZeroU32::new(image.width)?,
                height: NonZeroU32::new(image.height)?,
                bytes: image.jpeg,
                media_type: ComputerImageType::Jpeg,
            })
        })
    } else {
        None
    };
    let snapshot = Snapshot {
        window: native_window,
        width: image.as_ref().map_or(0, |i| i.width.get()),
        height: image.as_ref().map_or(0, |i| i.height.get()),
        controls,
        bounds,
    };
    Ok(WindowObservation {
        elements: snapshot.controls.iter().map(|c| c.public.clone()).collect(),
        bounds: bounds.map(bridge::bounds),
        image,
        truncated,
        source: snapshot,
    })
}
