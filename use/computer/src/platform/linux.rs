//! Linux X11 window capture and explicit foreground XTest input.
//! Like Cua's native dispatch, Wayland is a separate backend, never an X11 fallback.
use crate::runtime::error;
use image::{ExtendedColorType, codecs::jpeg::JpegEncoder};
use pero_contracts::{computer_runtime::*, computer_use::*};
use point_computer_core::types as native;
use std::{fs, path::PathBuf, process::Command};
use x11rb::{
    CURRENT_TIME,
    connection::Connection,
    protocol::{xproto::*, xtest::ConnectionExt as _},
    rust_connection::RustConnection,
};

pub struct Desktop {
    connection: Option<(RustConnection, usize)>,
    reason: String,
}
fn failure(e: impl std::fmt::Display) -> ComputerError {
    error(ComputerErrorCode::Failed, e.to_string())
}
impl Desktop {
    pub fn new() -> Self {
        match x11rb::connect(None) {
            Ok(connection) => Self {
                connection: Some(connection),
                reason: String::new(),
            },
            Err(e) => Self {
                connection: None,
                reason: format!(
                    "X11 connection unavailable: {e}. Pure Wayland requires a compositor/portal backend and is not supported by this driver."
                ),
            },
        }
    }
    fn x(&self) -> Result<(&RustConnection, &Screen), ComputerError> {
        let (c, s) = self
            .connection
            .as_ref()
            .ok_or_else(|| error(ComputerErrorCode::Unsupported, &self.reason))?;
        Ok((c, &c.setup().roots[*s]))
    }
    pub fn observations(&self) -> Vec<ComputerObservationKind> {
        vec![ComputerObservationKind::Screenshot]
    }
    pub fn actions(&self) -> Vec<ComputerActionSupport> {
        use ComputerActionKind::*;
        [Click, TypeText, PressKey, Scroll, Drag]
            .into_iter()
            .map(|action| ComputerActionSupport {
                action,
                delivery: ComputerDelivery::Foreground,
            })
            .collect()
    }
    pub fn status(&self) -> ComputerDriverStatus {
        ComputerDriverStatus {
            available: self.connection.is_some(),
            accessibility: ComputerPermissionState::Unsupported,
            screen_recording: ComputerPermissionState::Unsupported,
            message: if self.connection.is_none() {
                self.reason.clone()
            } else {
                "Linux X11 pixel observation and foreground XTest input. No accessibility tree or background input is advertised. Text must be mapped in the current keyboard layout; scrolling uses wheel notches.".into()
            },
        }
    }
    fn property(&self, window: u32, name: &str) -> Result<GetPropertyReply, ComputerError> {
        let (c, _) = self.x()?;
        let atom = c
            .intern_atom(false, name.as_bytes())
            .map_err(failure)?
            .reply()
            .map_err(failure)?
            .atom;
        c.get_property(false, window, atom, AtomEnum::ANY, 0, 16_384)
            .map_err(failure)?
            .reply()
            .map_err(failure)
    }
    pub fn targets(&self) -> Result<Vec<native::AppRef>, ComputerError> {
        let (c, screen) = self.x()?;
        let mut windows = self
            .property(screen.root, "_NET_CLIENT_LIST")?
            .value32()
            .map(|v| v.collect::<Vec<_>>())
            .unwrap_or_default();
        if windows.is_empty() {
            windows = c
                .query_tree(screen.root)
                .map_err(failure)?
                .reply()
                .map_err(failure)?
                .children;
        }
        let mut apps = Vec::new();
        for id in windows {
            let Ok(attrs) = c.get_window_attributes(id).map_err(failure)?.reply() else {
                continue;
            };
            if attrs.map_state != MapState::VIEWABLE || attrs.override_redirect {
                continue;
            }
            let pid = self
                .property(id, "_NET_WM_PID")
                .ok()
                .and_then(|p| p.value32().and_then(|mut v| v.next()))
                .unwrap_or(0);
            if pid == 0 || pid > i32::MAX as u32 {
                continue;
            }
            let class = self.property(id, "WM_CLASS")?.value;
            let name = String::from_utf8_lossy(&class)
                .split('\0')
                .find(|s| !s.is_empty())
                .unwrap_or("X11 application")
                .to_string();
            let mut title = self.property(id, "_NET_WM_NAME")?.value;
            if title.is_empty() {
                title = self.property(id, "WM_NAME")?.value;
            }
            apps.push(native::AppRef {
                name: name.clone(),
                bundle_id: name,
                pid: pid as i32,
                window_id: id,
                window_title: String::from_utf8_lossy(&title).into_owned(),
            });
        }
        Ok(apps)
    }
    pub fn open(&self, name: &str) -> Result<(Option<native::AppRef>, String), ComputerError> {
        if let Some(app) = self
            .targets()?
            .into_iter()
            .find(|a| a.name.eq_ignore_ascii_case(name))
        {
            return Ok((Some(app), "Application already running".into()));
        }
        let mut directories = vec![
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
        ];
        if let Some(home) = std::env::var_os("XDG_DATA_HOME") {
            directories.push(PathBuf::from(home).join("applications"));
        } else if let Some(home) = std::env::var_os("HOME") {
            directories.push(PathBuf::from(home).join(".local/share/applications"));
        }
        let mut matches = Vec::new();
        for dir in directories {
            let Ok(entries) = fs::read_dir(dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_none_or(|e| e != "desktop") {
                    continue;
                }
                let Ok(text) = fs::read_to_string(&path) else {
                    continue;
                };
                let mut section = false;
                let mut label = None;
                let mut hidden = false;
                for line in text.lines() {
                    if line.starts_with('[') {
                        section = line == "[Desktop Entry]";
                    }
                    if section {
                        if let Some(value) = line.strip_prefix("Name=") {
                            label = Some(value);
                        }
                        if line == "Hidden=true" {
                            hidden = true;
                        }
                    }
                }
                if !hidden && label.is_some_and(|n| n.eq_ignore_ascii_case(name)) {
                    matches.push(path);
                }
            }
        }
        if matches.len() != 1 {
            return Err(error(
                ComputerErrorCode::TargetUnavailable,
                "Name must identify exactly one installed desktop application",
            ));
        }
        let child = Command::new("gio")
            .arg("launch")
            .arg(&matches[0])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(failure)?;
        // Reap the short-lived launcher; its exit cannot establish a window.
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
        Ok((
            None,
            "Launch requested; list targets to find the application's window".into(),
        ))
    }
    fn geometry(&self, app: &native::AppRef) -> Result<native::Frame, ComputerError> {
        let (c, screen) = self.x()?;
        let g = c
            .get_geometry(app.window_id)
            .map_err(failure)?
            .reply()
            .map_err(failure)?;
        let p = c
            .translate_coordinates(app.window_id, screen.root, 0, 0)
            .map_err(failure)?
            .reply()
            .map_err(failure)?;
        Ok(native::Frame {
            x: p.dst_x.into(),
            y: p.dst_y.into(),
            w: g.width.into(),
            h: g.height.into(),
        })
    }
    pub fn bounds(&self, app: &native::AppRef) -> Option<native::Frame> {
        self.geometry(app).ok()
    }
    pub fn observe(&self, app: &native::AppRef) -> Result<native::Snapshot, ComputerError> {
        let (c, screen) = self.x()?;
        let bounds = self.geometry(app)?;
        let (w, h) = (bounds.w as u16, bounds.h as u16);
        if u32::from(w) * u32::from(h) > 8_388_608 || w == 0 || h == 0 {
            return Err(error(
                ComputerErrorCode::Unsupported,
                "Window exceeds the image budget",
            ));
        }
        let image = c
            .get_image(ImageFormat::Z_PIXMAP, app.window_id, 0, 0, w, h, u32::MAX)
            .map_err(failure)?
            .reply()
            .map_err(failure)?;
        let format = c
            .setup()
            .pixmap_formats
            .iter()
            .find(|f| f.depth == image.depth)
            .ok_or_else(|| error(ComputerErrorCode::Unsupported, "Unknown X11 image format"))?;
        let visual = screen
            .allowed_depths
            .iter()
            .flat_map(|d| &d.visuals)
            .find(|v| v.visual_id == image.visual)
            .ok_or_else(|| error(ComputerErrorCode::Unsupported, "Unknown X11 visual"))?;
        let bytes = usize::from(format.bits_per_pixel / 8);
        if !(3..=4).contains(&bytes) {
            return Err(error(
                ComputerErrorCode::Unsupported,
                "X11 capture requires a 24/32-bit true-color visual",
            ));
        }
        let stride = (usize::from(w) * usize::from(format.bits_per_pixel))
            .div_ceil(usize::from(format.scanline_pad))
            * usize::from(format.scanline_pad)
            / 8;
        if image.data.len() < stride * usize::from(h) {
            return Err(error(ComputerErrorCode::Failed, "Incomplete X11 image"));
        }
        let mut rgb = Vec::with_capacity(usize::from(w) * usize::from(h) * 3);
        for y in 0..usize::from(h) {
            for x in 0..usize::from(w) {
                let start = y * stride + x * bytes;
                let mut raw = [0u8; 4];
                let value = if c.setup().image_byte_order == ImageOrder::LSB_FIRST {
                    raw[..bytes].copy_from_slice(&image.data[start..start + bytes]);
                    u32::from_le_bytes(raw)
                } else {
                    raw[4 - bytes..].copy_from_slice(&image.data[start..start + bytes]);
                    u32::from_be_bytes(raw)
                };
                for mask in [visual.red_mask, visual.green_mask, visual.blue_mask] {
                    if mask == 0 {
                        return Err(error(
                            ComputerErrorCode::Unsupported,
                            "Indexed-color visuals are unsupported",
                        ));
                    }
                    let shift = mask.trailing_zeros();
                    rgb.push((((value & mask) >> shift) * 255 / (mask >> shift)) as u8);
                }
            }
        }
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 80)
            .encode(&rgb, w.into(), h.into(), ExtendedColorType::Rgb8)
            .map_err(failure)?;
        Ok(native::Snapshot {
            app: app.clone(),
            window_title: app.window_title.clone(),
            window_bounds: Some(bounds),
            image_jpeg: jpeg,
            image_width: w.into(),
            image_height: h.into(),
            ..Default::default()
        })
    }
    fn related(&self, mut child: u32, parent: u32) -> Result<bool, ComputerError> {
        let (c, _) = self.x()?;
        if parent == 0 {
            return Ok(false);
        }
        for _ in 0..32 {
            if child == parent {
                return Ok(true);
            }
            if child == 0 {
                break;
            }
            let tree = c
                .query_tree(child)
                .map_err(failure)?
                .reply()
                .map_err(failure)?;
            if tree.parent == child {
                break;
            }
            child = tree.parent;
        }
        Ok(false)
    }
    pub fn input(
        &self,
        app: &native::AppRef,
        snap: &native::Snapshot,
        action: ComputerAction,
    ) -> Result<(), ComputerError> {
        let (c, screen) = self.x()?;
        let bounds = snap.window_bounds.ok_or_else(|| {
            error(
                ComputerErrorCode::StaleObservation,
                "Window geometry unavailable",
            )
        })?;
        let point = |p: ComputerPoint| {
            (
                (bounds.x + f64::from(p.x) * bounds.w / f64::from(snap.image_width)) as i16,
                (bounds.y + f64::from(p.y) * bounds.h / f64::from(snap.image_height)) as i16,
            )
        };
        let anchor = |a: &ComputerAnchor| -> Result<(i16, i16), ComputerError> {
            match a {
                ComputerAnchor::Pixel { point: p, .. } => Ok(point(*p)),
                _ => Err(error(
                    ComputerErrorCode::Unsupported,
                    "X11 has pixel anchors only",
                )),
            }
        };
        let fake = |kind: u8, detail: u8, x: i16, y: i16| -> Result<(), ComputerError> {
            c.xtest_fake_input(kind, detail, CURRENT_TIME, screen.root, x, y, 0)
                .map_err(failure)?
                .check()
                .map_err(failure)
        };
        let focus = || -> Result<(), ComputerError> {
            let focused = c
                .get_input_focus()
                .map_err(failure)?
                .reply()
                .map_err(failure)?
                .focus;
            if !self.related(focused, app.window_id)? {
                return Err(error(
                    ComputerErrorCode::TargetUnavailable,
                    "Focus the target window before keyboard input",
                ));
            }
            Ok(())
        };
        let aim = |(x, y): (i16, i16)| -> Result<(), ComputerError> {
            fake(MOTION_NOTIFY_EVENT, 0, x, y)?;
            let hit = c
                .query_pointer(screen.root)
                .map_err(failure)?
                .reply()
                .map_err(failure)?
                .child;
            if !self.related(hit, app.window_id)? && !self.related(app.window_id, hit)? {
                return Err(error(
                    ComputerErrorCode::TargetUnavailable,
                    "Expose the target window before foreground pointer input",
                ));
            }
            Ok(())
        };
        let click = |button: u8, count: u8| -> Result<(), ComputerError> {
            for _ in 0..count {
                fake(BUTTON_PRESS_EVENT, button, 0, 0)?;
                fake(BUTTON_RELEASE_EVENT, button, 0, 0)?;
            }
            Ok(())
        };
        let min = c.setup().min_keycode;
        let count = c.setup().max_keycode - min + 1;
        let mapping = c
            .get_keyboard_mapping(min, count)
            .map_err(failure)?
            .reply()
            .map_err(failure)?;
        let key = |symbol: u32| -> Result<(u8, bool), ComputerError> {
            mapping
                .keysyms
                .chunks(usize::from(mapping.keysyms_per_keycode))
                .enumerate()
                .find_map(|(i, keys)| {
                    keys.iter()
                        .take(2)
                        .position(|s| *s == symbol)
                        .map(|position| (min + i as u8, position == 1))
                })
                .ok_or_else(|| {
                    error(
                        ComputerErrorCode::Unsupported,
                        format!(
                            "Keysym {symbol:#x} is not mapped in the current X11 keyboard layout"
                        ),
                    )
                })
        };
        let emit = |code: u8, down: bool| {
            fake(
                if down {
                    KEY_PRESS_EVENT
                } else {
                    KEY_RELEASE_EVENT
                },
                code,
                0,
                0,
            )
        };
        match action.input {
            ComputerInput::Click {
                anchor: a,
                button,
                count,
            } => {
                aim(anchor(&a)?)?;
                click(
                    match button {
                        ComputerMouseButton::Left => 1,
                        ComputerMouseButton::Middle => 2,
                        ComputerMouseButton::Right => 3,
                    },
                    count.into(),
                )?;
            }
            ComputerInput::Drag { from, to, .. } => {
                let start = point(from);
                let end = point(to);
                aim(start)?;
                aim(end)?;
                aim(start)?;
                fake(BUTTON_PRESS_EVENT, 1, 0, 0)?;
                for step in 1..=12 {
                    let x =
                        i32::from(start.0) + (i32::from(end.0) - i32::from(start.0)) * step / 12;
                    let y =
                        i32::from(start.1) + (i32::from(end.1) - i32::from(start.1)) * step / 12;
                    fake(MOTION_NOTIFY_EVENT, 0, x as i16, y as i16)?;
                }
                fake(BUTTON_RELEASE_EVENT, 1, 0, 0)?;
            }
            ComputerInput::Scroll {
                anchor: a,
                delta_x,
                delta_y,
            } => {
                aim(anchor(&a)?)?;
                for (delta, positive, negative) in [(delta_y, 5, 4), (delta_x, 7, 6)] {
                    click(
                        if delta > 0 { positive } else { negative },
                        delta.unsigned_abs().div_ceil(120).min(255) as u8,
                    )?;
                }
            }
            ComputerInput::TypeText { anchor: a, text } => {
                let inputs = text
                    .as_str()
                    .chars()
                    .map(|ch| {
                        key(match ch {
                            '\n' => 0xff0d,
                            '\t' => 0xff09,
                            c if u32::from(c) <= 0xff => u32::from(c),
                            c => 0x0100_0000 | u32::from(c),
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                let shift = key(0xffe1)?.0;
                aim(anchor(&a)?)?;
                click(1, 1)?;
                focus()?;
                for (code, shifted) in inputs {
                    if shifted {
                        emit(shift, true)?;
                    }
                    emit(code, true)?;
                    emit(code, false)?;
                    if shifted {
                        emit(shift, false)?;
                    }
                }
            }
            ComputerInput::PressKey { anchor: a, keys } => {
                let inputs = keys
                    .keys()
                    .iter()
                    .map(|k| key(keysym(k.as_str())?))
                    .collect::<Result<Vec<_>, ComputerError>>()?;
                aim(anchor(&a)?)?;
                click(1, 1)?;
                focus()?;
                for (code, _) in &inputs {
                    emit(*code, true)?;
                }
                for (code, _) in inputs.iter().rev() {
                    emit(*code, false)?;
                }
            }
        }
        c.flush().map_err(failure)
    }
}
fn keysym(key: &str) -> Result<u32, ComputerError> {
    Ok(match key {
        "Meta" => 0xffeb,
        "Control" => 0xffe3,
        "Alt" => 0xffe9,
        "Shift" => 0xffe1,
        "Enter" => 0xff0d,
        "Tab" => 0xff09,
        "Escape" => 0xff1b,
        "Backspace" => 0xff08,
        "Delete" => 0xffff,
        "ArrowLeft" => 0xff51,
        "ArrowUp" => 0xff52,
        "ArrowRight" => 0xff53,
        "ArrowDown" => 0xff54,
        "Home" => 0xff50,
        "End" => 0xff57,
        "PageUp" => 0xff55,
        "PageDown" => 0xff56,
        "Space" => 0x20,
        s if s.chars().count() == 1 => u32::from(s.to_ascii_lowercase().chars().next().unwrap()),
        _ => {
            return Err(error(
                ComputerErrorCode::Unsupported,
                "Key is not supported by this X11 backend",
            ));
        }
    })
}
