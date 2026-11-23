//! Profile-owned Project sources. A capture ID freezes exactly one reviewed document.
use pero_contracts::{
    project_source::{
        ProjectSourceId, ProjectWebSource, ProjectWebSourceSummary, ReviewedWebSource,
    },
    research_project::ResearchProject,
};
use sha2::{Digest, Sha256};
use std::{
    io,
    path::{Path, PathBuf},
};

const MAX_SOURCES: usize = 256;

pub struct ProjectSources {
    home: PathBuf,
}

impl ProjectSources {
    pub fn new(settings: &Path) -> Self {
        Self {
            home: settings.with_extension("project-sources"),
        }
    }

    pub fn save(
        &self,
        project: &ResearchProject,
        source: ReviewedWebSource,
        now: u64,
    ) -> io::Result<ProjectWebSourceSummary> {
        let id = &source.capture().id;
        match self.read(project, id) {
            Ok(previous) if previous.source == source => return Ok(previous.summary()),
            Ok(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "This capture was saved with different content. Read the page again to save a new source.",
                ));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
        if self.list(project)?.len() >= MAX_SOURCES {
            return Err(io::Error::other(
                "This Project has reached its web source limit",
            ));
        }
        let path = self.source_path(project, id);
        let snapshot = ProjectWebSource {
            project_id: project.id.clone(),
            sha256: digest(&source),
            source,
            saved_at: now,
        };
        std::fs::create_dir_all(self.home.join(&project.id))?;
        crate::workspace_store::write(&path, &serde_json::to_vec(&snapshot)?)?;
        Ok(snapshot.summary())
    }

    pub fn list(&self, project: &ResearchProject) -> io::Result<Vec<ProjectWebSourceSummary>> {
        let files = match std::fs::read_dir(self.home.join(&project.id)) {
            Ok(files) => files,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(error),
        };
        let mut sources = Vec::new();
        for file in files {
            let path = file?.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue; // Interrupted writes have no published source.
            }
            let id = ProjectSourceId::try_from(
                path.file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned(),
            )
            .map_err(|message| io::Error::new(io::ErrorKind::InvalidData, message))?;
            sources.push(self.read(project, &id)?.summary());
        }
        sources.sort_by(|left, right| {
            right
                .saved_at
                .cmp(&left.saved_at)
                .then(left.id.as_str().cmp(right.id.as_str()))
        });
        Ok(sources)
    }

    pub fn read(
        &self,
        project: &ResearchProject,
        id: &ProjectSourceId,
    ) -> io::Result<ProjectWebSource> {
        let stored: ProjectWebSource =
            serde_json::from_slice(&std::fs::read(self.source_path(project, id))?)?;
        if stored.project_id != project.id
            || &stored.source.capture().id != id
            || stored.sha256 != digest(&stored.source)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "The saved Project source does not match its recorded identity or digest",
            ));
        }
        Ok(stored)
    }

    fn source_path(&self, project: &ResearchProject, id: &ProjectSourceId) -> PathBuf {
        self.home
            .join(&project.id)
            .join(format!("{}.json", id.as_str()))
    }
}

fn digest(source: &ReviewedWebSource) -> String {
    format!("{:x}", Sha256::digest(source.markdown().as_bytes()))
}
