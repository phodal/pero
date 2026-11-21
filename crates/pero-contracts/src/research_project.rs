//! Local research identity and links to App-owned, versioned objects.
use serde::{Deserialize, Serialize};

const MAX_PROJECTS: usize = 128;
const MAX_RESOURCES: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResearchProjectError {
    InvalidId,
    InvalidTitle,
    InvalidGoal,
    InvalidWorkspace,
    InvalidResource,
    TooManyResources,
}

impl std::fmt::Display for ResearchProjectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidId => "Invalid research project ID",
            Self::InvalidTitle => "Enter a project title of at most 200 characters",
            Self::InvalidGoal => "Research goal must contain at most 4000 characters",
            Self::InvalidWorkspace => "Choose an absolute local directory",
            Self::InvalidResource => "Invalid App resource reference",
            Self::TooManyResources => "A project can link at most 256 resources",
        })
    }
}

impl std::error::Error for ResearchProjectError {}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ProjectResourceRef {
    pub app: String,
    pub kind: String,
    pub id: String,
    pub revision: String,
}

impl ProjectResourceRef {
    pub fn new(
        app: String,
        kind: String,
        id: String,
        revision: String,
    ) -> Result<Self, ResearchProjectError> {
        let reference = Self {
            app,
            kind,
            id,
            revision,
        };
        reference
            .valid()
            .then_some(reference)
            .ok_or(ResearchProjectError::InvalidResource)
    }

    pub fn valid(&self) -> bool {
        if self.is_notebook_entry() {
            return hex32(&self.id) && notebook_revision(&self.revision);
        }
        if self.is_data_dataset() {
            return self.id.strip_prefix("ds-").is_some_and(hex32) && hex32(&self.revision);
        }
        matches!(
            (self.app.as_str(), self.kind.as_str()),
            ("paper-agent", "paper" | "study") | ("control-lab" | "lab", "experiment")
        ) && opaque_id(&self.id)
            && !self.revision.is_empty()
            && self.revision.len() <= 128
            && self
                .revision
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    }

    pub fn is_notebook_entry(&self) -> bool {
        self.app == "notebook" && self.kind == "entry"
    }

    /// A Notebook reference resolves its saved revision, independent of a live catalog.
    pub fn notebook_revision_location(&self) -> Option<String> {
        (self.is_notebook_entry() && self.valid()).then(|| format!(
            "pero-app-location://notebook/main/entry/{}/revision/{}", self.id, self.revision
        ))
    }

    pub fn is_data_dataset(&self) -> bool {
        self.app == "data" && self.kind == "dataset"
    }

    /// Keep the selected asset ID even if the catalog now advertises a newer one.
    pub fn data_version_location(&self) -> Option<String> {
        (self.is_data_dataset() && self.valid()).then(|| format!(
            "pero-app-location://data/main/dataset/{}/version/{}", self.id, self.revision
        ))
    }

