//! Window-scoped AX identities with observation-local input admission.
use crate::{bridge, capture};
use computer_core::{ControlId, Window, WindowImage};
use computer_runtime::{WindowObservation, error};
use pero_contracts::computer_use::*;
use point_computer_core::types::Frame;
use point_computer_macos::ffi::{self, CfRef};
use std::{
    collections::HashMap,
    hash::{Hash, Hasher},
    num::NonZeroU32,
    time::{Duration, Instant},
};

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFEqual(a: *const std::ffi::c_void, b: *const std::ffi::c_void) -> bool;
    fn CFHash(value: *const std::ffi::c_void) -> usize;
    fn CFGetTypeID(a: *const std::ffi::c_void) -> usize;
}
struct ElementIdentity(CfRef);
impl PartialEq for ElementIdentity {
    fn eq(&self, other: &Self) -> bool {
        unsafe { CFEqual(self.0.as_ptr(), other.0.as_ptr()) }
    }
}
impl Eq for ElementIdentity {}
impl Hash for ElementIdentity {
    fn hash<H: Hasher>(&self, state: &mut H) {
        unsafe { CFHash(self.0.as_ptr()) }.hash(state);
    }
}

#[derive(Default)]
pub struct ElementIds {
    next: u32,
    windows: HashMap<(i32, u32), HashMap<ElementIdentity, ControlId>>,
}
impl ElementIds {
    pub fn retain_windows(&mut self, windows: &[Window]) {
        self.windows.retain(|&(pid, id), _| {
            windows
                .iter()
                .any(|window| window.pid == pid && window.window_id == id)
        });
    }
}

const NATIVE_MAX_NODES: usize = 4096;
const NATIVE_MAX_DEPTH: u16 = 64;

#[derive(Default)]
struct AxScan {
    incomplete: bool,
    secure: bool,
}
impl AxScan {
    fn add_children(
        &mut self,
        read: Result<Option<ffi::AxElementList>, ffi::AxReadError>,
        children: &mut Vec<CfRef>,
    ) {
        match read {
            Ok(Some(list)) => {
                self.incomplete |= !list.complete;
                children.extend(list.elements);
            }
            Ok(None) => {}
            Err(_) => self.incomplete = true,
        }
    }

    fn allows_pixels(&self) -> bool {
        !self.incomplete && !self.secure
    }
}

