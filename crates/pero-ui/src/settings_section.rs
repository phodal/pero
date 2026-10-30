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
    Mcp,
    Harness,
}
impl SettingsSection {
    pub(crate) const ALL: [Self; 11] = [
        Self::General,
        Self::Theme,
        Self::InterfaceFont,
        Self::ChatFont,
        Self::CodeFont,
        Self::Agents,
        Self::Workers,
        Self::Connections,
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
            Self::Agents => "settings.page.agents",
            Self::Workers => "nav.workers",
            Self::Connections => "connector.title",
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
        matches!(
            self,
            Self::Theme | Self::InterfaceFont | Self::ChatFont | Self::CodeFont
        )
    }
    pub(crate) fn exclusive(self) -> bool {
        !self.is_appearance()
    }
}
