//! Two Markdown layers the Memory page edits. Engram remains a separate search store.
use std::fs;
use std::path::{Path, PathBuf};

use pero_contracts::engram::{EngramSettings, MemoryPage};

use crate::engram::project_key;

const LIMIT: usize = 32_768;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Layers {
    pub global: String,
    pub project: String,
}

/// Text placed ahead of a non-Insights turn. An empty layer is omitted.
pub fn instruction(layers: &Layers) -> String {
    let global = layers.global.trim();
    let project = layers.project.trim();
    match (global.is_empty(), project.is_empty()) {
        (true, true) => String::new(),
        (false, true) => format!("Global memory, for every workspace:\n{global}"),
        (true, false) => format!("Project memory, for this workspace only:\n{project}"),
        (false, false) => format!(
            "Global memory, for every workspace:\n{global}\n\nProject memory, for this workspace only:\n{project}"
        ),
    }
}

pub fn read(data_home: &Path, project: Option<&str>) -> Layers {
    Layers {
        global: fs::read_to_string(global_path(data_home)).unwrap_or_default(),
        project: project
            .map(|key| fs::read_to_string(project_path(data_home, key)).unwrap_or_default())
            .unwrap_or_default(),
    }
}

/// `project` is the workspace key. None writes the global file. Empty text deletes the file.
pub fn write(data_home: &Path, project: Option<&str>, text: &str) -> Result<(), &'static str> {
    if text.contains('\0') || text.len() > LIMIT {
        return Err("engram.document");
    }
    let path = match project {
        None => global_path(data_home),
        Some(key) => project_path(data_home, key),
    };
    if text.trim().is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|_| "engram.document")?;
        }
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|_| "engram.document")?;
    }
    fs::write(&path, text).map_err(|_| "engram.document")
}

pub fn page(settings: &EngramSettings, data_home: Option<&Path>, workspace: &Path) -> MemoryPage {
    let key = workspace.canonicalize().ok().map(|path| project_key(&path));
    let layers = data_home
        .map(|home| read(home, key.as_deref()))
        .unwrap_or_default();
    MemoryPage {
        enabled: settings.enabled,
        binary: settings.binary.clone(),
        global: layers.global,
        project: layers.project,
        workspace: workspace.to_string_lossy().into_owned(),
    }
}

fn global_path(data_home: &Path) -> PathBuf {
    data_home.join("memory").join("global.md")
}

fn project_path(data_home: &Path, key: &str) -> PathBuf {
    data_home.join("memory").join("projects").join(format!("{key}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_text_is_omitted_and_clearing_deletes_the_file() {
        let root = std::env::temp_dir().join(format!("pero-memory-layers-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert_eq!(instruction(&Layers::default()), "");
        write(&root, None, "  keep units  ").unwrap();
        write(&root, Some("abc"), "project goal").unwrap();
        let loaded = read(&root, Some("abc"));
        assert_eq!(loaded.global, "  keep units  ");
        assert!(instruction(&loaded).contains("keep units"));
        assert!(instruction(&loaded).contains("project goal"));
        assert!(!instruction(&read(&root, Some("other"))).contains("project goal"));
        write(&root, None, " \n").unwrap();
        assert!(!global_path(&root).exists());
        assert!(write(&root, None, &"x".repeat(LIMIT + 1)).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