    fn same_object(&self, other: &Self) -> bool {
        self.app == other.app && self.kind == other.kind && self.id == other.id
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ResearchProject {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub workspace: Option<String>,
    #[serde(default)]
    pub resources: Vec<ProjectResourceRef>,
}

impl ResearchProject {
    /// IDs and directory selection come from the shell; no clock or filesystem is read.
    pub fn new(
        id: String,
        title: String,
        goal: String,
        workspace: Option<String>,
    ) -> Result<Self, ResearchProjectError> {
        let project = Self {
            id,
            title: title.trim().into(),
            goal: goal.trim().into(),
            workspace,
            resources: vec![],
        };
        project.validate()?;
        Ok(project)
    }

    /// Validate a candidate before changing the existing project or its linked evidence.
    pub fn edit(
        &mut self,
        title: String,
        goal: String,
        workspace: Option<String>,
    ) -> Result<(), ResearchProjectError> {
        let next = Self {
            title: title.trim().into(),
            goal: goal.trim().into(),
            workspace,
            ..self.clone()
        };
        next.validate()?;
        *self = next;
        Ok(())
    }

    pub fn attach(&mut self, reference: ProjectResourceRef) -> Result<(), ResearchProjectError> {
        if !reference.valid() {
            return Err(ResearchProjectError::InvalidResource);
        }
        if let Some(existing) = self
            .resources
            .iter_mut()
            .find(|existing| existing.same_object(&reference))
        {
            *existing = reference;
        } else {
            if self.resources.len() >= MAX_RESOURCES {
                return Err(ResearchProjectError::TooManyResources);
            }
            self.resources.push(reference);
        }
        Ok(())
    }

    pub fn detach(&mut self, app: &str, kind: &str, id: &str) -> bool {
        let count = self.resources.len();
        self.resources.retain(|reference| {
            reference.app != app || reference.kind != kind || reference.id != id
        });
        count != self.resources.len()
    }

    pub fn valid(&self) -> bool {
        self.validate().is_ok()
    }

    pub fn collection_valid(projects: &[Self]) -> bool {
        projects.len() <= MAX_PROJECTS
            && projects.iter().enumerate().all(|(index, project)| {
                project.valid() && !projects[..index].iter().any(|other| other.id == project.id)
            })
    }

    fn validate(&self) -> Result<(), ResearchProjectError> {
        if !opaque_id(&self.id) {
            return Err(ResearchProjectError::InvalidId);
        }
        if self.title.trim().is_empty()
            || self.title.chars().count() > 200
            || self.title.chars().any(char::is_control)
        {
            return Err(ResearchProjectError::InvalidTitle);
        }
        if self.goal.chars().count() > 4000
            || self
                .goal
                .chars()
                .any(|c| c.is_control() && !matches!(c, '\n' | '\t'))
        {
            return Err(ResearchProjectError::InvalidGoal);
        }
        if self.workspace.as_ref().is_some_and(|path| {
            path.len() > 4096
                || path.chars().any(char::is_control)
                || !(path.starts_with('/')
                    || (path.len() >= 3
                        && path.as_bytes()[0].is_ascii_alphabetic()
                        && path.as_bytes()[1] == b':'
                        && matches!(path.as_bytes()[2], b'/' | b'\\')))
        }) {
            return Err(ResearchProjectError::InvalidWorkspace);
        }
        if self.resources.len() > MAX_RESOURCES {
            return Err(ResearchProjectError::TooManyResources);
        }
        if self.resources.iter().enumerate().any(|(index, reference)| {
            !reference.valid()
                || self.resources[..index]
                    .iter()
                    .any(|other| other.same_object(reference))
        }) {
            return Err(ResearchProjectError::InvalidResource);
        }
        Ok(())
    }
}

/// A narrow explicit Notebook association. It cannot edit project settings or other owners.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotebookProjectLink {
    pub project_id: String,
    pub entry_id: String,
    pub revision: u64,
    pub expected_revision: Option<String>,
    pub linked: bool,
    pub read_only: bool,
}
impl NotebookProjectLink {
    pub fn validate(&self) -> Result<(), String> {
        if !opaque_id(&self.project_id) || !hex32(&self.entry_id)
            || !(1..=i32::MAX as u64).contains(&self.revision)
            || self.expected_revision.as_deref().is_some_and(|value| !notebook_revision(value)) {
            return Err("Choose a saved Notebook entry and an existing Host project".into());
        }
        if self.read_only { return Err("Read-only Notebook views cannot change project associations".into()); }
        Ok(())
    }
    pub fn apply(&self, project: &mut ResearchProject) -> Result<(), String> {
        self.validate()?;
        if project.id != self.project_id { return Err("Host project is unavailable".into()); }
        let observed = project.resources.iter().find(|item| item.app == "notebook" && item.kind == "entry" && item.id == self.entry_id);
        if observed.map(|item| item.revision.as_str()) != self.expected_revision.as_deref() {
            return Err("Project association changed. Reload Host projects before choosing again.".into());
        }
        if self.linked {
            project.attach(ProjectResourceRef::new("notebook".into(), "entry".into(), self.entry_id.clone(), self.revision.to_string()).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        } else {
            project.detach("notebook", "entry", &self.entry_id);
        }
        Ok(())
    }
}

fn hex32(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn notebook_revision(value: &str) -> bool {
    !value.starts_with('0')
        && value.bytes().all(|b| b.is_ascii_digit())
        && value.parse::<i32>().is_ok_and(|revision| revision > 0)
}

fn opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn project_data_pin_uses_its_saved_asset_id_until_explicitly_replaced() {
        let dataset_id = format!("ds-{}", "d".repeat(32));
        let resource = |asset_id: String| ProjectResourceRef::new("data".into(), "dataset".into(), dataset_id.clone(), asset_id);
        let old = resource("a".repeat(32)).unwrap();
        let new = resource("b".repeat(32)).unwrap();
        let mut project = ResearchProject::new("p".into(), "Project".into(), "".into(), None).unwrap();
        project.attach(old.clone()).unwrap();
        assert_eq!(project.resources[0].data_version_location(), Some(format!(
            "pero-app-location://data/main/dataset/{dataset_id}/version/{}", old.revision)));
        assert!(resource("latest".into()).is_err());
        assert!(resource(String::new()).is_err());
        assert!(ProjectResourceRef::new("data".into(), "dataset".into(), "a".repeat(32), "b".repeat(32)).is_err());
        project.attach(new.clone()).unwrap();
        assert_eq!(project.resources, vec![new]);
    }


    #[test]
    fn notebook_material_opens_saved_revision_until_explicitly_relinked() {
        let id = "a".repeat(32);
        let mut project = ResearchProject::new("project".into(), "Pinned Notebook".into(), "".into(), None).unwrap();
        let reference = |revision: &str| ProjectResourceRef::new("notebook".into(), "entry".into(), id.clone(), revision.into());
        let saved = reference("3").unwrap();
        project.attach(saved).unwrap();
        let latest = reference("4").unwrap();
        assert_ne!(latest.revision, project.resources[0].revision);
        for (pinned, tail) in [(project.resources[0].clone(), "3"), (latest.clone(), "4")] {
            let location = pinned.notebook_revision_location().unwrap();
            assert_eq!(crate::app_chat::AppLocation::parse(&location).unwrap().location,
                format!("entry/{id}/revision/{tail}"));
        }
        project.attach(latest).unwrap();
        assert_eq!(project.resources.len(), 1);
        assert_eq!(project.resources[0].revision, "4");
        for revision in ["0", "03", "latest", "2147483648", "3/../4"] {
            assert!(reference(revision).is_err(), "Accepted invalid revision {revision}");
        }
        assert!(reference("2147483647").is_ok());
        assert!(ProjectResourceRef::new("notebook".into(), "entry".into(), "opaque".into(), "3".into()).is_err());
    }

    #[test]
    fn notebook_project_associations_preserve_other_owners_and_reject_stale_choices() {
        let mut project = ResearchProject::new("project".into(), "Actual project".into(), "".into(), None).unwrap();
        let paper = ProjectResourceRef::new("paper-agent".into(), "paper".into(), "p1".into(), "digest".into()).unwrap();
        project.attach(paper.clone()).unwrap();
        let mut change = NotebookProjectLink { project_id: "project".into(), entry_id: "a".repeat(32), revision: 2,
            expected_revision: None, linked: true, read_only: false };
        change.apply(&mut project).unwrap();
        assert_eq!(project.resources[0],paper);
        assert_eq!(project.resources[1].revision,"2");
        let saved = project.clone();
        assert!(change.apply(&mut project).is_err());
        assert_eq!(project,saved);
        change.expected_revision=Some("2".into()); change.revision=3;
        change.apply(&mut project).unwrap();
        assert_eq!(project.resources[1].revision,"3");
        change.expected_revision=Some("3".into()); change.linked=false;
        change.read_only=true;
        assert!(change.apply(&mut project).is_err());
        change.read_only=false;
        change.apply(&mut project).unwrap();
        assert_eq!(project.resources,vec![paper]);
        for (id,revision) in [("../entry".to_owned(),1),("a".repeat(32),0)] {
            change.entry_id=id;change.revision=revision;
            assert!(change.validate().is_err());
        }
    }

    #[test]
    fn research_project_links_and_edits_preserve_identity_and_existing_evidence() {
        let mut project = ResearchProject::new(
            "research-1".into(),
            " PID tuning ".into(),
            String::new(),
            Some("/work/control".into()),
        )
        .unwrap();
        let reference = ProjectResourceRef::new(
            "control-lab".into(),
            "experiment".into(),
            "experiment-1".into(),
            "rev-1".into(),
        )
        .unwrap();
        enum Change {
            Link,
            ReplaceRevision,
            InvalidLink,
            Edit,
            InvalidEdit,
            Unlink,
        }
        for (change, title, revision, count) in [
            (Change::Link, "PID tuning", "rev-1", 1),
            (Change::ReplaceRevision, "PID tuning", "rev-2", 1),
            (Change::InvalidLink, "PID tuning", "rev-2", 1),
            (Change::Edit, "Robust PID", "rev-2", 1),
            (Change::InvalidEdit, "Robust PID", "rev-2", 1),
            (Change::Unlink, "Robust PID", "", 0),
        ] {
            match change {
                Change::Link => project.attach(reference.clone()).unwrap(),
                Change::ReplaceRevision => project
                    .attach(ProjectResourceRef {
                        revision: "rev-2".into(),
                        ..reference.clone()
                    })
                    .unwrap(),
                Change::InvalidLink => assert_eq!(
                    project.attach(ProjectResourceRef {
                        kind: "study".into(),
                        ..reference.clone()
                    }),
                    Err(ResearchProjectError::InvalidResource)
                ),
                Change::Edit => project
                    .edit(
                        "Robust PID".into(),
                        "Compare held-out scenarios".into(),
                        Some("/work/control".into()),
                    )
                    .unwrap(),
                Change::InvalidEdit => assert_eq!(
                    project.edit(String::new(), String::new(), None),
                    Err(ResearchProjectError::InvalidTitle)
                ),
                Change::Unlink => {
                    assert!(project.detach(&reference.app, &reference.kind, &reference.id))
                }
            }
            assert_eq!(project.id, "research-1");
            assert_eq!(project.title, title);
            assert_eq!(project.resources.len(), count);
            assert_eq!(
                project
                    .resources
                    .first()
                    .map(|r| r.revision.as_str())
                    .unwrap_or_default(),
                revision
            );
        }
    }

    #[test]
    fn research_project_boundary_rejects_invalid_identity_text_and_references() {
        let base = serde_json::json!({"id":"research-1","title":"Research","goal":"","workspace":null,"resources":[]});
        for (field, value, valid) in [
            ("id", serde_json::json!("../other"), false),
            ("title", serde_json::json!(" "), false),
            ("title", serde_json::json!("r".repeat(201)), false),
            ("goal", serde_json::json!("line 1\nline 2"), true),
            ("goal", serde_json::json!("g".repeat(4001)), false),
            ("workspace", serde_json::json!("relative/path"), false),
            ("workspace", serde_json::json!("/work/data"), true),
            ("workspace", serde_json::json!("C:\\research"), true),
            ("workspace", serde_json::json!("/work/\u{0000}data"), false),
            (
                "resources",
                serde_json::json!([{"app":"paper-agent","kind":"paper","id":"paper1","revision":"sha256:abc"}]),
                true,
            ),
            (
                "resources",
                serde_json::json!([{"app":"paper-agent","kind":"experiment","id":"paper1","revision":"abc"}]),
                false,
            ),
            (
                "resources",
                serde_json::json!([{"app":"lab","kind":"experiment","id":"exp1","revision":""}]),
                false,
            ),
        ] {
            let mut input = base.clone();
            input[field] = value;
            let project: ResearchProject = serde_json::from_value(input).unwrap();
            assert_eq!(project.valid(), valid, "{field}: {project:?}");
        }
        let project: ResearchProject = serde_json::from_value(base).unwrap();
        let another = ResearchProject {
            id: "research-2".into(),
            ..project.clone()
        };
        assert!(ResearchProject::collection_valid(&[
            project.clone(),
            another
        ]));
        assert!(!ResearchProject::collection_valid(&[
            project.clone(),
            project
        ]));
    }
}
