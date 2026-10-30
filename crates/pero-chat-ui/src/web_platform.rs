//! Browser font and editing conventions shared by embedded GPUI surfaces.
use gpui_kit::{component::input::*, *};
use std::borrow::Cow;

pub fn initialize(cx: &mut App) {
    cx.text_system()
        .add_fonts(vec![
            Cow::Borrowed(include_bytes!("../../../web/public/fonts/Inter-Regular.ttf").as_slice()),
            Cow::Borrowed(
                include_bytes!("../../../web/public/fonts/Workbench-regular.ttf").as_slice(),
            ),
            Cow::Borrowed(
                include_bytes!("../../../web/public/fonts/Workbench-bold.ttf").as_slice(),
            ),
            Cow::Borrowed(
                include_bytes!("../../../web/public/fonts/IBMPlexSans-Regular.ttf").as_slice(),
            ),
            Cow::Borrowed(
                include_bytes!("../../../web/public/fonts/JetBrainsMono-Regular.ttf").as_slice(),
            ),
        ])
        .expect("bundled fonts");
    gpui_kit::init(cx);
    if cx.platform_info().is_mac() {
        cx.bind_keys([
            KeyBinding::new("cmd-a", SelectAll, Some("Input")),
            KeyBinding::new("cmd-c", Copy, Some("Input")),
            KeyBinding::new("cmd-x", Cut, Some("Input")),
            KeyBinding::new("cmd-v", Paste, Some("Input")),
            KeyBinding::new("cmd-z", Undo, Some("Input")),
            KeyBinding::new("cmd-shift-z", Redo, Some("Input")),
            KeyBinding::new("cmd-left", MoveHome, Some("Input")),
            KeyBinding::new("cmd-right", MoveEnd, Some("Input")),
            KeyBinding::new("cmd-backspace", DeleteToBeginningOfLine, Some("Input")),
            KeyBinding::new("cmd-delete", DeleteToEndOfLine, Some("Input")),
        ]);
    }
}
