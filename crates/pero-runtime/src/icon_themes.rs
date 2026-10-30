//! Runtime-owned installed packages. Selection uses the existing settings writer.
use pero_contracts::icon_theme::{IconTheme, IconThemeCommand, IconThemeInfo, IconThemeState};
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
};
pub struct IconThemes {
    root: PathBuf,
    settings: PathBuf,
    themes: BTreeMap<String, IconTheme>,
    selected: Option<String>,
}
impl IconThemes {
    pub fn load(settings: &Path) -> Result<Self, String> {
        let root = settings
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("icon-themes");
        let mut themes = BTreeMap::new();
        if root.exists() {
            for entry in std::fs::read_dir(&root).map_err(|error| error.to_string())? {
                let path = entry.map_err(|error| error.to_string())?.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                let theme = IconTheme::parse(
                    &std::fs::read_to_string(&path).map_err(|error| error.to_string())?,
                )?;
                if path.file_stem().and_then(|name| name.to_str()) != Some(theme.id.as_str()) {
                    return Err("Installed icon theme filename does not match its identity".into());
                }
                themes.insert(theme.id.clone(), theme);
            }
        }
        let selected =
            crate::settings::load_icon_theme(settings).filter(|id| themes.contains_key(id));
        Ok(Self {
            root,
            settings: settings.into(),
            themes,
            selected,
        })
    }
    pub fn state(&self) -> IconThemeState {
        IconThemeState {
            installed: self
                .themes
                .values()
                .map(|theme| IconThemeInfo {
                    id: theme.id.clone(),
                    name: theme.name.clone(),
                })
                .collect(),
            selected: self.selected.clone(),
            theme: self
                .selected
                .as_ref()
                .and_then(|id| self.themes.get(id))
                .cloned(),
        }
    }
    pub fn apply(&mut self, command: IconThemeCommand) -> Result<(), String> {
        match command {
            IconThemeCommand::Get { .. } => Ok(()),
            IconThemeCommand::Install { path, .. } => {
                let theme = IconTheme::parse(
                    &std::fs::read_to_string(path).map_err(|error| error.to_string())?,
                )?;
                if self.themes.contains_key(&theme.id) {
                    return Err("This icon theme is already installed. Remove it before installing a replacement.".into());
                }
                std::fs::create_dir_all(&self.root).map_err(|error| error.to_string())?;
                let pending = self.root.join(format!("{}.pending", theme.id));
                let mut file =
                    std::fs::File::create(&pending).map_err(|error| error.to_string())?;
                file.write_all(&serde_json::to_vec(&theme).map_err(|error| error.to_string())?)
                    .and_then(|_| file.sync_all())
                    .map_err(|error| error.to_string())?;
                std::fs::rename(pending, self.root.join(format!("{}.json", theme.id)))
                    .map_err(|error| error.to_string())?;
                self.themes.insert(theme.id.clone(), theme);
                Ok(())
            }
            IconThemeCommand::Select { id, .. } => {
                if id.as_ref().is_some_and(|id| !self.themes.contains_key(id)) {
                    return Err("This icon theme is not installed".into());
                }
                crate::settings::save_icon_theme(&self.settings, id.as_deref())
                    .map_err(|error| error.to_string())?;
                self.selected = id;
                Ok(())
            }
            IconThemeCommand::Remove { id, .. } => {
                if !self.themes.contains_key(&id) {
                    return Err("This icon theme is not installed".into());
                }
                if self.selected.as_ref() == Some(&id) {
                    crate::settings::save_icon_theme(&self.settings, None)
                        .map_err(|error| error.to_string())?;
                    self.selected = None;
                }
                std::fs::remove_file(self.root.join(format!("{id}.json")))
                    .map_err(|error| error.to_string())?;
                self.themes.remove(&id);
                Ok(())
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::icon_theme::IconMethod;
    #[test]
    fn installed_vectors_and_selection_survive_restart_and_remove_returns_to_defaults() {
        let home = std::env::temp_dir().join(format!("pero-icon-theme-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&home).unwrap();
        let settings = home.join("settings.json");
        let package = home.join("package.json");
        std::fs::write(&settings, r#"{"locale":"zh-CN"}"#).unwrap();
        let glyph = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M1 1L23 23" stroke="currentColor"/></svg>"#;
        std::fs::write(&package,serde_json::json!({"version":1,"id":"sample","name":"Sample","icons":{"rust":{"light":glyph}},"associations":{"languages":{"rust":"rust"}}}).to_string()).unwrap();
        let mut store = IconThemes::load(&settings).unwrap();
        store
            .apply(IconThemeCommand::Install {
                method: IconMethod::Icons,
                request_id: "install".into(),
                path: package.to_string_lossy().into(),
            })
            .unwrap();
        store
            .apply(IconThemeCommand::Select {
                method: IconMethod::Icons,
                request_id: "select".into(),
                id: Some("sample".into()),
            })
            .unwrap();
        let mut restored = IconThemes::load(&settings).unwrap();
        assert_eq!(restored.state().selected.as_deref(), Some("sample"));
        assert_eq!(
            crate::settings::load_locale(&settings).as_deref(),
            Some("zh-CN")
        );
        restored
            .apply(IconThemeCommand::Remove {
                method: IconMethod::Icons,
                request_id: "remove".into(),
                id: "sample".into(),
            })
            .unwrap();
        let defaults = IconThemes::load(&settings).unwrap().state();
        assert!(defaults.selected.is_none());
        assert!(defaults.installed.is_empty());
        std::fs::remove_dir_all(home).unwrap();
    }
}
