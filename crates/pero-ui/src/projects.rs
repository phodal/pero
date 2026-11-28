//! Project identity and task selection, independent of rendering and I/O.
use pero_contracts::workbench::{
    ProjectBinding, RemovedProjectSource, RepositoryIdentity, WorkbenchPreferences, WorkspaceRepository,
};
use pero_contracts::workspace_path::WorkspacePath;
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct Project {
    pub key: String,
    pub name: String,
    pub workspace: Option<String>,
    pub workspaces: Vec<String>,
    pub shared_id: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct ProjectRepository {
    pub project_id: String,
    pub repository: RepositoryIdentity,
}

impl Project {
    pub fn catalog(
        workspaces: &[String],
        shared_ids: &[String],
        bindings: &[ProjectBinding],
        workspaces_repositories: &[WorkspaceRepository],
        repositories: &[ProjectRepository],
    ) -> Vec<Self> {
        let mut projects = Vec::new();
        for workspace in workspaces.iter().filter(|path| !path.is_empty()) {
            if projects
                .iter()
                .any(|project: &Self| project.contains_workspace(workspace))
            {
                continue;
            }
            let shared_id = bindings
                .iter()
                // Older preferences may bind both spellings to different projects.
                .find(|binding| binding.workspace == *workspace)
                .or_else(|| bindings.iter().find(|binding| WorkspacePath(&binding.workspace).matches(workspace)))
                .map(|binding| binding.project_id.clone())
                .or_else(|| {
                    let repository = &workspaces_repositories
                        .iter()
                        .find(|entry| WorkspacePath(&entry.workspace).matches(workspace))?
                        .repository;
                    let mut matching = repositories
                        .iter()
                        .filter(|entry| entry.repository == *repository);
                    let first = matching.next()?;
                    // A repository can feed several shared Projects. Only an
                    // unambiguous mapping can replace an explicit binding.
                    matching
                        .all(|entry| entry.project_id == first.project_id)
                        .then(|| first.project_id.clone())
                })
                .filter(|id| !id.is_empty());
            if let Some(project) = projects
                .iter_mut()
                .find(|project| shared_id.is_some() && project.shared_id == shared_id)
            {
                project.workspaces.push(workspace.clone());
                continue;
            }
            projects.push(Self {
                key: format!("workspace:{workspace}"),
                name: workspace
                    .trim_end_matches(['/', '\\'])
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or(workspace)
                    .to_string(),
                workspace: Some(workspace.clone()),
                workspaces: vec![workspace.clone()],
                shared_id,
            });
        }
        for id in shared_ids.iter().filter(|id| !id.is_empty()) {
            if projects
                .iter()
                .any(|project| project.shared_id.as_ref() == Some(id))
            {
                continue;
            }
            projects.push(Self {
                key: format!("shared:{id}"),
                name: id.clone(),
                workspace: None,
                workspaces: vec![],
                shared_id: Some(id.clone()),
            });
        }
        projects
    }

    pub fn with_research(mut catalog: Vec<Self>, preferences: &WorkbenchPreferences) -> Vec<Self> {
        let research = &preferences.research_projects;
        let mut projects = Vec::new();
        for saved in research {
            let directory = saved.workspace.as_ref().and_then(|path| catalog.iter().find(|p| p.contains_workspace(path)))
                .or_else(|| saved.shared_id.as_ref().and_then(|id| catalog.iter().find(|p| p.shared_id.as_ref() == Some(id))));
            projects.push(Self {
                key: format!("research:{}", saved.id), name: saved.title.clone(),
                workspace: saved.workspace.clone(), workspaces: directory.map(|project| project.workspaces.clone()).unwrap_or_else(|| saved.workspace.iter().cloned().collect()),
                shared_id: directory.and_then(|p| p.shared_id.clone()).or_else(|| saved.shared_id.clone()),
            });
        }
        catalog.retain(|project| !research.iter().any(|saved| saved.workspace.as_ref().is_some_and(|path| project.contains_workspace(path)) || saved.shared_id.is_some() && saved.shared_id == project.shared_id));
        catalog.retain(|project| !preferences.removed_project_sources.iter().any(|source| match source {
            RemovedProjectSource::Workspace(path) => project.contains_workspace(path),
            RemovedProjectSource::Shared(id) => project.contains_task(id),
        }));
        projects.extend(catalog);
        projects
    }

    pub fn remove_from(&self, preferences: &mut WorkbenchPreferences) {
        if let Some(id) = self.research_id() {
            preferences.research_projects.retain(|project| project.id != id);
        }
        preferences.removed_project_sources.extend(
            self.workspaces.iter().chain(self.workspace.iter()).cloned().map(RemovedProjectSource::Workspace)
                .chain(self.shared_id.iter().cloned().map(RemovedProjectSource::Shared)),
        );
    }

    pub fn matches_key(&self, key: &str) -> bool {
        self.key == key
            || key
                .strip_prefix("workspace:")
                .is_some_and(|workspace| self.contains_workspace(workspace))
            || key
                .strip_prefix("shared:")
                .is_some_and(|id| self.contains_task(id))
    }

    pub fn contains_workspace(&self, workspace: &str) -> bool {
        self.workspaces.iter().any(|path| WorkspacePath(path).matches(workspace))
    }

    pub fn contains_task(&self, project_id: &str) -> bool {
        self.shared_id.as_deref() == Some(project_id)
    }

    pub fn research_id(&self) -> Option<&str> {
        self.key.strip_prefix("research:")
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ProjectTab {
    #[default]
    Overview,
    ResearchResources,
    Tasks,
    Campaigns,
    Sources,
    Execution,
    Settings,
}

impl ProjectTab {
    pub const ALL: [Self; 6] = [
        Self::Overview, Self::ResearchResources, Self::Tasks, Self::Sources,
        Self::Execution, Self::Settings,
    ];
    pub fn label_key(self) -> &'static str {
        match self {
            Self::Overview => "project.overview",
            Self::ResearchResources => "research.linked",
            Self::Tasks => "nav.tasks",
            Self::Campaigns => "campaign.title",
            Self::Sources => "project.sources",
            Self::Execution => "project.execution",
            Self::Settings => "settings.title",
        }
    }

    pub fn compact_label_key(self) -> &'static str {
        match self {
            Self::ResearchResources => "project.tab.materials",
            Self::Sources => "project.tab.sources",
            Self::Execution => "project.tab.execution",
            tab => tab.label_key(),
        }
    }

    pub fn inspector_tabs(self, tabs: &[(Self, f32)], available: f32, gap: f32) -> Vec<bool> {
        let current = tabs.iter().position(|&(tab, _)| tab == self);
        let mut visible = vec![false; tabs.len()];
        let mut remaining = available;
        if let Some(current) = current.filter(|&index| tabs[index].1 <= remaining) {
            visible[current] = true;
            remaining -= tabs[current].1 + gap;
        }
        for (index, &(_, width)) in tabs.iter().enumerate() {
            if Some(index) == current {
                continue;
            }
            if width > remaining {
                break;
            }
            visible[index] = true;
            remaining -= width + gap;
        }
        visible
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TaskStatusFilter {
    #[default]
    All,
    Ready,
    Running,
    Attention,
    Ended,
}

impl TaskStatusFilter {
    pub const ALL: [Self; 5] = [
        Self::All,
        Self::Ready,
        Self::Running,
        Self::Attention,
        Self::Ended,
    ];
    pub fn label_key(self) -> &'static str {
        match self {
            Self::All => "filter.all",
            Self::Ready => "project.ready",
            Self::Running => "filter.running",
            Self::Attention => "cloud.group.attention",
            Self::Ended => "project.ended",
        }
    }
    pub fn matches(self, phase: crate::cloud::Phase) -> bool {
        use crate::cloud::Group;
        match self {
            Self::All => true,
            Self::Ready => phase.group() == Group::Ready,
            Self::Running => matches!(phase.group(), Group::Running | Group::Queued),
            Self::Attention => phase.group() == Group::Attention,
            Self::Ended => phase.group() == Group::Ended,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_windows_projects_keep_chats_bindings_and_research_identity() {
        let legacy = r"\\?\C:\work\pero";
        let current = r"C:\work\pero";
        for (first, second, binding_path) in [
            (current, legacy, legacy),
            (legacy, current, current),
        ] {
            let workspaces = vec![first.into(), second.into(), r"D:\work\pero".into()];
            let mut preferences = pero_contracts::workbench::WorkbenchPreferences::default();
            preferences.bind(binding_path.into(), "team".into());
            let projects = Project::catalog(&workspaces, &["team".into()], &preferences.projects, &[], &[]);
            assert_eq!(projects.len(), 2);
            assert_eq!(projects[0].shared_id.as_deref(), Some("team"));
            for path in [legacy, current] {
                assert!(projects[0].contains_workspace(path), "old and new chats remain grouped");
                assert!(projects[0].matches_key(&format!("workspace:{path}")), "open tabs keep their project");
            }
            assert!(!projects[0].contains_workspace(r"D:\work\pero"));
            let saved = pero_contracts::research_project::ResearchProject::new(
                "question".into(), "Research question".into(), String::new(), Some(current.into()),
            ).unwrap();
            let research = Project::with_research(projects, &WorkbenchPreferences {
                research_projects: vec![saved],
                ..Default::default()
            });
            assert_eq!(research.len(), 2);
            assert_eq!(research[0].key, "research:question");
            assert_eq!(research[0].shared_id.as_deref(), Some("team"));
            assert!(research[0].contains_workspace(current));

            preferences.bind(first.into(), "updated-team".into());
            assert_eq!(preferences.projects.len(), 1, "rebinding replaces the saved alias");
            assert_eq!(preferences.projects[0].project_id, "updated-team");
            assert!(preferences.valid());
        }
        let repository = RepositoryIdentity::from_git_remote("https://github.com/phodal/pero").unwrap();
        let projects = Project::catalog(&[current.into(), legacy.into()], &["team".into()], &[], &[
            WorkspaceRepository { workspace: legacy.into(), repository: repository.clone() },
        ], &[ProjectRepository { project_id: "team".into(), repository }]);
        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].shared_id.as_deref(), Some("team"));
    }

    #[test]
    fn saved_alias_bindings_prefer_the_selected_workspace_spelling() {
        let legacy = r"\\?\C:\work\pero";
        let current = r"C:\work\pero";
        for reverse_bindings in [false, true] {
            for (selected, alias, expected) in [
                (current, legacy, "current-team"),
                (legacy, current, "legacy-team"),
            ] {
                // Older versions could persist both spellings with different bindings.
                let mut preferences = pero_contracts::workbench::WorkbenchPreferences::default();
                preferences.projects = vec![
                    ProjectBinding { workspace: legacy.into(), project_id: "legacy-team".into() },
                    ProjectBinding { workspace: current.into(), project_id: "current-team".into() },
                ];
                if reverse_bindings { preferences.projects.reverse(); }
                assert!(preferences.valid(), "saved alias pairs must remain loadable");
                let projects = Project::catalog(
                    &[selected.into(), alias.into()], &[], &preferences.projects, &[], &[],
                );
                assert_eq!(projects.len(), 1);
                assert_eq!(projects[0].shared_id.as_deref(), Some(expected));
                assert!(projects[0].contains_workspace(alias));
                preferences.bind(selected.into(), "updated-team".into());
                assert_eq!(preferences.projects.len(), 1);
                assert_eq!(preferences.projects[0].project_id, "updated-team");
                assert!(preferences.valid());
            }
        }
    }

    #[test]
    fn project_identity_requires_an_explicit_shared_binding() {
        let workspaces = vec![
            "/work/pero".into(),
            "/other/pero".into(),
            "/work/pero".into(),
        ];
        let shared = vec!["pero".into(), "point".into()];
        for (bindings, expected) in [
            (vec![], 4),
            (
                vec![ProjectBinding {
                    workspace: "/work/pero".into(),
                    project_id: "pero".into(),
                }],
                3,
            ),
        ] {
            let projects = Project::catalog(&workspaces, &shared, &bindings, &[], &[]);
            assert_eq!(projects.len(), expected);
            assert_ne!(projects[0].key, projects[1].key);
            assert_eq!(projects[0].contains_task("pero"), !bindings.is_empty());
            assert!(!projects[1].contains_task("pero"));
            assert!(!projects[0].contains_task("point"));
        }
    }
    #[test]
    fn research_catalog_preserves_stable_identity_and_unrelated_workspaces() {
        use pero_contracts::research_project::ResearchProject;
        for (title, workspace, second_checkout, shared, legacy_keys) in [
            ("Initial question", Some("/work/project"), false, Some("team"), vec!["workspace:/work/other"]),
            ("Revised question", Some("/work/project"), false, Some("team"), vec!["workspace:/work/other"]),
            ("Moved question", Some("/work/moved"), false, None, vec!["workspace:/work/project", "workspace:/work/other"]),
            ("Literature question", None, false, None, vec!["workspace:/work/project", "workspace:/work/other"]),
            ("Shared checkouts", Some("/work/project"), true, Some("team"), vec!["workspace:/work/other"]),
        ] {
            let mut workspaces = vec!["/work/project".to_string(), "/work/other".into()];
            if second_checkout { workspaces.push("/work/project-two".into()); }
            let bindings = ["/work/project", "/work/project-two"].map(|workspace| ProjectBinding {
                workspace: workspace.into(), project_id: "team".into(),
            });
            let catalog = Project::catalog(&workspaces, &["team".into()], &bindings, &[], &[]);
            let saved = ResearchProject::new("stable-research".into(), title.into(), String::new(), workspace.map(str::to_string)).unwrap();
            let projects = Project::with_research(catalog, &WorkbenchPreferences {
                research_projects: vec![saved],
                ..Default::default()
            });
            assert_eq!(projects[0].key, "research:stable-research", "{title}");
            assert_eq!(projects[0].name, title);
            assert_eq!(projects[0].workspace.as_deref(), workspace);
            assert_eq!(projects[0].shared_id.as_deref(), shared);
            assert_eq!(projects[1..].iter().map(|project| project.key.as_str()).collect::<Vec<_>>(), legacy_keys);
            if workspace == Some("/work/project") {
                assert!(projects[0].matches_key("workspace:/work/project"));
                assert!(projects[0].matches_key("shared:team"));
            }
            if second_checkout {
                assert!(projects[0].contains_workspace("/work/project-two"));
                assert!(projects[0].matches_key("workspace:/work/project-two"));
            }
        }
    }

    #[test]
    fn removing_a_project_hides_its_inferred_sources_and_keeps_other_saved_projects() {
        use pero_contracts::research_project::ResearchProject;
        let first = "/work/one";
        let second = "/work/two";
        let workspaces = [first, second, "/work/unrelated"].map(str::to_owned);
        let bindings = [first, second].map(|workspace| ProjectBinding {
            workspace: workspace.into(),
            project_id: "team".into(),
        });
        let shared = ["team".into()];
        let catalog = || Project::catalog(&workspaces, &shared, &bindings, &[], &[]);
        let mut preferences = WorkbenchPreferences {
            research_projects: ["one", "two"].map(|id| {
                ResearchProject::new(id.into(), id.into(), String::new(), Some(first.into())).unwrap()
            }).to_vec(),
            ..Default::default()
        };
        for (deleted, remaining) in [("research:one", vec!["research:two", "workspace:/work/unrelated"]),
            ("research:two", vec!["workspace:/work/unrelated"])]
        {
            let projects = Project::with_research(catalog(), &preferences);
            projects.iter().find(|project| project.key == deleted).unwrap().remove_from(&mut preferences);
            let projects = Project::with_research(catalog(), &preferences);
            assert_eq!(projects.iter().map(|project| project.key.as_str()).collect::<Vec<_>>(), remaining);
        }
        let without_checkouts = Project::catalog(&workspaces[2..], &shared, &[], &[], &[]);
        let projects = Project::with_research(without_checkouts, &preferences);
        assert_eq!(projects.iter().map(|project| project.key.as_str()).collect::<Vec<_>>(), ["workspace:/work/unrelated"]);
    }

    #[test]
    fn task_filters_distinguish_results_from_attention() {
        use crate::cloud::Phase;
        for (filter, phase, expected) in [
            (TaskStatusFilter::Ready, Phase::Draft, true),
            (TaskStatusFilter::Running, Phase::Queued, true),
            (TaskStatusFilter::Attention, Phase::Failed, true),
            (TaskStatusFilter::Attention, Phase::Succeeded, true),
            (TaskStatusFilter::Ended, Phase::Succeeded, false),
            (TaskStatusFilter::Ended, Phase::Running, false),
        ] {
            assert_eq!(filter.matches(phase), expected);
        }
    }
}

#[cfg(test)]
mod repository_tests {
    use super::*;
    fn repo(remote: &str) -> RepositoryIdentity {
        RepositoryIdentity::from_git_remote(remote).unwrap()
    }

    #[test]
    fn project_groups_reconcile_repository_evidence_without_merging_homonyms() {
        let workspaces: Vec<String> = vec!["/work/pero".into(), "/other/pero".into()];
        let shared = vec!["pero".into(), "research".into()];
        let local = vec![
            WorkspaceRepository {
                workspace: workspaces[0].clone(),
                repository: repo("git@github.com:phodal/pero.git"),
            },
            WorkspaceRepository {
                workspace: workspaces[1].clone(),
                repository: repo("https://github.com/another/pero"),
            },
        ];
        for (remote, bindings, expected, inferred) in [
            (
                vec![ProjectRepository {
                    project_id: "pero".into(),
                    repository: repo("https://github.com/Phodal/Pero.git"),
                }],
                vec![],
                3,
                true,
            ),
            (
                vec![ProjectRepository {
                    project_id: "pero".into(),
                    repository: repo("https://github.com/another-owner/pero"),
                }],
                vec![],
                4,
                false,
            ),
            (
                vec![
                    ProjectRepository {
                        project_id: "pero".into(),
                        repository: repo("https://github.com/phodal/pero"),
                    },
                    ProjectRepository {
                        project_id: "research".into(),
                        repository: repo("ssh://git@github.com/phodal/pero.git"),
                    },
                ],
                vec![],
                4,
                false,
            ),
            (
                vec![ProjectRepository {
                    project_id: "pero".into(),
                    repository: repo("https://github.com/phodal/pero"),
                }],
                vec![ProjectBinding {
                    workspace: "/work/pero".into(),
                    project_id: "research".into(),
                }],
                3,
                false,
            ),
        ] {
            let projects = Project::catalog(&workspaces, &shared, &bindings, &local, &remote);
            assert_eq!(projects.len(), expected);
            assert_eq!(projects[0].contains_task("pero"), inferred);
            assert_eq!(projects[0].matches_key("shared:pero"), inferred);
            assert!(projects[0].matches_key("workspace:/work/pero"));
            assert!(projects[0].contains_workspace("/work/pero"));
            assert!(!projects[0].contains_workspace("/other/pero"));
            assert!(!projects[1].contains_task("pero"));
        }
        let two_checkouts = vec![
            WorkspaceRepository {
                workspace: workspaces[0].clone(),
                repository: repo("git@github.com:phodal/pero.git"),
            },
            WorkspaceRepository {
                workspace: workspaces[1].clone(),
                repository: repo("https://github.com/phodal/pero"),
            },
        ];
        let projects = Project::catalog(
            &workspaces,
            &shared,
            &[],
            &two_checkouts,
            &[ProjectRepository {
                project_id: "pero".into(),
                repository: repo("https://github.com/phodal/pero"),
            }],
        );
        assert_eq!(projects.len(), 2);
        assert!(projects[0].contains_workspace("/other/pero"));
    }
}
