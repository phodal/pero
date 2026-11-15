//! Preferences shared by Desktop and the Host-owned settings store.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Appearance {
    Light,
    Dark,
    #[default]
    System,
}

impl Appearance {
    pub fn dark(self, system_dark: bool) -> bool {
        match self {
            Self::Light => false,
            Self::Dark => true,
            Self::System => system_dark,
        }
    }
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Light => "appearance.light",
            Self::Dark => "appearance.dark",
            Self::System => "appearance.system",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectBinding {
    pub workspace: String,
    pub project_id: String,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ArtifactView {
    #[default]
    Icons,
    List,
    Gallery,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResourceTab {
    Files,
    #[default]
    Artifacts,
}

/// Where a content link opens. A middle click or the platform modifier reverses it.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LinkSurface {
    #[default]
    InApp,
    ExternalBrowser,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct LinkClick {
    pub middle: bool,
    pub primary_modifier: bool,
}

impl LinkSurface {
    pub fn opens_externally(self, click: LinkClick) -> bool {
        let external = matches!(self, Self::ExternalBrowser);
        external != (click.middle || click.primary_modifier)
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::InApp => "links.in_app",
            Self::ExternalBrowser => "links.browser",
        }
    }
}

/// Persistent layout choices, independent of the current viewport's available space.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct LayoutPreferences {
    #[serde(deserialize_with = "LayoutPreferences::deserialize_chat_width")]
    chat_width: u16,
    pub chat_open: bool,
    #[serde(
        default = "LayoutPreferences::default_sidebar_width",
        deserialize_with = "LayoutPreferences::deserialize_sidebar_width"
    )]
    sidebar_width: u16,
    #[serde(deserialize_with = "LayoutPreferences::deserialize_sessions_width")]
    sessions_width: u16,
    #[serde(default = "LayoutPreferences::default_artifact_pane_width")]
    artifact_pane_width: u16,
    pub artifact_view: ArtifactView,
    pub resource_tab: ResourceTab,
    #[serde(default)]
    pub link_surface: LinkSurface,
    #[serde(default = "LayoutPreferences::default_diff_soft_wrap")]
    pub diff_soft_wrap: bool,
}

impl Default for LayoutPreferences {
    fn default() -> Self {
        Self {
            sessions_width: 280,
            chat_width: 420,
            chat_open: false,
            sidebar_width: Self::DEFAULT_SIDEBAR_WIDTH,
            artifact_pane_width: Self::DEFAULT_ARTIFACT_PANE_WIDTH,
            artifact_view: ArtifactView::Icons,
            resource_tab: ResourceTab::Artifacts,
            link_surface: LinkSurface::InApp,
            diff_soft_wrap: Self::default_diff_soft_wrap(),
        }
    }
}

impl LayoutPreferences {
    fn default_diff_soft_wrap() -> bool {
        true
    }

    const MIN_CHAT_WIDTH: u16 = 320;
    const MAX_CHAT_WIDTH: u16 = 640;
    pub const MIN_SIDEBAR_WIDTH: u16 = 200;
    pub const MAX_SIDEBAR_WIDTH: u16 = 480;
    const DEFAULT_SIDEBAR_WIDTH: u16 = 260;
    /// Window narrower than chat plus this width keeps a single column.
    pub const MIN_ARTIFACT_PANE_WIDTH: u16 = 280;
    pub const DEFAULT_ARTIFACT_PANE_WIDTH: u16 = 280;

    pub fn chat_width(&self) -> f32 {
        self.chat_width.into()
    }

    /// Dragging beyond either edge keeps the nearest supported preference.
    pub fn resize_chat(&mut self, width: f32) {
        self.chat_width = width
            .round()
            .max(Self::MIN_CHAT_WIDTH.into())
            .min(Self::MAX_CHAT_WIDTH.into()) as u16;
    }

    fn deserialize_chat_width<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<u16, D::Error> {
        let width = u16::deserialize(deserializer)?;
        if !(Self::MIN_CHAT_WIDTH..=Self::MAX_CHAT_WIDTH).contains(&width) {
            return Err(serde::de::Error::custom(
                "Chat width must be between 320 and 640",
            ));
        }
        Ok(width)
    }

    pub fn sidebar_width(&self) -> f32 {
        self.sidebar_width.into()
    }

    /// Dragging beyond either edge keeps the nearest supported preference.
    pub fn resize_sidebar(&mut self, width: f32) {
        self.sidebar_width = width
            .round()
            .max(Self::MIN_SIDEBAR_WIDTH.into())
            .min(Self::MAX_SIDEBAR_WIDTH.into()) as u16;
    }

    fn default_sidebar_width() -> u16 {
        Self::DEFAULT_SIDEBAR_WIDTH
    }

