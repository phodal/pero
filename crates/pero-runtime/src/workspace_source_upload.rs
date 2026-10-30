//! A staged source owns its temporary file until the complete upload is published.
use pero_contracts::{
    content_document::DocumentHeader,
    workspace_source::{SourceChunk, SourceUploadProgress},
};
use std::{
    fs::File,
    io::{self, Write},
    path::PathBuf,
};
pub(crate) struct SourceUpload {
    pub request: String,
    pub header: DocumentHeader,
    pub blob: uuid::Uuid,
    pub progress: SourceUploadProgress,
    file: File,
    path: PathBuf,
    failed: bool,
}
impl SourceUpload {
    pub fn new(
        directory: &std::path::Path,
        request: String,
        header: DocumentHeader,
        total: u64,
    ) -> io::Result<Self> {
        std::fs::create_dir_all(directory)?;
        let blob = uuid::Uuid::new_v4();
        let path = directory.join(format!("{blob}.source-pending"));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(&path)?;
        Ok(Self {
            request,
            header,
            blob,
            progress: SourceUploadProgress::new(total),
            file,
            path,
            failed: false,
        })
    }
    pub fn append(&mut self, chunk: &SourceChunk) -> io::Result<()> {
        if self.failed {
            return Err(io::Error::other("Restart the failed source upload"));
        }
        let next = self
            .progress
            .advance(chunk)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        if let Err(error) = self.file.write_all(chunk.text.as_bytes()) {
            self.failed = true;
            return Err(error);
        }
        self.progress = next;
        Ok(())
    }
    pub fn publish(
        &mut self,
        directory: &std::path::Path,
    ) -> io::Result<(DocumentHeader, uuid::Uuid)> {
        self.file.sync_all()?;
        std::fs::rename(&self.path, directory.join(format!("{}.txt", self.blob)))?;
        Ok((self.header.clone(), self.blob))
    }
    pub fn discard(self) {
        let path = self.path.clone();
        drop(self);
        let _ = std::fs::remove_file(path);
    }
}
