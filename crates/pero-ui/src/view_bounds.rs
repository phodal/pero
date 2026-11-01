//! Geometry observed during GPUI prepaint, for real pointer-based diagnostics.
//! These are layout bounds, like ChatPanel ViewBounds, not an occlusion map.
//! Callers must target visible controls (or scroll them into view first).
use gpui_kit::{prelude::*, *};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc};

#[derive(Default)]
pub(crate) struct ViewBounds(Rc<RefCell<BTreeMap<String, Bounds<Pixels>>>>);

impl ViewBounds {
    pub fn clear(&self) {
        self.0.borrow_mut().clear();
    }

    pub fn probe(&self, key: String) -> impl IntoElement + use<> {
        let values = self.0.clone();
        canvas(move |bounds, _, _| { values.borrow_mut().insert(key.clone(), bounds); }, |_, _, _, _| {})
            .absolute().top_0().left_0().size_full()
    }

    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::Value::Object(self.0.borrow().iter().map(|(key, bounds)| {
            (key.clone(), serde_json::json!({
                "x": f32::from(bounds.origin.x), "y": f32::from(bounds.origin.y),
                "width": f32::from(bounds.size.width), "height": f32::from(bounds.size.height)
            }))
        }).collect())
    }
}

#[derive(Default)]
pub(crate) struct WorkbenchBounds {
    pub sidebar: ViewBounds,
    pub settings: ViewBounds,
    pub terminal: ViewBounds,
    pub new_chat: ViewBounds,
    pub sessions: ViewBounds,
    pub app_open: ViewBounds,
    pub chat_close: ViewBounds,
}

impl WorkbenchBounds {
    // A hidden, collapsed, filtered, or removed control must not retain its old target.
    pub fn clear(&self) {
        self.sidebar.clear();
        self.settings.clear();
        self.terminal.clear();
        self.new_chat.clear();
        self.sessions.clear();
        self.app_open.clear();
        self.chat_close.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_chat_control_does_not_retain_its_last_paint() {
        let observed = WorkbenchBounds::default();
        observed.chat_close.0.borrow_mut().insert("float-chat-close".into(), Bounds {
            origin: point(px(10.), px(20.)), size: size(px(30.), px(40.)),
        });
        assert!(!observed.chat_close.snapshot()["float-chat-close"].is_null());
        observed.clear();
        assert!(observed.chat_close.snapshot()["float-chat-close"].is_null());
    }
}
