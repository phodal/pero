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
        menu::{DropdownMenu, PopupMenuItem},
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
        self.project_tab = if project.research_id().is_some() { ProjectTab::Agent } else { ProjectTab::Overview };
        self.cancel_research_editor();
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
        if let Some(workspace) = project.workspace {
            self.command(json!({"action":"workspace","path":workspace}), cx);
        }
        self.command(json!({"action":"remote_select","task_id":null}), cx);
        if self.project_agent_active() { self.select_project_conversation(cx); }
        self.sync_follow(cx);
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

    fn project_groups(&self, cx: &App) -> [(&'static str, Vec<Project>); 2] {
        let (research, workspaces): (Vec<_>, Vec<_>) = self
            .project_catalog(cx)
            .into_iter()
            .partition(|project| project.research_id().is_some());
        [("research.projects", research), ("project.workspaces", workspaces)]
    }

    pub(crate) fn projects_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        // Chrome borrows the appearance global for its whole lifetime, so each
        // command is styled and released before the next listener borrows `cx`.
        let all_tasks = {
            let chrome = pero_theme::Chrome::from_app(cx);
            pero_theme::action_button(
                "all-project-tasks",
                self.t("project.all_tasks"),
                pero_theme::ActionKind::Ghost,
                chrome,
                cx,
            )
        }
        .on_click(cx.listener(|this, _, _, cx| {
            this.selected_project = None;
            this.project_tab = ProjectTab::Tasks;
            this.navigate(WorkbenchPage::Tasks, cx);
            this.remote.connection.editing = false;
            this.remote.public_contributions = false;
            this.command(json!({"action":"remote_select","task_id":null}), cx);
            this.sync_follow(cx);
        }));
        let open_folder = {
            let chrome = pero_theme::Chrome::from_app(cx);
            pero_theme::action_button(
                "project-open-folder",
                self.t("project.open_folder"),
                pero_theme::ActionKind::Ghost,
                chrome,
                cx,
            )
        }
        .on_click(cx.listener(|this, _, _, cx| {
            this.command(json!({"action":"choose_workspace"}), cx)
        }));
        let new_project = {
            let chrome = pero_theme::Chrome::from_app(cx);
            pero_theme::action_button(
                "project-new",
                self.t("research.new"),
                pero_theme::ActionKind::Primary,
                chrome,
                cx,
            )
        }
        .relative()
        .child(self.view_bounds.projects.probe("new".into()))
        .on_click(cx.listener(|this, _, window, cx| this.edit_research_project(true, window, cx)));
        let sections = self
            .project_groups(cx)
            .into_iter()
            .filter(|(_, projects)| !projects.is_empty())
            .map(|(label, projects)| {
                let count = projects.len();
                let rows = projects
                    .into_iter()
                    .map(|project| {
                        let caption = project
                            .research_id()
                            .and_then(|id| {
                                self.preferences
                                    .research_projects
                                    .iter()
                                    .find(|saved| saved.id == id)
                            })
                            .map(|saved| saved.goal.clone())
                            .filter(|goal| !goal.is_empty())
                            .or(project.workspace)
                            .or(project.shared_id);
                        let key = project.key;
                        let open_label = format!("{} {}", self.t("project.open"), project.name);
                        let row_id = SharedString::from(format!("project-row:{key}"));
                        let action = Button::new("open-project")
                            .ghost()
                            .small()
                            .label(self.t("project.open"))
                            .accessibility_label(open_label)
                            .relative()
                            .child(self.view_bounds.projects.probe(format!("open:{key}")))
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.open_project(key.clone(), window, cx)
                            }));
                        let chrome = pero_theme::Chrome::from_app(cx);
                        pero_theme::list_row(
                            row_id,
                            project.name,
                            caption.map(Into::into),
                            None,
                            false,
                            Some(action.into_any_element()),
                            chrome,
                        )
                        .into_any_element()
                    })
                    .collect::<Vec<_>>();
                let chrome = pero_theme::Chrome::from_app(cx);
                div()
                    .id(SharedString::from(format!("projects-section-{label}")))
                    .w_full()
                    .flex()
                    .flex_col()
                    .child(div().px(chrome.geo(pero_theme::SPACE_12)).py(chrome.geo(pero_theme::SPACE_8))
                        .flex().items_center().gap(chrome.geo(pero_theme::SPACE_8))
                        .text_size(chrome.text(pero_theme::TYPE_TAB)).text_color(chrome.palette.text_muted)
                        .child(self.t(label)).child(count.to_string()))
                    .children(rows)
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let editor = self
            .research
            .editor
            .is_some()
            .then(|| self.research_editor(cx));
        let chrome = pero_theme::Chrome::from_app(cx);
        div()
            .id("projects")
            .flex_1()
            .min_w_0()
            .min_h_0()
            .h_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(chrome.palette.bg)
            .text_color(chrome.palette.text)
            .child(
                div()
                    .id("projects-bar")
                    .w_full()
                    .flex_shrink_0()
                    .min_h(chrome.control(pero_theme::ACTION_BUTTON_HEIGHT))
                    .px(chrome.geo(pero_theme::SPACE_12))
                    .py(px(2.))
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(chrome.geo(pero_theme::ICON_GAP))
                    .bg(chrome.palette.bg)
                    .border_b(px(0.5))
                    .border_color(chrome.palette.border)
                    .child(
                        div()
                            .id("projects-scope")
                            .flex_1()
                            .min_w_0()
                            .text_size(chrome.text(pero_theme::TYPE_BODY))
                            .font_weight(FontWeight::MEDIUM)
                            .line_height(relative(1.25))
                            .text_ellipsis()
                            .child(self.t("nav.projects")),
                    )
                    .child(all_tasks)
                    .child(open_folder)
                    .child(new_project),
            )
            .child(
                div()
                    .id("projects-pane")
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .flex()
                    .flex_col()
                    .bg(chrome.list())
                    .child(
                        div()
                            .id("projects-list")
                            .flex_1()
                            .min_h_0()
                            .w_full()
                            .overflow_y_scroll()
                            .bg(chrome.palette.surface)
                            .when_some(editor, |body, editor| {
                                body.child(
                                    div()
                                        .flex_shrink_0()
                                        .bg(chrome.palette.bg)
                                        .px(chrome.geo(pero_theme::SPACE_16))
                                        .border_b(px(0.5))
                                        .border_color(chrome.palette.border)
                                        .child(editor),
                                )
                            })
                            .child(div().w_full().max_w(px(960.)).mx_auto().p(chrome.geo(pero_theme::SPACE_16))
                                .flex().flex_col().gap(chrome.geo(pero_theme::SPACE_16)).children(sections)),
                    ),
            )
    }

    fn project_switcher(&self, project: &Project, cx: &mut Context<Self>) -> impl IntoElement {
        let owner = cx.entity().downgrade();
        let selected = project.key.clone();
        let groups = self.project_groups(cx).map(|(label, projects)| (self.t(label), projects));
        let mut names = std::collections::BTreeMap::new();
        for project in groups.iter().flat_map(|(_, projects)| projects) {
            *names.entry(project.name.clone()).or_insert(0usize) += 1;
        }
        let browse = self.t("project.browse");
        let appearance = pero_theme::UiAppearance::global(cx);
        Button::new("project-switcher")
            .ghost()
            .h(px(appearance.typography.row_height() + 4.))
            .px(px(4.))
            .text_size(appearance.text(pero_theme::TextRole::Heading))
            .label(project.name.clone())
            .dropdown_caret(true)
            .accessibility_label(format!("{} · {}", self.t("project.switch"), project.name))
            .disabled(self.research.editor.is_some())
            .relative()
            .child(self.view_bounds.projects.probe("project-switcher".into()))
            .dropdown_menu(move |mut menu, _, _| {
                menu = menu.scrollable(true);
                for (label, projects) in &groups {
                    if projects.is_empty() {
                        continue;
                    }
                    menu = menu.item(PopupMenuItem::label(*label));
                    for project in projects {
                        let key = project.key.clone();
                        let current = key == selected;
                        let title = if names[&project.name] > 1 {
                            project.workspace.as_ref().or(project.shared_id.as_ref())
                                .map(|path| format!("{} · {path}", project.name))
                                .unwrap_or_else(|| project.name.clone())
                        } else {
                            project.name.clone()
                        };
                        let owner = owner.clone();
                        menu = menu.item(PopupMenuItem::new(title).checked(current).on_click(
                            move |_, window, cx| {
                                if !current {
                                    let _ = owner.update(cx, |this, cx| this.open_project(key.clone(), window, cx));
                                }
                            },
                        ));
                    }
                }
                let owner = owner.clone();
                menu.separator().item(PopupMenuItem::new(browse).on_click(move |_, _, cx| {
                    let _ = owner.update(cx, |this, cx| this.navigate(WorkbenchPage::Projects, cx));
                }))
            })
    }

    pub(crate) fn select_project_view(&mut self, tab: ProjectTab, cx: &mut Context<Self>) {
        if matches!(tab, ProjectTab::Overview | ProjectTab::Agent) && self.saved_research_project().is_some() {
            self.show_project_agents(cx);
            return;
        }
        self.project_tab = tab;
        if tab == ProjectTab::Sources {
            if let Some(repository) = self.listed_repositories(cx).into_iter().next() {
                self.request_pull_request_list(&repository, self.pull_request_index.state, cx);
            }
        }
        cx.notify();
    }

    pub(crate) fn project_workspace(
        &self,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        if self.project_agent_active() {
            return self.project_agent_view(cx);
        }
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let project = self.current_project(cx);
        let is_research = project.as_ref().is_some_and(|project| project.research_id().is_some());
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
                            self.project_switcher(project, cx).into_any_element()
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
                            .mt(px(8.))
                            .flex()
                            .gap(px(8.))
                            .border_b(px(0.5))
                            .border_color(p.border)
                            .flex_wrap()
                            .children(ProjectTab::ALL.into_iter().enumerate()
                                .filter(|(_, tab)| !matches!(tab, ProjectTab::ResearchResources | ProjectTab::Agent) || is_research)
                                .map(|(i, tab)| {
                                Button::new(("project-tab", i))
                                    .ghost()
                                    .small()
                                    .h(px(pero_theme::UiAppearance::global(cx)
                                        .typography
                                        .row_height()))
                                    .rounded_none()
                                    .label(self.t(tab.label_key()))
                                    .relative().child(self.view_bounds.projects.probe(format!("tab:{}", tab.label_key())))
                                    .toggled(self.project_tab == tab)
                                    .border_b_2()
                                    .border_color(p.color(if self.project_tab == tab {
                                        "action"
                                    } else {
                                        "surface"
                                    }))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.select_project_view(tab, cx);
                                    }))
                            })),
                    ),
            )
            .when(self.project_tab == ProjectTab::Overview, |el| {
                el.child(self.project_overview(project.as_ref(), cx))
            })
            .when(self.project_tab == ProjectTab::Agent, |el| { el.child(self.project_agent_view(cx)) })
            .when(self.project_tab == ProjectTab::ResearchResources, |el| {
                el.child(self.research_resources(cx))
            })
            .when(self.project_tab == ProjectTab::Tasks, |el| {
                el.child(self.project_tasks(narrow, cx))
            })
            .when(self.project_tab == ProjectTab::Sources, |el| {
                el.child(self.project_sources(cx))
            })
            .when(self.project_tab == ProjectTab::Execution, |el| {
                el.child(self.project_execution(cx))
            })
            .when(self.project_tab == ProjectTab::Settings, |el| {
                el.child(self.project_settings(cx))
            })
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
            .flex_1()
            .min_w_0()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
            .flex()
            .flex_col()
            .items_start()
            .gap(px(12.))
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
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.pending_project_workspace = true;
                                this.command(json!({"action":"choose_workspace"}), cx);
                            })),
                    )
                },
            )
            .when(project.is_none(), |el| {
                el.child(div().child(self.t("project.choose_first")))
            })
    }
}
