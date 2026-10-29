//! Presentation geometry for real pointer input, independent of fonts and density.
use gpui_kit::{prelude::*, *};
use std::{cell::Cell, rc::Rc};

#[derive(Clone, Default)]
pub(crate) struct ViewBounds(Rc<Cell<Option<Bounds<Pixels>>>>);

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
