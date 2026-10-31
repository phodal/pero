//! Reserved scientific computing workspace.
use crate::app::Workbench;
use gpui_kit::{prelude::*, *};

impl Workbench {
    pub(crate) fn compute_content(&self, _cx: &mut Context<Self>) -> AnyElement {
        div().id("compute-content").size_full().into_any_element()
    }
}
