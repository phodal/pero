//! Host-admitted theme assets share the existing GPUI AssetSource and source registry.
use crate::assets::UiIcon;
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat},
    content_icon::{ContentIconInput, ContentIconKind, ContentIconRegistry},
    icon_theme::IconThemeState,
};
use std::sync::{Arc, OnceLock, RwLock};
fn state() -> &'static RwLock<Arc<IconThemeState>> {
    static STATE: OnceLock<RwLock<Arc<IconThemeState>>> = OnceLock::new();
    STATE.get_or_init(|| RwLock::new(Arc::new(IconThemeState::default())))
}
pub fn install(value: IconThemeState) {
    *state().write().expect("icon theme state") = Arc::new(value);
}
pub fn snapshot() -> Arc<IconThemeState> {
    state().read().expect("icon theme state").clone()
}
pub fn load(path: &str) -> Option<Vec<u8>> {
    state()
        .read()
        .expect("icon theme state")
        .theme
        .as_ref()?
        .asset(path)
        .map(|svg| svg.as_bytes().to_vec())
}
pub fn document_icon(document: &ContentDocument, dark: bool) -> String {
    source_icon(&document.format, &document.title, dark)
}
/// Source metadata is sufficient for icons, including lazily restored documents.
pub fn source_icon(format: &ContentFormat, title: &str, dark: bool) -> String {
    let input = ContentIconInput::document(format, title, dark);
    snapshot()
        .theme
        .as_ref()
        .and_then(|theme| theme.resolve(input))
        .unwrap_or_else(|| {
            UiIcon::from_content(ContentIconRegistry::default().resolve(input))
                .path()
                .into()
        })
}
pub fn app_icon(name: &str, dark: bool) -> String {
    snapshot()
        .theme
        .as_ref()
        .and_then(|theme| {
            theme.resolve(ContentIconInput {
                kind: ContentIconKind::App,
                app: Some(name),
                dark,
                ..Default::default()
            })
        })
        .unwrap_or_else(|| UiIcon::for_app(name, dark).path().into())
}
pub fn kind_icon(kind: ContentIconKind, dark: bool) -> String {
    let input = ContentIconInput {
        kind,
        dark,
        ..Default::default()
    };
    snapshot()
        .theme
        .as_ref()
        .and_then(|theme| theme.resolve(input))
        .unwrap_or_else(|| {
            UiIcon::from_content(
                pero_contracts::content_icon::ContentIconRegistry::default().resolve(input),
            )
            .path()
            .into()
        })
}
pub fn asset_path(name: &str) -> String {
    if name.starts_with("icons/") || name.starts_with("icon-themes/") {
        name.into()
    } else {
        UiIcon::named(name).path().into()
    }
}