    fn deserialize_sidebar_width<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<u16, D::Error> {
        let width = u16::deserialize(deserializer)?;
        if !(Self::MIN_SIDEBAR_WIDTH..=Self::MAX_SIDEBAR_WIDTH).contains(&width) {
            return Err(serde::de::Error::custom(
                "Sidebar width must be between 200 and 480",
            ));
        }
        Ok(width)
    }

    pub const MIN_SESSIONS_WIDTH: u16 = 200;
    pub const MAX_SESSIONS_WIDTH: u16 = 480;
    pub const DEFAULT_SESSIONS_WIDTH: u16 = 280;

    pub fn sessions_width(&self) -> f32 {
        self.sessions_width.into()
    }

    pub fn resize_sessions(&mut self, width: f32) {
        self.sessions_width = width.round().clamp(
            Self::MIN_SESSIONS_WIDTH.into(),
            Self::MAX_SESSIONS_WIDTH.into(),
        ) as u16;
    }

    /// Preserve at least 320px for the conversation; hide the list on narrow windows.
    pub fn visible_sessions_width(&self, available: f32) -> Option<f32> {
        (available >= 520.).then(|| self.sessions_width().min(available - 320.))
    }

    /// Move the displayed divider, retaining the preference when it cannot move.
    pub fn resize_sessions_by(&mut self, available: f32, delta: f32) {
        if let Some(width) = self.visible_sessions_width(available) {
            let mut resized = *self;
            resized.resize_sessions(width + delta);
            if resized.visible_sessions_width(available) != Some(width) {
                self.sessions_width = resized.sessions_width;
            }
        }
    }

    fn deserialize_sessions_width<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<u16, D::Error> {
        let width = u16::deserialize(deserializer)?;
        if !(Self::MIN_SESSIONS_WIDTH..=Self::MAX_SESSIONS_WIDTH).contains(&width) {
            return Err(serde::de::Error::custom(
                "Sessions width must be between 200 and 480",
            ));
        }
        Ok(width)
    }

    pub fn artifact_pane_width(&self) -> f32 {
        self.artifact_pane_width.into()
    }

    pub fn resize_artifact_pane(&mut self, width: f32) {
        if !width.is_finite() {
            return;
        }
        self.artifact_pane_width = width.round().clamp(0., f32::from(u16::MAX)) as u16;
    }

