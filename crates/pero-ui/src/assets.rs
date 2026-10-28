use gpui_kit::*;
use std::borrow::Cow;
pub(crate) struct UiAssets;
impl AssetSource for UiAssets {
    fn load(&self, path: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
        let bytes: Option<&'static [u8]> = match path {
            "icons/languages.svg" => {
                Some(include_bytes!("../../../web/public/icons/languages.svg"))
            }
            "icons/sun.svg" => Some(include_bytes!("../../../web/public/icons/sun.svg")),
            "icons/moon.svg" => Some(include_bytes!("../../../web/public/icons/moon.svg")),
            "icons/circle-filled.svg" => Some(include_bytes!(
                "../../../web/public/icons/circle-filled.svg"
            )),
            "icons/circle-check-filled.svg" => Some(include_bytes!(
                "../../../web/public/icons/circle-check-filled.svg"
            )),
            "icons/arrow-left.svg" => Some(include_bytes!("../../../web/public/icons/arrow-left.svg")),
            "icons/server.svg" => Some(include_bytes!("../../../web/public/icons/server.svg")),
            "icons/clock.svg" => Some(include_bytes!("../../../web/public/icons/clock.svg")),
            "icons/copy.svg" => Some(include_bytes!("../../../web/public/icons/copy.svg")),
            "icons/layout-list.svg" => {
                Some(include_bytes!("../../../web/public/icons/layout-list.svg"))
            }
            "icons/folder.svg" => Some(include_bytes!("../../../web/public/icons/folder.svg")),
            "icons/devices.svg" => Some(include_bytes!("../../../web/public/icons/devices.svg")),
            "icons/brand-github.svg" => {
                Some(include_bytes!("../../../web/public/icons/brand-github.svg"))
            }
            "icons/search.svg" => Some(include_bytes!("../../../web/public/icons/search.svg")),
            "icons/chevron-down.svg" => {
                Some(include_bytes!("../../../web/public/icons/chevron-down.svg"))
            }
            "icons/plus.svg" => Some(include_bytes!("../../../web/public/icons/plus.svg")),
            "icons/check.svg" => Some(include_bytes!("../../../web/public/icons/check.svg")),
            "icons/file-code.svg" => {
                Some(include_bytes!("../../../web/public/icons/file-code.svg"))
            }
            "icons/terminal.svg" => Some(include_bytes!("../../../web/public/icons/terminal.svg")),
            "icons/arrow-right.svg" => {
                Some(include_bytes!("../../../web/public/icons/arrow-right.svg"))
            }
            "icons/player-pause.svg" => {
                Some(include_bytes!("../../../web/public/icons/player-pause.svg"))
            }
            "icons/external-link.svg" => Some(include_bytes!(
                "../../../web/public/icons/external-link.svg"
            )),
            "icons/file.svg" => Some(include_bytes!("../../../web/public/icons/file-text.svg")),
            "icons/square.svg" => {
                Some(include_bytes!("../../../web/public/icons/player-pause.svg"))
            }
            "icons/chevron-right.svg" => Some(include_bytes!(
                "../../../web/public/icons/chevron-right.svg"
            )),
            _ => None,
        };
        Ok(bytes.map(Cow::Borrowed))
    }
    fn list(&self, _: &str) -> anyhow::Result<Vec<SharedString>> {
        Ok(vec![])
    }
}
