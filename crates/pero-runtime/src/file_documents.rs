//! Host-owned text files. Source validation and actual filesystem I/O live here.
use pero_contracts::{
    content_document::{ContentDocument, ContentFormat},
    file_document::{FileDocument, FileSave, SaveError},
};
use std::{collections::BTreeMap, path::Path};
#[derive(Default)]
pub struct FileDocuments {
    files: BTreeMap<String, FileDocument>,
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
        let file = if let Some(previous) = self.files.get(&id) {
            previous.refreshed(text)
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
            FileDocument::loaded(id.clone(), title, text, format)
        };
        let snapshot = file.snapshot().clone();
        self.files.insert(id, file);
        Ok(snapshot)
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
        let decision =
            previous
                .prepare_save(revision, &disk, text)
                .map_err(|error| match error {
                    SaveError::StaleRevision | SaveError::ChangedOnDisk => FileError::Conflict,
                })?;
        if let FileSave::Write(next) = decision {
            std::fs::write(id, next.snapshot().source())?;
            self.files.insert(id.into(), next);
        }
        Ok(self.files[id].snapshot().clone())
    }
    pub fn release(&mut self, id: &str) {
        self.files.remove(id);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_file_roundtrip_and_conflict_keep_disk_contents() {
        let path =
            std::env::temp_dir().join(format!("pero-file-document-{}.md", uuid::Uuid::new_v4()));
        std::fs::write(&path, "# Original\n中文").unwrap();
        let mut files = FileDocuments::default();
        let opened = files.open(&path).unwrap();
        let saved = files
            .save(&opened.id, opened.revision, "# Edited\n中文".into())
            .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), saved.source());
        std::fs::write(&path, "external edit").unwrap();
        assert!(matches!(
            files.save(&saved.id, saved.revision, "draft".into()),
            Err(FileError::Conflict)
        ));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external edit");
        files.release(&saved.id);
        assert_eq!(files.open(&path).unwrap().source(), "external edit");
        std::fs::remove_file(path).unwrap();
    }
}
