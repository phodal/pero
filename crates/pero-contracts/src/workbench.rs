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

/// Persistent layout choices, independent of the current viewport's available space.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct LayoutPreferences {
    #[serde(deserialize_with = "LayoutPreferences::deserialize_chat_width")]
    chat_width: u16,
    pub chat_open: bool,
}

impl Default for LayoutPreferences {
    fn default() -> Self {
        Self {
            chat_width: 420,
            chat_open: false,
        }
    }
}

impl LayoutPreferences {
    const MIN_CHAT_WIDTH: u16 = 320;
    const MAX_CHAT_WIDTH: u16 = 640;

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
    pub layout: LayoutPreferences,
}

impl WorkbenchPreferences {
    pub fn valid(&self) -> bool {
        self.projects.len() <= 128
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
        self.projects
            .retain(|binding| binding.workspace != workspace);
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
        let mut layout = LayoutPreferences::default();
        for (requested, expected) in [(200., 320.), (400.7, 401.), (800., 640.)] {
            layout.resize_chat(requested);
            assert_eq!(layout.chat_width(), expected);
        }
    }
}
