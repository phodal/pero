//! One level at a time, using the workspace bound to the conversation by Host.
use pero_contracts::workspace_files::{DirectoryListing, EntryKind, WorkspaceEntry};
use std::path::{Component, Path, PathBuf};

pub const MAX_DIRECTORY_ENTRIES: usize = 2000;
pub const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;

pub struct WorkspaceFiles {
    root: PathBuf,
}

impl WorkspaceFiles {
    pub fn new(root: &Path) -> Result<Self, String> {
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Workspace is unavailable".into());
        }
        Ok(Self { root })
    }

    pub fn resolve(&self, relative: &str) -> Result<PathBuf, String> {
        let path = Path::new(relative);
        if relative.is_empty()
            || path.is_absolute()
            || path
                .components()
                .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
        {
            return Err("Select a path inside this conversation's workspace".into());
        }
        let resolved = self
            .root
            .join(path)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !resolved.starts_with(&self.root) {
            return Err("Path is outside this conversation's workspace".into());
        }
        Ok(resolved)
    }

    pub fn list(&self, relative: &str) -> Result<DirectoryListing, String> {
        let path = self.resolve(relative)?;
        let mut children = std::fs::read_dir(path).map_err(|e| e.to_string())?;
        let mut entries = Vec::new();
        for child in children.by_ref().take(MAX_DIRECTORY_ENTRIES) {
            let child = child.map_err(|e| e.to_string())?;
            let Some(name) = child.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let file_type = child.file_type().map_err(|e| e.to_string())?;
            let kind = if file_type.is_symlink() {
                EntryKind::Symlink
            } else if file_type.is_dir() {
                EntryKind::Directory
            } else if file_type.is_file() {
                EntryKind::File
            } else {
                EntryKind::Other
            };
            entries.push(WorkspaceEntry { name, kind });
        }
        let truncated = children.next().is_some();
        entries.sort_by_cached_key(|entry| {
            (
                entry.kind != EntryKind::Directory,
                entry.name.to_lowercase(),
                entry.name.clone(),
            )
        });
        Ok(DirectoryListing {
            workspace: self.root.to_string_lossy().into_owned(),
            path: relative.into(),
            entries,
            truncated,
        })
    }

    pub fn preview(
        &self,
        relative: &str,
    ) -> Result<pero_contracts::content_document::ContentDocument, String> {
        let path = self.resolve(relative)?;
        let metadata = path.metadata().map_err(|e| e.to_string())?;
        if !metadata.is_file() {
            return Err("Select a regular text file".into());
        }
        if metadata.len() > MAX_PREVIEW_BYTES {
            return Err("Preview supports text files up to 2 MiB".into());
        }
        crate::file_documents::FileDocuments::default()
            .open(&path)
            .map_err(|e| format!("Cannot preview this file: {e:?}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lists_one_level_and_reads_only_workspace_files() {
        let root = std::env::temp_dir().join(format!("pero-files-{}", std::process::id()));
        std::fs::create_dir_all(root.join("nested")).unwrap();
        std::fs::write(root.join("request.json"), "{\"input\":\"CCO\"}").unwrap();
        std::fs::write(root.join("nested/result.json"), "[]").unwrap();
        let files = WorkspaceFiles::new(&root).unwrap();
        let listing = files.list(".").unwrap();
        assert_eq!(
            listing
                .entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["nested", "request.json"]
        );
        assert!(!listing.truncated);
        assert_eq!(files.preview("nested/result.json").unwrap().source(), "[]");
        for path in ["..", "../outside", "/tmp", "missing", ""] {
            assert!(files.resolve(path).is_err(), "{path}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(std::env::temp_dir(), root.join("outside")).unwrap();
            assert!(files.resolve("outside").is_err());
        }
        std::fs::write(root.join("binary"), [0, 255]).unwrap();
        assert!(files.preview("binary").is_err());
        let big = std::fs::File::create(root.join("large.json")).unwrap();
        big.set_len(MAX_PREVIEW_BYTES + 1).unwrap();
        assert!(files.preview("large.json").is_err());
        for index in 0..MAX_DIRECTORY_ENTRIES {
            std::fs::write(root.join(format!("file-{index}")), "").unwrap();
        }
        let listing = files.list(".").unwrap();
        assert!(listing.truncated);
        assert_eq!(listing.entries.len(), MAX_DIRECTORY_ENTRIES);
        std::fs::remove_dir_all(root).unwrap();
    }
}