fn project_tree(
    nodes: impl IntoIterator<Item = ComputerElement>,
    options: &ComputerObserveOptions,
) -> (Vec<ComputerElement>, bool) {
    let mut projected = Vec::new();
    let mut truncated = false;
    let mut depths = [0; NATIVE_MAX_DEPTH as usize + 2];
    for mut node in nodes {
        let raw_depth = usize::from(node.depth);
        let depth = depths[raw_depth];
        let wrapper = !options.include_containers
            && raw_depth != 0
            && matches!(node.role.as_str(), "AXGroup" | "AXGenericElement")
            && node.label.trim().is_empty()
            && node
                .value
                .as_ref()
                .is_none_or(|value| value.trim().is_empty())
            && node.semantic_actions.iter().all(|action| {
                matches!(
                    action,
                    ComputerSemanticAction::ShowMenu | ComputerSemanticAction::ScrollToVisible
                )
            })
            && node.state.as_ref().is_none_or(|state| {
                !state.focused
                    && !state.secure
                    && !state.value_settable
                    && state.selected != Some(true)
                    && state.expanded != Some(true)
            });
        depths[raw_depth + 1] = depth + u16::from(!wrapper);
        if wrapper {
            continue;
        }
        if depth > u16::from(options.max_depth) {
            truncated = true;
            continue;
        }
        if projected.len() == usize::from(u16::from(options.max_nodes)) {
            truncated = true;
            break;
        }
        node.depth = depth;
        projected.push(node);
    }
    (projected, truncated)
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
    ids: &mut ElementIds,
) -> Result<WindowObservation<Snapshot>, ComputerError> {
    let app = ffi::ax_app_element(window.pid).ok_or_else(|| {
        error(
            ComputerErrorCode::TargetUnavailable,
            "Cannot connect to the selected application",
        )
    })?;
    // Electron exposes its content tree only after this explicit AX opt-in.
    ffi::ax_set_true(&app, "AXManualAccessibility");
    let windows = ffi::ax_element_list(&app, "AXWindows", 128)
        .map_err(|failure| {
            error(
                ComputerErrorCode::Failed,
                format!("Unable to read macOS AX windows: {failure:?}"),
            )
        })?
        .map(|list| list.elements)
        .unwrap_or_default();
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
    let previous = ids
        .windows
        .entry((window.pid, window.window_id))
        .or_default();
    let mut seen = HashMap::new();
    let mut controls: Vec<Control> = Vec::new();
    let mut scan = AxScan::default();
    let start = Instant::now();
    while let Some((element, depth)) = stack.pop() {
        let identity = ElementIdentity(element.retain());
        if seen.contains_key(&identity) {
            continue;
        }
        if controls.len() >= NATIVE_MAX_NODES || start.elapsed() > Duration::from_secs(10) {
            scan.incomplete = true;
            break;
        }
        ffi::ax_set_messaging_timeout(&element);
        let role = ffi::ax_optional_string(&element, "AXRole");
        let subrole = ffi::ax_optional_string(&element, "AXSubrole");
        let (Ok(Some(role)), Ok(subrole)) = (role, subrole) else {
            scan.incomplete = true;
            continue;
        };
        if role.is_empty() {
            scan.incomplete = true;
            continue;
        }
        let secure = role.contains("Secure") || subrole.as_deref() == Some("AXSecureTextField");
        scan.secure |= secure;
        let control_id = previous.get(&identity).copied().unwrap_or_else(|| {
            ids.next += 1;
            ControlId(ids.next)
        });
        seen.insert(identity, control_id);
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
            id: control_id.reference(),
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
        let attrs: &[_] = if matches!(
            role.as_str(),
            "AXTable" | "AXOutline" | "AXList" | "AXBrowser"
        ) {
            &["AXRows", "AXVisibleChildren", "AXChildren"]
        } else if role == "AXScrollArea" {
            // AppKit scroll areas describe their document view separately from scrollbars.
            &["AXContents", "AXChildren", "AXVisibleChildren", "AXRows"]
        } else {
            &["AXChildren", "AXVisibleChildren", "AXRows"]
        };
        for attr in attrs {
            scan.add_children(ffi::ax_element_list(&element, attr, 512), &mut children);
        }
        if depth >= NATIVE_MAX_DEPTH && !children.is_empty() {
            scan.incomplete = true;
        } else {
            stack.extend(children.into_iter().rev().map(|child| (child, depth + 1)));
        }
        controls.push(Control {
            handle: element,
            public,
            frame,
        });
    }
    if options.root.is_none() && !scan.incomplete {
        *previous = seen;
    } else {
        for (identity, id) in seen {
            if previous.len() >= NATIVE_MAX_NODES {
                break;
            }
            previous.entry(identity).or_insert(id);
        }
    }
    // A subtree cannot establish that the rest of the window is free of secure fields.
    let image = if options.want_image
        && options.root.is_none()
        && scan.allows_pixels()
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
    let (elements, projection_truncated) =
        project_tree(snapshot.controls.iter().map(|c| c.public.clone()), options);
    Ok(WindowObservation {
        elements,
        bounds: bounds.map(bridge::bounds),
        image,
        truncated: scan.incomplete || projection_truncated,
        source: snapshot,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screenshot_admission_distinguishes_empty_children_from_incomplete_reads() {
        for (read, allowed) in [
            (Ok(None), true),
            (
                Ok(Some(ffi::AxElementList {
                    elements: vec![],
                    complete: true,
                })),
                true,
            ),
            (
                Ok(Some(ffi::AxElementList {
                    elements: vec![],
                    complete: false,
                })),
                false,
            ),
            (
                Err(ffi::AxReadError::Native(ffi::AX_ERR_CANNOT_COMPLETE)),
                false,
            ),
            (Err(ffi::AxReadError::InvalidType), false),
        ] {
            let mut scan = AxScan::default();
            let mut children = Vec::new();
            scan.add_children(read, &mut children);
            scan.add_children(Ok(None), &mut children);
            assert_eq!(scan.allows_pixels(), allowed);
        }
    }
}