    fn default_artifact_pane_width() -> u16 {
        Self::DEFAULT_ARTIFACT_PANE_WIDTH
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkbenchPreferences {
    #[serde(default)]
    pub appearance: Appearance,
    #[serde(default)]
    pub accent: crate::appearance::AccentColor,
    #[serde(default)]
    pub typography: crate::appearance::TypographyPreferences,
    #[serde(default)]
    pub projects: Vec<ProjectBinding>,
    #[serde(default)]
    pub research_projects: Vec<crate::research_project::ResearchProject>,
    #[serde(default)]
    pub layout: LayoutPreferences,
    #[serde(default)]
    pub shortcuts: crate::shortcuts::ShortcutOverrides,
}

impl WorkbenchPreferences {
    pub fn valid(&self) -> bool {
        crate::research_project::ResearchProject::collection_valid(&self.research_projects)
            && self.projects.len() <= 128
            && self.projects.iter().enumerate().all(|(i, binding)| {
                !binding.workspace.trim().is_empty()
                    && binding.workspace.len() <= 4096
                    && !binding.workspace.contains('\0')
                    && binding.project_id.len() <= 128
                    && !binding.project_id.chars().any(char::is_control)
                    && !self.projects[..i]
                        .iter()
                        .any(|other| other.workspace == binding.workspace)
            })
    }

    pub fn bind(&mut self, workspace: String, project_id: String) {
        self.projects.retain(|binding| {
            !crate::workspace_path::WorkspacePath(&binding.workspace).matches(&workspace)
        });
        self.projects.push(ProjectBinding {
            workspace,
            project_id,
        });
    }
}

#[derive(Deserialize)]
#[serde(tag = "method", deny_unknown_fields)]
pub enum WorkbenchSettingsRequest {
    #[serde(rename = "settings.workbench.get")]
    Get,
    #[serde(rename = "settings.workbench")]
    Set { preferences: WorkbenchPreferences },
}

/// Repository identity used to reconcile a checkout with its shared Project.
/// Transport spelling (SSH vs HTTPS, `.git`, case) is not part of identity.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(deny_unknown_fields)]
pub struct RepositoryIdentity {
    pub host: String,
    pub owner: String,
    pub name: String,
}

impl RepositoryIdentity {
    pub fn from_git_remote(remote: &str) -> Option<Self> {
        let remote = remote.trim();
        let (authority, path) = if let Some((scheme, location)) = remote.split_once("://") {
            if !matches!(scheme, "https" | "http" | "ssh" | "git") {
                return None;
            }
            location.split_once('/')?
        } else {
            let (authority, path) = remote.split_once(':')?;
            if !authority.contains('@') {
                return None;
            }
            (authority, path)
        };
        let host = authority.rsplit('@').next()?.to_ascii_lowercase();
        let path = path.trim_matches('/');
        let path = path.strip_suffix(".git").unwrap_or(path);
        let (owner, name) = path.rsplit_once('/')?;
        if host.is_empty()
            || owner.is_empty()
            || name.is_empty()
            || [&host, owner, name].into_iter().any(|part| {
                part.chars()
                    .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '?' | '#' | '\\'))
            })
        {
            return None;
        }
        Some(Self {
            host,
            owner: owner.to_ascii_lowercase(),
            name: name.to_ascii_lowercase(),
        })
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct WorkspaceIdentity {
    pub repository: Option<RepositoryIdentity>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WorkspaceRepository {
    pub workspace: String,
    pub repository: RepositoryIdentity,
}

#[cfg(test)]
mod repository_tests {
    use super::*;
    #[test]
    fn repository_identity_normalizes_transport_but_retains_owner_and_host() {
        let canonical =
            RepositoryIdentity::from_git_remote("git@github.com:phodal/pero.git").unwrap();
        for (remote, same) in [
            ("https://github.com/Phodal/Pero.git", true),
            ("ssh://git@github.com/phodal/pero", true),
            ("https://github.com/other/pero", false),
            ("git@gitlab.com:phodal/pero.git", false),
            ("/local/pero", false),
            ("file:///local/pero", false),
            ("https://github.com/phodal/pero?token=secret", false),
        ] {
            assert_eq!(
                RepositoryIdentity::from_git_remote(remote).as_ref() == Some(&canonical),
                same,
                "{remote}"
            );
        }
    }
}

#[cfg(test)]
mod layout_tests {
    use super::*;

    #[test]
    fn layout_preferences_restore_compatible_settings_and_bound_drag_changes() {
        for (input, expected) in [
            (serde_json::json!({}), Some((420., false))),
            (serde_json::json!({"chat_open":true}), Some((420., true))),
            (serde_json::json!({"chat_width":320}), Some((320., false))),
            (
                serde_json::json!({"chat_width":640,"chat_open":true}),
                Some((640., true)),
            ),
            (serde_json::json!({"chat_width":319}), None),
            (serde_json::json!({"chat_width":641}), None),
            (serde_json::json!({"chat_width":420.5}), None),
            (serde_json::json!({"chat_width":"420"}), None),
        ] {
            let restored = serde_json::from_value::<LayoutPreferences>(input.clone())
                .map(|layout| (layout.chat_width(), layout.chat_open))
                .ok();
            assert_eq!(restored, expected, "{input}");
        }
        for (input, wraps) in [
            (serde_json::json!({}), true),
            (serde_json::json!({"diff_soft_wrap":true}), true),
            (serde_json::json!({"diff_soft_wrap":false}), false),
        ] {
            let layout: LayoutPreferences = serde_json::from_value(input).unwrap();
            assert_eq!(layout.diff_soft_wrap, wraps);
            let restored: LayoutPreferences =
                serde_json::from_value(serde_json::to_value(layout).unwrap()).unwrap();
            assert_eq!(restored.diff_soft_wrap, wraps);
        }
        let mut layout = LayoutPreferences::default();
        for (requested, expected) in [(200., 320.), (400.7, 401.), (800., 640.)] {
            layout.resize_chat(requested);
            assert_eq!(layout.chat_width(), expected);
        }
        for (input, expected) in [
            (serde_json::json!({}), Some(280.)),
            (serde_json::json!({"artifact_pane_width":640}), Some(640.)),
            (serde_json::json!({"artifact_pane_width":0}), Some(0.)),
            (serde_json::json!({"artifact_pane_width":279}), Some(279.)),
            (serde_json::json!({"artifact_pane_width":1201}), Some(1201.)),
            (serde_json::json!({"artifact_pane_width":-1}), None),
            (serde_json::json!({"artifact_pane_width":640.5}), None),
        ] {
            assert_eq!(
                serde_json::from_value::<LayoutPreferences>(input)
                    .ok()
                    .map(|layout| layout.artifact_pane_width()),
                expected
            );
        }
        for (requested, expected) in [
            (0., 0.),
            (100., 100.),
            (640.4, 640.),
            (1600., 1600.),
            (80_000., 65_535.),
        ] {
            layout.resize_artifact_pane(requested);
            assert_eq!(layout.artifact_pane_width(), expected);
        }
        for (input, expected) in [
            (serde_json::json!({}), Some(ArtifactView::Icons)),
            (
                serde_json::json!({"artifact_view":"icons"}),
                Some(ArtifactView::Icons),
            ),
            (
                serde_json::json!({"artifact_view":"list"}),
                Some(ArtifactView::List),
            ),
            (
                serde_json::json!({"artifact_view":"gallery"}),
                Some(ArtifactView::Gallery),
            ),
            (serde_json::json!({"artifact_view":"unknown"}), None),
        ] {
            assert_eq!(
                serde_json::from_value::<LayoutPreferences>(input)
                    .ok()
                    .map(|layout| layout.artifact_view),
                expected
            );
        }
    }

    #[test]
    fn sidebar_width_restores_and_stays_inside_the_drag_range() {
        let missing = serde_json::from_value::<LayoutPreferences>(serde_json::json!({})).unwrap();
        assert_eq!(missing.sidebar_width(), 260.);
        let saved =
            serde_json::from_value::<LayoutPreferences>(serde_json::json!({"sidebar_width":360}))
                .unwrap();
        assert_eq!(saved.sidebar_width(), 360.);
        assert!(
            serde_json::from_value::<LayoutPreferences>(serde_json::json!({"sidebar_width":199}))
                .is_err()
        );
        assert!(
            serde_json::from_value::<LayoutPreferences>(serde_json::json!({"sidebar_width":481}))
                .is_err()
        );
        let mut layout = LayoutPreferences::default();
        layout.resize_sidebar(100.);
        assert_eq!(layout.sidebar_width(), 200.);
        layout.resize_sidebar(900.);
        assert_eq!(layout.sidebar_width(), 480.);
        layout.resize_sidebar(360.4);
        assert_eq!(layout.sidebar_width(), 360.);
    }
    #[test]
    fn link_surface_defaults_inside_the_app_and_a_modifier_reverses_it() {
        let layout: LayoutPreferences = serde_json::from_str("{}").unwrap();
        assert_eq!(layout.link_surface, LinkSurface::InApp);

        for (surface, middle, primary, external) in [
            (LinkSurface::InApp, false, false, false),
            (LinkSurface::InApp, true, false, true),
            (LinkSurface::InApp, false, true, true),
            (LinkSurface::ExternalBrowser, false, false, true),
            (LinkSurface::ExternalBrowser, true, false, false),
            (LinkSurface::ExternalBrowser, false, true, false),
        ] {
            assert_eq!(
                surface.opens_externally(LinkClick {
                    middle,
                    primary_modifier: primary,
                }),
                external
            );
        }
    }
    #[test]
    fn sessions_width_preserves_preferences_when_space_is_limited() {
        let mut layout: LayoutPreferences = serde_json::from_str("{}").unwrap();
        assert_eq!(layout.sessions_width(), 280.);
        for (requested, saved, available, visible) in [
            (100., 200., 900., Some(200.)),
            (900., 480., 900., Some(480.)),
            (360.4, 360., 600., Some(280.)),
            (360., 360., 519., None),
        ] {
            layout.resize_sessions(requested);
            assert_eq!(layout.visible_sessions_width(available), visible);
            let restored: LayoutPreferences =
                serde_json::from_value(serde_json::to_value(layout).unwrap()).unwrap();
            assert_eq!(restored.sessions_width(), saved);
        }
        for width in [199, 481] {
            assert!(
                serde_json::from_value::<LayoutPreferences>(
                    serde_json::json!({"sessions_width": width})
                )
                .is_err()
            );
        }
    }

    #[test]
    fn sessions_width_adjustments_start_at_the_displayed_divider() {
        for (saved, available, delta, expected, visible) in [
            (480., 740., -20., 400., Some(400.)),
            (360., 600., -20., 260., Some(260.)),
            (280., 900., 20., 300., Some(300.)),
            (200., 900., -20., 200., Some(200.)),
            (480., 900., 20., 480., Some(480.)),
            (480., 740., 20., 480., Some(420.)),
            (480., 520., -20., 480., Some(200.)),
            (360., 519., -20., 360., None),
        ] {
            let mut layout = LayoutPreferences::default();
            layout.resize_sessions(saved);
            layout.resize_sessions_by(available, delta);
            assert_eq!(layout.sessions_width(), expected);
            assert_eq!(layout.visible_sessions_width(available), visible);
            let restored: LayoutPreferences =
                serde_json::from_value(serde_json::to_value(layout).unwrap()).unwrap();
            assert_eq!(restored.sessions_width(), expected);
        }
        let mut layout = LayoutPreferences::default();
        layout.resize_sessions(480.);
        for expected in [400., 380., 360.] {
            layout.resize_sessions_by(740., -20.);
            assert_eq!(layout.sessions_width(), expected);
            assert_eq!(layout.visible_sessions_width(740.), Some(expected));
        }
    }
}
