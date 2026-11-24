//! Settings navigation taxonomy and appearance grouping.
use pero_contracts::appearance::FontScope;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum SettingsSection {
    General,
    #[default]
    Theme,
    InterfaceFont,
    ChatFont,
    CodeFont,
    Agents,
    Workers,
    Connections,
    Computer,
    #[cfg(all(feature = "native", target_os = "macos"))]
    Browser,
    Mcp,
    Harness,
    Shortcuts,
    Memory,
}
impl SettingsSection {
    pub(crate) const ALL: &'static [Self] = &[
        Self::General,
        Self::Shortcuts,
        Self::Theme,
        Self::InterfaceFont,
        Self::ChatFont,
        Self::CodeFont,
        Self::Agents,
        Self::Harness,
        Self::Workers,
        Self::Connections,
        Self::Mcp,
        Self::Memory,
        #[cfg(all(feature = "native", target_os = "macos"))]
        Self::Browser,
        Self::Computer,
    ];
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::Shortcuts => "shortcuts.title",
            Self::General => "settings.general",
            Self::Theme => "settings.theme",
            Self::InterfaceFont => "settings.interface_font",
            Self::ChatFont => "settings.chat_font",
            Self::CodeFont => "settings.code_font",
            Self::Agents => "settings.page.agents",
            Self::Workers => "nav.workers",
            Self::Connections => "connector.title",
            #[cfg(all(feature = "native", target_os = "macos"))]
            Self::Browser => "browser_use.settings",
            Self::Computer => "computer.title",
            Self::Mcp => "mcp.title",
            Self::Harness => "harness.title",
            Self::Memory => "engram.title",
        }
    }
    pub(crate) fn scope(self) -> Option<FontScope> {
        match self {
            Self::InterfaceFont => Some(FontScope::Interface),
            Self::ChatFont => Some(FontScope::Chat),
            Self::CodeFont => Some(FontScope::Code),
            _ => None,
        }
    }
    pub(crate) fn is_appearance(self) -> bool {
        matches!(
            self,
            Self::Theme | Self::InterfaceFont | Self::ChatFont | Self::CodeFont
        )
    }
    pub(crate) fn exclusive(self) -> bool {
        !self.is_appearance()
    }
}
