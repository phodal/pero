use crate::{
    app::Workbench,
    projects::{Project, ProjectTab},
    remote::string,
    workspace::{WorkbenchPage, WorkspaceItem},
};
use gpui_kit::{
    component::{
        button::*,
        input::Input,
        *,
    },
    prelude::*,
    *,
};
use serde_json::{Value, json};

impl Workbench {
    pub(crate) fn project_catalog(&self, cx: &App) -> Vec<Project> {
        let chats = &self.chat.read(cx).chats;
        let delegated = chats.iter().filter(|chat| chat.project_agent.as_ref().is_some_and(|binding| binding.parent_thread.is_some()))
            .map(|chat| chat.workspace.as_str()).collect::<Vec<_>>();
        // Child worktrees are execution locations under their saved Project,
        // not implicit projects. Explicit persisted project bindings remain below.
        let mut workspaces = std::iter::once(self.workspace.as_str()).chain(chats.iter().map(|chat| chat.workspace.as_str()))
            .filter(|path| !delegated.iter().any(|child| pero_contracts::workspace_path::WorkspacePath(child).matches(path)))
            .map(str::to_owned).collect::<Vec<_>>();
        workspaces.extend(
            self.preferences
                .projects
                .iter()
                .map(|binding| binding.workspace.clone()),
        );
        workspaces.extend(self.preferences.research_projects.iter().filter_map(|project| project.workspace.clone()));
        let mut shared = self.remote.data["identity"]["projects"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|id| id.as_str().map(str::to_string))
            .collect::<Vec<_>>();
        shared.extend(
            self.remote
                .repositories()
                .iter()
                .map(|repo| string(repo, "project_id").to_string()),
        );
        shared.extend(
            self.remote
                .tasks()
                .iter()
                .map(|task| string(task, "project_id").to_string()),
        );
        let repositories = self
            .remote
            .repositories()
            .iter()
            .filter_map(|repo| {
                let owner = string(repo, "owner");
                let name = string(repo, "repo");
                let project_id = string(repo, "project_id");
                if owner.is_empty() || name.is_empty() || project_id.is_empty() {
                    return None;
                }
                Some(crate::projects::ProjectRepository {
                    project_id: project_id.into(),
                    repository: pero_contracts::workbench::RepositoryIdentity::from_git_remote(
                        &format!("https://github.com/{owner}/{name}"),
                    )?,
                })
            })
            .collect::<Vec<_>>();
        Project::with_research(Project::catalog(
            &workspaces,
            &shared,
            &self.preferences.projects,
            &self.workspace_repositories,
            &repositories,
        ), &self.preferences.research_projects)
    }

    pub(crate) fn reconcile_project_selection(&mut self, cx: &App) {
        if let Some(project) = self.current_project(cx) {
            self.selected_project = Some(project.key);
        }
    }

    pub(crate) fn current_project(&self, cx: &App) -> Option<Project> {
        let key = self.selected_project.as_deref()?;
        self.project_catalog(cx)
            .into_iter()
            .find(|project| project.matches_key(key))
    }

    pub(crate) fn task_in_project(&self, task: &Value, cx: &App) -> bool {
        self.selected_project.is_none()
            || self
                .current_project(cx)
                .is_some_and(|project| project.contains_task(string(task, "project_id")))
    }

    pub(crate) fn open_project(
        &mut self,
        key: String,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(project) = self
            .project_catalog(cx)
            .into_iter()
            .find(|project| project.matches_key(&key))
        else {
            return;
        };
        let canonical = WorkspaceItem::Project(project.key.clone());
        self.navigation
            .replace_identity(&WorkspaceItem::Project(key), canonical.clone());
        self.navigation.open(canonical);
        self.selected_project = Some(project.key.clone());
        if project.research_id().is_none() {
            self.register_catalog_project(project, cx);
            self.queue_workspace_checkpoint(cx);
            return;
        }
        self.project_tab = project.research_id().map(|id| self.project_agents.right_tab(id)).unwrap_or_default();
        self.clear_transient_research_editor();
        self.research.choosing = false;
        self.refresh_project_resources(cx);
        self.refresh_project_agents(cx);
        self.local_roadmap.show_cloud = project.workspace.is_none() && self.remote.configured();
        self.local_roadmap.selected_line = None;
        self.task_status = Default::default();
        self.remote.creating = false;
        self.remote.connection.editing = false;
        self.remote.public_contributions = false;
        if let Some(id) = &project.shared_id {
            self.remote
                .project
                .update(cx, |input, cx| input.set_value(id.clone(), window, cx));
        } else {
            self.remote
                .project
                .update(cx, |input, cx| input.set_value("", window, cx));
        }
        let binding = project.shared_id.clone().unwrap_or_default();
        self.project_binding
            .update(cx, |input, cx| input.set_value(binding, window, cx));
        if let Some(workspace) = &project.workspace {
            self.command(json!({"action":"workspace","path":workspace,"project_id":project.research_id()}), cx);
        }
        self.command(json!({"action":"remote_select","task_id":null}), cx);
        if self.project_agent_active() { self.select_project_conversation(cx); }
        self.sync_follow(cx);
        if self.project_agent_active() {
            self.focus_project_composer(window, cx);
        }
        cx.notify();
    }

