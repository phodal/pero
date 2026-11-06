//! Presentation geometry for real pointer input, independent of fonts and density.
use gpui_kit::{prelude::*, *};
use std::{cell::Cell, rc::Rc};

#[derive(Clone, Default)]
pub(crate) struct ViewBounds(Rc<Cell<Option<Bounds<Pixels>>>>);

#[derive(Default)]
pub(crate) struct ComposerBounds {
    pub input: ViewBounds,
    pub context: ViewBounds,
    pub agent: ViewBounds,
    pub workspace: ViewBounds,
    pub model: ViewBounds,
    pub effort: ViewBounds,
    pub permissions: ViewBounds,
    pub reconnect: ViewBounds,
    pub authentication: ViewBounds,
}

impl ComposerBounds {
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "input":self.input.snapshot(),
            "context":self.context.snapshot(),
            "agent":self.agent.snapshot(),
            "workspace":self.workspace.snapshot(),
            "model":self.model.snapshot(),
            "effort":self.effort.snapshot(),
            "permissions":self.permissions.snapshot(),
            "reconnect":self.reconnect.snapshot(),
            "authentication":self.authentication.snapshot(),
        })
    }
}

impl ViewBounds {
    pub fn probe(&self) -> impl IntoElement + use<> {
        let value = self.0.clone();
        canvas(move |bounds, _, _| value.set(Some(bounds)), |_, _, _, _| {})
            .absolute().top_0().left_0()
            .size_full()
    }

    pub fn snapshot(&self) -> serde_json::Value {
        self.0
            .get()
            .map(|bounds| {
                serde_json::json!({
                    "x":f32::from(bounds.origin.x),"y":f32::from(bounds.origin.y),
                    "width":f32::from(bounds.size.width),"height":f32::from(bounds.size.height)
                })
            })
            .unwrap_or_default()
    }
}
