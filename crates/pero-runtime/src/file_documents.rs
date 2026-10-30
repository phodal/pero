//! Host-owned text files. Source validation and actual filesystem I/O live here.
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat},
    file_document::{FileCopy, FileDocument, FileSave, SaveError},
};
use std::{collections::BTreeMap, path::Path};
#[derive(Default)]
pub struct FileDocuments {
    files: BTreeMap<String, FileDocument>,
    revisions: BTreeMap<String, u64>,
}
#[derive(Debug)]
pub enum FileError {
    Io(std::io::Error),
    Unsupported,
    Unavailable,
    Conflict,
}
impl From<std::io::Error> for FileError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}
impl FileDocuments {
    pub fn open(&mut self, path: &Path) -> Result<ContentDocument, FileError> {
        let path = std::fs::canonicalize(path)?;
        if !path.is_file() {
            return Err(FileError::Unsupported);
        }
        let bytes = std::fs::read(&path)?;
        let text = String::from_utf8(bytes).map_err(|_| FileError::Unsupported)?;
        if text.contains('\0') {
            return Err(FileError::Unsupported);
        }
        let id = path.to_string_lossy().into_owned();
        let next_revision = self.revisions.get(&id).map_or(1, |revision| revision + 1);
        let file = if let Some(previous) = self.files.get(&id) {
            previous.refreshed(text, next_revision)
        } else {
            let title = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let extension = path
                .extension()
                .unwrap_or_default()
                .to_string_lossy()
                .to_ascii_lowercase();
            let format = match extension.as_str() {
                "md" | "markdown" => ContentFormat::Markdown,
                "json" => ContentFormat::Json,
                "jsonl" | "ndjson" => ContentFormat::JsonLines,
                "rs" => ContentFormat::Code("rust".into()),
                "py" => ContentFormat::Code("python".into()),
                "go" => ContentFormat::Code("go".into()),
                "js" | "mjs" | "cjs" => ContentFormat::Code("javascript".into()),
                "ts" => ContentFormat::Code("typescript".into()),
                "tsx" | "jsx" | "html" | "css" | "sql" | "sh" | "yaml" | "toml" | "xml" | "c"
                | "cpp" | "java" => ContentFormat::Code(extension),
                _ => ContentFormat::Text,
            };
            FileDocument::loaded(id.clone(), title, text, format, next_revision)
        };
        let snapshot = file.snapshot().clone();
        self.revisions.insert(id.clone(), snapshot.revision);
        self.files.insert(id, file);
        Ok(snapshot)
    }
    pub fn remember_revision(&mut self, id: &str, revision: u64) {
        self.revisions
            .entry(id.to_owned())
            .and_modify(|current| *current = (*current).max(revision))
            .or_insert(revision);
    }
    pub fn restore(&mut self, snapshot: ContentDocument) -> bool {
        self.remember_revision(&snapshot.id, snapshot.revision);
        let changed =
            std::fs::read_to_string(&snapshot.id).map_or(true, |disk| disk != snapshot.source());
        self.files
            .insert(snapshot.id.clone(), FileDocument::recovered(snapshot));
        changed
    }
    /// A lazy recovered tab must not replace an already open, newer disk baseline.
    pub fn restore_if_closed(&mut self, snapshot: ContentDocument) {
        if !self.files.contains_key(&snapshot.id) {
            self.restore(snapshot);
        }
    }
    pub fn follow(&mut self, source: &str, href: &str) -> Result<ContentDocument, FileError> {
        let file = self.files.get(source).ok_or(FileError::Unavailable)?;
        let base =
            url::Url::from_file_path(&file.snapshot().id).map_err(|_| FileError::Unsupported)?;
        let target = base.join(href).map_err(|_| FileError::Unsupported)?;
        let path = target.to_file_path().map_err(|_| FileError::Unsupported)?;
        self.open(&path)
    }
    pub fn save(
        &mut self,
        id: &str,
        revision: u64,
        text: String,
    ) -> Result<ContentDocument, FileError> {
        let previous = self.files.get(id).ok_or(FileError::Unavailable)?;
        let disk = std::fs::read_to_string(id)?;
        let decision = previous
            .prepare_save(
                revision,
                &disk,
                text,
                self.revisions.get(id).copied().unwrap_or(revision) + 1,
            )
            .map_err(|error| match error {
                SaveError::StaleRevision | SaveError::ChangedOnDisk => FileError::Conflict,
            })?;
        if let FileSave::Write(next) = decision {
            write_file(Path::new(id), next.snapshot().source())?;
            self.revisions.insert(id.into(), next.snapshot().revision);
            self.files.insert(id.into(), next);
        }
        Ok(self.files[id].snapshot().clone())
    }
    /// Copying never changes the producer. An opened target retains its normal disk conflict rule.
    pub fn save_as(&mut self, copy: FileCopy) -> Result<ContentDocument, FileError> {
        if copy.text.contains('\0') {
            return Err(FileError::Unsupported);
        }
        let requested = Path::new(&copy.path);
        let path = if requested.exists() {
            std::fs::canonicalize(requested)?
        } else {
            let parent = requested.parent().ok_or(FileError::Unsupported)?;
            std::fs::canonicalize(parent)?
                .join(requested.file_name().ok_or(FileError::Unsupported)?)
        };
        let id = path.to_string_lossy().into_owned();
        if copy.protected_sources.contains(&id) {
            return Err(FileError::Conflict);
        }
        if let Some(previous) = self.files.get(&id) {
            return self.save(&id, previous.snapshot().revision, copy.text);
        }
        write_file(&path, &copy.text)?;
        self.open(&path)
    }
    pub fn recovery_source(&self, id: &str, revision: u64) -> Option<ContentDocument> {
        self.files
            .get(id)
            .map(FileDocument::snapshot)
            .filter(|source| source.revision == revision)
            .cloned()
    }
    pub fn release(&mut self, id: &str) {
        self.files.remove(id);
    }
}
/// Publish completed contents atomically and keep an existing file's write permissions.
fn write_file(path: &Path, text: &str) -> std::io::Result<()> {
    use std::io::Write;
    let permissions = match std::fs::OpenOptions::new().write(true).open(path) {
        Ok(file) => Some(file.metadata()?.permissions()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error),
    };
    let pending = path.with_file_name(format!(".pero-save-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(if permissions.is_some() { 0o600 } else { 0o666 });
        }
        let mut file = options.open(&pending)?;
        file.write_all(text.as_bytes())?;
        if let Some(permissions) = permissions {
            file.set_permissions(permissions)?;
        }
        file.sync_all()?;
        drop(file);
        std::fs::rename(&pending, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(pending);
    }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_file_roundtrip_and_conflict_keep_disk_contents() {
        let path =
            std::env::temp_dir().join(format!("pero-file-document-{}.md", uuid::Uuid::new_v4()));
        std::fs::write(&path, "# Original\n中文").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        }
        let mut files = FileDocuments::default();
        let opened = files.open(&path).unwrap();
        let saved = files
            .save(&opened.id, opened.revision, "# Edited\n中文".into())
            .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved.source());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o640
            );
        }
        std::fs::write(&path, "external edit").unwrap();
        assert!(matches!(
            files.save(&saved.id, saved.revision, "draft".into()),
            Err(FileError::Conflict)
        ));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external edit");
        files.release(&saved.id);
        let reopened = files.open(&path).unwrap();
        assert_eq!(reopened.source(), "external edit");
        assert!(reopened.revision > saved.revision);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn save_as_copies_sources_and_respects_open_target_conflicts() {
        let directory = std::env::temp_dir().join(format!("pero-save-as-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let source = directory.join("source.md");
        let target = directory.join("copy.json");
        std::fs::write(&source, "source baseline").unwrap();
        let mut files = FileDocuments::default();
        let original = files.open(&source).unwrap();
        let copy = |text: &str, protected_sources: Vec<String>| FileCopy {
            path: target.to_string_lossy().into(),
            text: text.into(),
            protected_sources,
        };
        let opened = files
            .save_as(copy("[{\"n\":9007199254740993,\"name\":\"中文\"}]", vec![]))
            .unwrap();
        assert_eq!(opened.format, ContentFormat::Json);
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "source baseline");
        assert_eq!(
            files
                .recovery_source(&original.id, original.revision)
                .unwrap()
                .source(),
            "source baseline"
        );
        for (disk, protected, expected) in [
            (opened.source(), vec![opened.id.clone()], false),
            ("external target edit", vec![], false),
            (opened.source(), vec![], true),
        ] {
            std::fs::write(&target, disk).unwrap();
            assert_eq!(
                files.save_as(copy("replacement", protected)).is_ok(),
                expected
            );
            assert_eq!(
                std::fs::read_to_string(&target).unwrap(),
                if expected { "replacement" } else { disk }
            );
        }
        let missing = FileCopy {
            path: directory.join("missing/out.txt").to_string_lossy().into(),
            text: "draft".into(),
            protected_sources: vec![],
        };
        assert!(matches!(files.save_as(missing), Err(FileError::Io(_))));
        std::fs::remove_dir_all(directory).unwrap();
    }
}
