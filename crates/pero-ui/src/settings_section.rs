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
    Computer,
    Mcp,
    Harness,
}
impl SettingsSection {
    pub(crate) const ALL: [Self; 8] = [
        Self::General,
        Self::Theme,
        Self::InterfaceFont,
        Self::ChatFont,
        Self::CodeFont,
        Self::Computer,
        Self::Mcp,
        Self::Harness,
    ];
    pub(crate) fn key(self) -> &'static str {
        match self {
            Self::General => "settings.general",
            Self::Theme => "settings.theme",
            Self::InterfaceFont => "settings.interface_font",
            Self::ChatFont => "settings.chat_font",
            Self::CodeFont => "settings.code_font",
            Self::Computer => "computer.title",
            Self::Mcp => "mcp.title",
            Self::Harness => "harness.title",
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
        matches!(self, Self::Theme | Self::InterfaceFont | Self::ChatFont | Self::CodeFont)
    }
}
