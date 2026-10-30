//! Host-owned draft journals store edit batches; checkpoints carry only references.
use pero_contracts::{
    workspace_draft::{DraftBuffer, DraftRef, DraftUpdate},
    workspace_session::SourceKey,
};
use serde::{Deserialize, Serialize};
use std::{io, path::PathBuf};

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Journal {
    source: SourceKey,
    id: uuid::Uuid,
}
struct LiveDraft {
    source: SourceKey,
    baseline: DraftBuffer,
    current: DraftBuffer,
}
pub struct WorkspaceDrafts {
    directory: PathBuf,
    journals: Vec<Journal>,
    live: Vec<LiveDraft>,
    loaded: bool,
}
impl WorkspaceDrafts {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            journals: vec![],
            live: vec![],
            loaded: false,
        }
    }
    pub fn needs_source(&self, source: &SourceKey) -> bool {
        !self.live.iter().any(|draft| &draft.source == source)
    }
    fn load(&mut self) -> io::Result<()> {
        if !self.loaded {
            self.journals = match std::fs::read(self.directory.join("index.json")) {
                Ok(bytes) => serde_json::from_slice(&bytes)?,
                Err(error) if error.kind() == io::ErrorKind::NotFound => vec![],
                Err(error) => return Err(error),
            };
            self.loaded = true;
        }
        Ok(())
    }
    fn prepare(&mut self, source: &SourceKey, baseline: Option<&str>) -> io::Result<usize> {
        self.load()?;
        if let Some(index) = self.live.iter().position(|draft| &draft.source == source) {
            return Ok(index);
        }
        let baseline = baseline.ok_or_else(|| {
            io::Error::new(io::ErrorKind::NotFound, "Draft baseline is unavailable")
        })?;
        let buffer = DraftBuffer::from_source(source.clone(), baseline);
        self.live.push(LiveDraft {
            source: source.clone(),
            baseline: buffer.clone(),
            current: buffer,
        });
        Ok(self.live.len() - 1)
    }
    fn replay(&self, index: usize, target: &Option<DraftRef>) -> io::Result<DraftBuffer> {
        let live = &self.live[index];
        if live.current.reference() == *target {
            return Ok(live.current.clone());
        }
        let Some(target) = target else {
            return Ok(live.baseline.clone());
        };
        let journal = self
            .journals
            .iter()
            .find(|journal| journal.source == target.source)
            .ok_or_else(|| {
                io::Error::new(io::ErrorKind::NotFound, "Draft journal is unavailable")
            })?;
        let mut buffer = live.baseline.clone();
        for version in 1..=target.version {
            let bytes = std::fs::read(
                self.directory
                    .join(journal.id.to_string())
                    .join(format!("{version}.json")),
            )?;
            let update: DraftUpdate = serde_json::from_slice(&bytes)?;
            buffer = buffer
                .apply(&update)
                .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        }
        Ok(buffer)
    }
    pub fn apply(&mut self, update: &DraftUpdate, baseline: Option<&str>) -> io::Result<DraftRef> {
        let index = self.prepare(&update.draft.source, baseline)?;
        let before = self.replay(index, &update.base)?;
        let after = before
            .apply(update)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        let journal = match self
            .journals
            .iter()
            .find(|journal| journal.source == update.draft.source)
        {
            Some(journal) => journal.clone(),
            None => {
                let journal = Journal {
                    source: update.draft.source.clone(),
                    id: uuid::Uuid::new_v4(),
                };
                let mut next = self.journals.clone();
                next.push(journal.clone());
                std::fs::create_dir_all(&self.directory)?;
                crate::workspace_store::write(
                    &self.directory.join("index.json"),
                    &serde_json::to_vec(&next)?,
                )?;
                self.journals = next;
                journal
            }
        };
        let directory = self.directory.join(journal.id.to_string());
        std::fs::create_dir_all(&directory)?;
        let path = directory.join(format!("{}.json", update.draft.version));
        let encoded = serde_json::to_vec(update)?;
        // A repeated acknowledged batch reuses its durable version. After a
        // restart at an older checkpoint, its explicit base can start a new branch.
        if std::fs::read(&path).ok().as_deref() != Some(encoded.as_slice()) {
            crate::workspace_store::write(&path, &encoded)?;
        }
        self.live[index].current = after;
        Ok(update.draft.clone())
    }
    pub fn read(&mut self, reference: &DraftRef, baseline: Option<&str>) -> io::Result<String> {
        let index = self.prepare(&reference.source, baseline)?;
        let buffer = self.replay(index, &Some(reference.clone()))?;
        if buffer.reference().as_ref() != Some(reference) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid draft reference",
            ));
        }
        let text = buffer.text().to_string();
        self.live[index].current = buffer;
        Ok(text)
    }
    pub fn retain(&mut self, references: &[DraftRef]) -> io::Result<()> {
        self.load()?;
        let keep = |journal: &Journal| {
            references
                .iter()
                .any(|reference| reference.source == journal.source)
        };
        let removed: Vec<_> = self
            .journals
            .iter()
            .filter(|journal| !keep(journal))
            .map(|journal| journal.id)
            .collect();
        if removed.is_empty() {
            return Ok(());
        }
        let next: Vec<_> = self
            .journals
            .iter()
            .filter(|journal| keep(journal))
            .cloned()
            .collect();
        crate::workspace_store::write(
            &self.directory.join("index.json"),
            &serde_json::to_vec(&next)?,
        )?;
        self.journals = next;
        self.live.retain(|draft| {
            references
                .iter()
                .any(|reference| reference.source == draft.source)
        });
        for id in removed {
            let _ = std::fs::remove_dir_all(self.directory.join(id.to_string()));
        }
        Ok(())
    }
    pub fn clear(&mut self) {
        self.journals.clear();
        self.live.clear();
        self.loaded = false;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{content_origin::ContentOrigin, workspace_draft::DraftEdit};
    #[test]
    fn draft_journal_replays_exact_versions_retries_and_checkpoint_branches() {
        let directory =
            std::env::temp_dir().join(format!("pero-draft-journal-{}", uuid::Uuid::new_v4()));
        let key = SourceKey {
            origin: ContentOrigin::File {
                path: "/example.txt".into(),
            },
            source: "/example.txt".into(),
            revision: 1,
        };
        let baseline = "line 中\n".repeat(10_000);
        let mut store = WorkspaceDrafts::new(directory.clone());
        let first = DraftUpdate {
            base: None,
            draft: DraftRef {
                source: key.clone(),
                version: 1,
            },
            edits: vec![DraftEdit {
                old: 0..4,
                inserted: "标题".into(),
            }],
        };
        store.apply(&first, Some(&baseline)).unwrap();
        let second = DraftUpdate {
            base: Some(first.draft.clone()),
            draft: DraftRef {
                source: key.clone(),
                version: 2,
            },
            edits: vec![DraftEdit {
                old: 6..7,
                inserted: "!".into(),
            }],
        };
        store.apply(&second, None).unwrap();
        store.apply(&second, None).unwrap();
        let expected = baseline.replacen("line ", "标题!", 1);
        assert_eq!(store.read(&second.draft, None).unwrap(), expected);
        drop(store);
        let mut restored = WorkspaceDrafts::new(directory.clone());
        assert_eq!(
            restored.read(&second.draft, Some(&baseline)).unwrap(),
            expected
        );
        assert_eq!(
            restored.read(&first.draft, None).unwrap(),
            baseline.replacen("line", "标题", 1)
        );
        let branch = DraftUpdate {
            edits: vec![DraftEdit {
                old: 6..7,
                inserted: "?".into(),
            }],
            ..second.clone()
        };
        restored.apply(&branch, None).unwrap();
        assert_eq!(
            restored.read(&branch.draft, None).unwrap(),
            baseline.replacen("line ", "标题?", 1)
        );
        let bytes: usize = std::fs::read_dir(&directory)
            .unwrap()
            .map(|entry| {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    std::fs::read_dir(path)
                        .unwrap()
                        .map(|entry| entry.unwrap().metadata().unwrap().len() as usize)
                        .sum()
                } else {
                    0
                }
            })
            .sum();
        assert!(
            bytes < 2000,
            "journal contains edits, not repeated full drafts: {bytes}"
        );
        restored.retain(&[]).unwrap();
        assert!(restored.read(&first.draft, Some(&baseline)).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
