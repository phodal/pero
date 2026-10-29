//! Stateless Workbench components. State and Host commands remain in the owner.
pub(super) mod sidebar;
pub(super) mod workspace;
use crate::theme::Palette;
use gpui_kit::{prelude::*, *};
use std::rc::Rc;
pub(super) type ActionHandler<A> = Rc<dyn Fn(&A, &mut Window, &mut App)>;
pub(super) fn click<A: 'static>(
    handler: &ActionHandler<A>,
    action: A,
) -> impl Fn(&ClickEvent, &mut Window, &mut App) + use<A> {
    let handler = handler.clone();
    move |_, window, cx| handler(&action, window, cx)
}
#[derive(Clone, Copy)]
pub(super) struct Ui<'a> {
    pub palette: &'a Palette,
    pub locale: &'a str,
    pub typography: pero_theme::ResolvedTypography,
}
impl Ui<'_> {
    pub fn t(self, key: &str) -> &'static str {
        pero_contracts::i18n::text(self.locale, key)
    }
    pub fn icon(&self, name: &str) -> Svg {
        pero_chat_ui::assets::UiIcon::named(name)
            .element()
            .size(px(19.))
            .flex_shrink_0()
            .text_color(self.palette.text_muted)
    }
    pub fn badge(&self, label: impl Into<SharedString>, kind: &str) -> Div {
        let p = self.palette;
        let (bg, fg) = match kind {
            "success" => ("success-bg", "success"),
            "warning" => ("warning-bg", "warning"),
            "info" => ("info-bg", "info"),
            _ => ("surface-muted", "text-muted"),
        };
        div()
            .px(px(10.))
            .py(px(3.))
            .rounded(px(6.))
            .text_size(px(pero_theme::TextRole::Caption.pixels(self.typography.ui)))
            .font_weight(FontWeight::BOLD)
            .bg(p.color(bg))
            .text_color(p.color(fg))
            .child(label.into())
    }
}