    pub(crate) fn open_task(&mut self, id: String, cx: &mut Context<Self>) {
        self.recent_tasks.retain(|task| task != &id);
        self.recent_tasks.insert(0, id.clone());
        self.recent_tasks.truncate(8);
        if let Some(task) = self
            .remote
            .tasks()
            .iter()
            .find(|task| string(task, "id") == id)
        {
            if !self.task_in_project(task, cx) {
                self.selected_project = self
                    .project_catalog(cx)
                    .into_iter()
                    .find(|project| project.contains_task(string(task, "project_id")))
                    .map(|project| project.key);
            }
        }
        self.navigation.open(WorkspaceItem::Task(id.clone()));
        self.project_tab = ProjectTab::Tasks;
        self.local_roadmap.show_cloud = true;
        self.remote.creating = false;
        self.remote.connection.editing = false;
        self.remote.public_contributions = false;
        self.remote.confirm_cancel = None;
        self.command(json!({"action":"remote_select","task_id":id}), cx);
        self.sync_follow(cx);
    }

    pub(crate) fn projects_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        div().id("project-start").size_full().overflow_y_scroll()
            .bg(pero_theme::UiAppearance::global(cx).palette.surface)
            .when(self.active_research_editor().is_some(), |el| {
                el.child(div().p(px(16.)).child(self.research_editor(cx)))
            })
    }

    pub(crate) fn select_project_view(&mut self, tab: ProjectTab, cx: &mut Context<Self>) {
        if self.project_agent_active() {
            if let Some(id) = self.saved_research_project().map(|project| project.id.clone()) {
                self.project_agents.right_tabs.insert(id, tab);
            }
        }
        self.project_tab = tab;
        if tab == ProjectTab::ResearchResources {
            self.refresh_project_web_sources(cx);
        }
        if tab == ProjectTab::Sources {
            if let Some(repository) = self.listed_repositories(cx).into_iter().next() {
                self.request_pull_request_list(&repository, self.pull_request_index.state, cx);
            }
        }
        cx.notify();
    }

    pub(crate) fn project_view_tabs(&self, research: bool, cx: &mut Context<Self>) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let compact = self.project_agent_active();
        let third = match self.project_tab {
            ProjectTab::Sources | ProjectTab::Execution | ProjectTab::Settings => self.project_tab,
            _ => ProjectTab::Tasks,
        };
        div()
            .id("project-view-tabs")
            .role(Role::TabList)
            .aria_label(self.t("project.actions"))
            .flex()
            .items_center()
            .gap_x(px(pero_theme::SPACE_4))
            .when(compact, |tabs| tabs.flex_1().min_w_0().h_full())
            .when(!compact, |tabs| {
                tabs.flex_shrink_0().flex_wrap().border_b(px(0.5)).border_color(p.border)
            })
            .children(ProjectTab::ALL.into_iter().enumerate()
                .filter(|(_, tab)| {
                    if compact {
                        matches!(tab, ProjectTab::Overview | ProjectTab::ResearchResources) || *tab == third
                    } else {
                        *tab != ProjectTab::ResearchResources || research
                    }
                })
                .map(|(i, tab)| {
                    let label = self.t(tab.label_key());
                    let selected = self.project_tab == tab;
                    let button = if compact {
                        pero_theme::pane_view_tab(("project-tab", i), self.t(tab.compact_label_key()), selected,
                            pero_theme::Chrome::from_app(cx), cx)
                    } else {
                        Button::new(("project-tab", i)).role(Role::Tab).ghost().small().flex_shrink_0()
                            .h(px(pero_theme::UiAppearance::global(cx).typography.row_height()))
                            .rounded_none().label(label).selected(selected).toggled(selected)
                            .border_b_2().border_color(if selected { p.action } else { p.text.opacity(0.) })
                    };
                    button.accessibility_label(label).tooltip(label)
                        .relative().child(self.view_bounds.projects.probe(format!("tab:{}", tab.label_key())))
                        .on_click(cx.listener(move |this, _, _, cx| this.select_project_view(tab, cx)))
                }))
            .into_any_element()
    }

    pub(crate) fn project_tab_content(&self, narrow: bool, cx: &mut Context<Self>) -> AnyElement {
        match self.project_tab {
            ProjectTab::Overview => self.project_overview(self.current_project(cx).as_ref(), cx),
            ProjectTab::ResearchResources => div().id("project-resource-tab").flex_1().min_h_0()
                .flex().flex_col().overflow_y_scroll().child(self.research_resources(cx)).into_any_element(),
            ProjectTab::Tasks => self.project_tasks(narrow, cx).into_any_element(),
            ProjectTab::Sources => self.project_sources(cx).into_any_element(),
            ProjectTab::Execution => self.project_execution(cx).into_any_element(),
            ProjectTab::Settings => self.project_settings(cx).into_any_element(),
        }
    }

    pub(crate) fn project_workspace(
        &self,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        if self.project_agent_active() {
            return self.project_agent_view(cx);
        }
        let project = self.current_project(cx);
        let is_research = project.as_ref().is_some_and(|project| project.research_id().is_some())
            || self.shared_web_source_target(cx).is_some();
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .px(px(pero_theme::WorkbenchStyle::PAGE))
                    .pt(px(pero_theme::WorkbenchStyle::PAGE))
                    .pb(px(10.))
                    .flex_shrink_0()
                    .child(div().flex().items_center().min_w_0().child(
                        if let Some(project) = &project {
                            div().child(project.name.clone()).into_any_element()
                        } else {
                            div()
                            .text_size(
                                pero_theme::UiAppearance::global(cx)
                                    .text(pero_theme::TextRole::Heading),
                            )
                            .font_weight(FontWeight::MEDIUM)
                            .child(self.t("project.all_tasks"))
                            .into_any_element()
                        },
                    ))
                    .child(
                        div()
                            .mt(px(8.)).child(self.project_view_tabs(is_research, cx)),
                    ),
            )
            .child(self.project_tab_content(narrow, cx))
            .into_any_element()
    }

    fn project_sources(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let project = self.current_project(cx);
        let repositories = self
            .remote
            .repositories()
            .iter()
            .filter(|repo| {
                project
                    .as_ref()
                    .is_none_or(|project| project.contains_task(string(repo, "project_id")))
            })
            .collect::<Vec<_>>();
        div()
            .id("project-sources")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.t("project.sources")),
                    )
                    .when(self.remote.operator(), |el| {
                        el.child(
                            Button::new("project-sync")
                                .outline()
                                .small()
                                .label(self.t("remote.sync_issues"))
                                .disabled(
                                    self.remote.loading()
                                        || self.remote.data["github"]["running"] == true,
                                )
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.command(json!({"action":"remote_sync_issues"}), cx)
                                })),
                        )
                    }),
            )
            .when(repositories.is_empty(), |el| {
                el.child(
                    div()
                        .py(px(12.))
                        .text_color(p.text_muted)
                        .child(self.t("project.no_sources")),
                )
            })
            .children(repositories.iter().map(|repo| {
                div()
                    .py(px(8.))
                    .border_b(px(0.5))
                    .border_color(p.border)
                    .child(format!(
                        "{}/{}",
                        string(repo, "owner"),
                        string(repo, "repo")
                    ))
                    .child(
                        div()
                            .mt(px(4.))
                            .text_size(
                                pero_theme::UiAppearance::global(cx)
                                    .text(pero_theme::TextRole::Caption),
                            )
                            .text_color(p.text_muted)
                            .child(string(repo, "roadmap_path").to_string()),
                    )
            }))
            .child(self.pull_request_index(cx))
            .child(
                div().mt(px(pero_theme::WorkbenchStyle::SECTION)).child(
                    Button::new("project-source-connection")
                        .ghost()
                        .small()
                        .label(self.t("settings.connections"))
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.show_settings_page(WorkbenchPage::Connections, window, cx);
                        })),
                ),
            )
    }

    fn project_execution(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let project = self.current_project(cx);
        let workers = self
            .remote
            .workers()
            .iter()
            .filter(|worker| {
                project.as_ref().is_none_or(|project| {
                    worker["projects"].as_array().is_some_and(|ids| {
                        ids.iter()
                            .any(|id| project.shared_id.as_deref() == id.as_str())
                    })
                })
            })
            .collect::<Vec<_>>();
        div()
            .id("project-execution")
            .id("project-execution-scroll")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.t("project.workspace")),
            )
            .child(
                div().mt(px(8.)).text_color(p.text_muted).child(
                    project
                        .as_ref()
                        .and_then(|project| project.workspace.clone())
                        .unwrap_or_else(|| self.t("project.no_workspace").into()),
                ),
            )
            .child(
                div()
                    .mt(px(pero_theme::WorkbenchStyle::SECTION))
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.t("nav.workers")),
            )
            .when(workers.is_empty(), |el| {
                el.child(
                    div()
                        .py(px(8.))
                        .text_color(p.text_muted)
                        .child(self.t("project.no_workers")),
                )
            })
            .children(workers.iter().map(|worker| {
                div()
                    .py(px(12.))
                    .border_b(px(0.5))
                    .border_color(p.border)
                    .child(string(worker, "name").to_string())
            }))
            .child(
                div()
                    .mt(px(pero_theme::WorkbenchStyle::SECTION))
                    .text_color(p.text_muted)
                    .whitespace_normal()
                    .child(self.t("project.environment_limit")),
            )
            .child(
                div().mt(px(16.)).child(
                    Button::new("project-resource-settings")
                        .outline()
                        .small()
                        .label(self.t("settings.resources"))
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.show_settings_page(WorkbenchPage::Workers, window, cx);
                        })),
                ),
            )
    }

    fn project_settings(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let project = self.current_project(cx);
        div()
            .id("project-settings")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
            .flex()
            .flex_col()
            .items_start()
            .gap(px(12.))
            .when(self.saved_research_project().is_some(), |el| el.child(
                Button::new("edit-project-details").ghost().label(self.t("research.edit_details"))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.select_project_view(ProjectTab::Overview, cx);
                        this.edit_research_project(crate::research_projects::ProjectEdit::Details, window, cx);
                    }))))
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.t("project.binding")),
            )
            .child(
                div()
                    .text_color(p.text_muted)
                    .whitespace_normal()
                    .child(self.t("project.binding_hint")),
            )
            .when(
                project
                    .as_ref()
                    .is_some_and(|project| project.workspace.is_some()),
                |el| {
                    el.child(
                        pero_theme::WorkbenchStyle::input(Input::new(&self.project_binding), cx)
                            .aria_label(self.t("project.binding"))
                            .accessibility_id("project.binding")
                            .w(px(320.))
                            .max_w_full(),
                    )
                    .child(
                        Button::new("save-project-binding")
                            .primary()
                            .small()
                            .label(self.t(match self.preferences_status {
                                crate::settings_menu::PreferenceSaveState::Saving => {
                                    "project.saving"
                                }
                                crate::settings_menu::PreferenceSaveState::Saved => "project.saved",
                                crate::settings_menu::PreferenceSaveState::Idle => "project.save",
                            }))
                            .disabled(
                                self.preferences_status
                                    == crate::settings_menu::PreferenceSaveState::Saving,
                            )
                            .on_click(cx.listener(|this, _, _, cx| {
                                let Some(workspace) = this
                                    .current_project(cx)
                                    .and_then(|project| project.workspace)
                                else {
                                    return;
                                };
                                let id = this.project_binding.read(cx).value().trim().to_string();
                                let mut preferences = this.preferences.clone();
                                preferences.bind(workspace, id);
                                this.save_preferences(preferences, cx);
                            })),
                    )
                },
            )
            .when(
                project
                    .as_ref()
                    .is_some_and(|project| project.workspace.is_none()),
                |el| {
                    el.child(
                        Button::new("bind-project-folder")
                            .outline()
                            .label(self.t("project.open_folder"))
                            .on_click(cx.listener(|this, _, window, cx| {
                                if this.saved_research_project().is_some() {
                                    this.select_project_view(ProjectTab::Overview, cx);
                                    this.edit_research_project(crate::research_projects::ProjectEdit::Details, window, cx);
                                } else {
                                    this.pending_project_workspace = true;
                                    this.command(json!({"action":"choose_workspace"}), cx);
                                }
                            })),
                    )
                },
            )
            .when(project.is_none(), |el| {
                el.child(div().child(self.t("project.choose_first")))
            })
    }
}
