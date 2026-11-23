//! Local research presentation. App records remain with their owning backends.
mod editor;
use crate::{app::Workbench, projects::{Project, ProjectTab}, workspace::WorkspaceItem};
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputEvent, InputState, Editor, EditorState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    project_resources::{ProjectResourceCatalog, ProjectResourceSummary},
    research_project::{ProjectResourceRef, ResearchProject, ResearchProjectError},
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(crate) struct ResearchProjectsView {
    transient_editor: Option<ProjectEditor>,
    saved_editors: BTreeMap<String, ProjectEditor>,
    pub choosing: bool,
    pub unavailable_workspaces: BTreeMap<String, String>,
    catalogs: BTreeMap<String, ProjectResourceCatalog>,
    loading: BTreeSet<String>,
    pending: Option<(ResearchProject, Option<String>, bool)>,
    resolving_workspace: Option<(ResearchProject, Option<String>)>,
    error: Option<String>,
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectEdit { New, Details, Goal }

pub(crate) struct ProjectEditor {
    mode: ProjectEdit,
    preview: bool,
    source_key: Option<String>,
    title: Entity<InputState>,
    goal: Entity<EditorState>,
    workspace: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}
impl Workbench {
    #[cfg(target_family = "wasm")]
    pub(crate) fn research_projects_snapshot(&self, cx: &App) -> serde_json::Value {
        let research = &self.research;
        json!({"choosing":research.choosing,"loading":research.loading,"catalogs":research.catalogs,"error":research.error,
            "saving":research.pending.is_some() || research.resolving_workspace.is_some(),"editor":self.active_research_editor().map(|editor|json!({
                "title":editor.title.read(cx).value().as_ref(),"goal":editor.goal.read(cx).value().as_ref(),
                "workspace":editor.workspace.read(cx).value().as_ref()}))})
    }

    pub(crate) fn active_research_editor(&self) -> Option<&ProjectEditor> {
        let transient = self.research.transient_editor.as_ref();
        match self.navigation.current() {
            Some(WorkspaceItem::Project(key)) => self.research.saved_editors.get(key).or_else(|| {
                transient.filter(|editor| editor.source_key.as_ref() == Some(key))
            }),
            None if self.navigation.page() == crate::workspace::WorkbenchPage::Projects => {
                transient.filter(|editor| editor.source_key.is_none())
            }
            _ => None,
        }
    }

    pub(crate) fn clear_transient_research_editor(&mut self) {
        if let Some(editor) = self.research.transient_editor.take() {
            if self.research.resolving_workspace.as_ref().is_some_and(|(_, key)| *key == editor.source_key) {
                self.research.resolving_workspace = None;
            }
        }
        self.research.error = None;
    }

    pub(crate) fn saved_research_project(&self) -> Option<&ResearchProject> {
        let id = self.selected_project.as_deref()?.strip_prefix("research:")?;
        self.preferences
            .research_projects
            .iter()
            .find(|project| project.id == id)
    }

    pub(crate) fn edit_research_project(&mut self, mode: ProjectEdit, window: &mut Window, cx: &mut Context<Self>) {
        let new = mode == ProjectEdit::New;
        let original = (!new).then(|| self.saved_research_project().cloned()).flatten();
        let source_key = if new { None } else { self.selected_project.clone() };
        self.research.choosing = false;
        self.research.error = None;
        if let Some(editor) = source_key.as_ref().and_then(|key| self.research.saved_editors.get_mut(key)) {
            editor.mode = mode;
            editor.preview = false;
            if mode == ProjectEdit::Goal { editor.goal.update(cx, |input, cx| input.focus(window, cx)); }
            else { editor.title.update(cx, |input, cx| input.focus(window, cx)); }
            cx.notify();
            return;
        }
        let directory = (!new).then(|| self.current_project(cx)).flatten();
        let title = original
            .as_ref()
            .map(|p| p.title.clone())
            .or_else(|| directory.as_ref().map(|p| p.name.clone()))
            .unwrap_or_default();
        let goal = original.as_ref().map(|p| p.goal.clone()).unwrap_or_default();
        let workspace = original
            .as_ref()
            .and_then(|p| p.workspace.clone())
            .or_else(|| directory.and_then(|p| p.workspace))
            .unwrap_or_default();
        let title = cx.new(|cx| InputState::new(window, cx).default_value(title));
        let goal = cx.new(|cx| EditorState::new(window, cx).language("markdown").line_number(false).soft_wrap(true).default_value(goal));
        let workspace = cx.new(|cx| InputState::new(window, cx).default_value(workspace));
        let mut subscriptions: Vec<_> = [&title, &workspace]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();
        subscriptions.push(cx.subscribe(&goal, |_, _, _: &InputEvent, cx| cx.notify()));
        if mode == ProjectEdit::Goal { goal.update(cx, |input, cx| input.focus(window, cx)); }
        else { title.update(cx, |input, cx| input.focus(window, cx)); }
        let editor = ProjectEditor {
            mode, preview: false,
            source_key: source_key.clone(),
            title,
            goal,
            workspace,
            _subscriptions: subscriptions,
        };
        if let Some(key) = source_key.filter(|_| original.is_some()) {
            self.research.saved_editors.insert(key, editor);
        } else {
            self.clear_transient_research_editor();
            self.research.transient_editor = Some(editor);
        }
        cx.notify();
    }

    fn new_research_id(&mut self) -> String {
        self.next_request += 1;
        #[cfg(target_family = "wasm")]
        let now = js_sys::Date::now() as u128;
        #[cfg(not(target_family = "wasm"))]
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        format!("local-{now:x}-{:x}", self.next_request)
    }

    fn research_error(&mut self, error: ResearchProjectError, cx: &mut Context<Self>) {
        self.research.error = Some(
            self.t(match error {
                ResearchProjectError::InvalidTitle => "research.invalid_title",
                ResearchProjectError::InvalidGoal => "research.invalid_goal",
                ResearchProjectError::InvalidWorkspace => "research.invalid_workspace",
                _ => "research.invalid_reference",
            })
            .into(),
        );
        cx.notify();
    }

    pub(crate) fn register_catalog_project(&mut self, entry: Project, cx: &mut Context<Self>) {
        if self.research.pending.is_some() {
            return;
        }
        match ResearchProject::new(self.new_research_id(), entry.name, String::new(), entry.workspace) {
            Ok(mut project) => {
                if project.workspace.is_none() {
                    project.shared_id = entry.shared_id;
                }
                self.persist_research(project, false, cx);
            }
            Err(error) => self.research_error(error, cx),
        }
    }

    fn persist_research(&mut self, project: ResearchProject, close_editor: bool, cx: &mut Context<Self>) {
        let mut preferences = self.preferences.clone();
        preferences.research_projects.retain(|p| p.id != project.id);
        preferences.research_projects.push(project.clone());
        self.research.pending = Some((project, self.selected_project.clone(), close_editor));
        self.research.error = None;
        self.save_preferences(preferences, cx);
    }

    fn save_research_editor(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = self.active_research_editor() else {
            return;
        };
        let goal_only = editor.mode == ProjectEdit::Goal;
        let title = editor.title.read(cx).value().to_string();
        let goal = editor.goal.read(cx).value().to_string();
        let workspace = editor.workspace.read(cx).value().trim().to_string();
        let workspace = (!workspace.is_empty()).then_some(workspace);
        let source_key = editor.source_key.clone();
        let candidate = if let Some(id) = source_key.as_deref().and_then(|key| key.strip_prefix("research:")) {
            let Some(mut project) = self.preferences.research_projects.iter().find(|item| item.id == id).cloned() else {
                self.research_error(ResearchProjectError::InvalidId, cx);
                return;
            };
            if goal_only {
                project.edit(project.title.clone(), goal, project.workspace.clone()).map(|_| project)
            } else {
                project.edit(title, project.goal.clone(), workspace).map(|_| project)
            }
        } else {
            ResearchProject::new(self.new_research_id(), title, goal, workspace)
        };
        self.research.resolving_workspace = None;
        match candidate {
            Ok(project) => {
                if let Some(path) = project.workspace.as_ref().filter(|path| !goal_only && **path != self.workspace) {
                    let path = path.clone();
                    let id = project.id.clone();
                    self.research.resolving_workspace = Some((project, source_key));
                    self.error = None;
                    self.command(json!({"action":"workspace","path":path,"project_id":id}), cx);
                } else {
                    self.persist_research(project, true, cx);
                    if let Some(pending) = &mut self.research.pending {
                        pending.1 = source_key;
                    }
                }
            }
            Err(error) => self.research_error(error, cx),
        }
    }

    pub(crate) fn receive_project_workspace(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        let available = match event.kind.as_str() {
            "project_workspace_available" => true,
            "project_workspace_unavailable" => false,
            _ => return false,
        };
        let Some(id) = event.data["project_id"].as_str() else { return false };
        let resolving = self.research.resolving_workspace.as_ref().is_some_and(|(candidate, _)| {
            candidate.id == id && candidate.workspace.as_deref() == Some(event.text.as_str())
        });
        if resolving {
            let (mut candidate, source) = self.research.resolving_workspace.take().unwrap();
            if available {
                candidate.workspace = Some(self.workspace.clone());
                self.persist_research(candidate, true, cx);
                if let Some(pending) = &mut self.research.pending {
                    pending.1 = source;
                }
            } else {
                self.research.error = Some(format!("{} · {}", self.t("project.workspace_unavailable"), event.text));
            }
        } else if available {
            self.research.unavailable_workspaces.remove(id);
        } else {
            self.research.unavailable_workspaces.insert(id.to_owned(), event.text.clone());
        }
        cx.notify();
        true
    }

    pub(crate) fn research_saved(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((project, _, _)) = self.research.pending.as_ref() else {
            return;
        };
        if !self.preferences.research_projects.contains(project) {
            return;
        }
        let (project, previous, close_editor) = self.research.pending.take().unwrap();
        let key = format!("research:{}", project.id);
        let new_project = previous.as_deref() != Some(key.as_str());
        if new_project && !close_editor && previous.is_some() {
            let previous = previous.unwrap();
            self.navigation.replace_identity(&WorkspaceItem::Project(previous), WorkspaceItem::Project(key));
            if let Some(WorkspaceItem::Project(active)) = self.navigation.current().cloned() {
                self.open_project(active, window, cx);
            }
            return;
        }
        if !new_project {
            if close_editor {
                self.research.saved_editors.remove(&key);
            }
            if !matches!(self.navigation.current(), Some(WorkspaceItem::Project(current)) if current == &key) {
                return;
            }
        }
        if let Some(previous) = previous {
            self.navigation
                .replace_identity(&WorkspaceItem::Project(previous), WorkspaceItem::Project(key.clone()));
        }
        self.navigation.open(WorkspaceItem::Project(key.clone()));
        if self.selected_project.as_deref() != Some(key.as_str()) {
            self.project_tab = self.project_agents.right_tab(&project.id);
        }
        self.selected_project = Some(key);
        if close_editor && new_project {
            self.research.transient_editor = None;
        }
        self.research.error = None;
        if let Some(path) = project.workspace {
            if path != self.workspace {
                self.command(json!({"action":"workspace","path":path,"project_id":project.id}), cx);
            }
        }
        self.refresh_project_resources(cx);
        self.refresh_project_agents(cx);
        self.sync_follow(cx);
        if close_editor && new_project && self.project_agent_active() {
            self.focus_project_composer(window, cx);
        }
    }

    fn link_research_resource(&mut self, reference: ProjectResourceRef, remove: bool, cx: &mut Context<Self>) {
        let candidate = if let Some(project) = self.saved_research_project() {
            Ok(project.clone())
        } else if let Some(project) = self.current_project(cx) {
            ResearchProject::new(self.new_research_id(), project.name, String::new(), project.workspace)
        } else {
            return;
        };
        let mut project = match candidate {
            Ok(p) => p,
            Err(error) => {
                self.research_error(error, cx);
                return;
            }
        };
        if remove {
            project.detach(&reference.app, &reference.kind, &reference.id);
        } else if let Err(error) = project.attach(reference) {
            self.research_error(error, cx);
            return;
        }
        self.persist_research(project, false, cx);
    }

    fn load_research_catalog(&mut self, app: &str, cx: &mut Context<Self>) {
        self.research.loading.insert(app.into());
        self.command(json!({"action":"apps_project_resources","name":app}), cx);
    }

    pub(crate) fn refresh_project_resources(&mut self, cx: &mut Context<Self>) {
        let apps = self
            .saved_research_project()
            .map(|project| project.resources.iter().map(|r| r.app.clone()).collect::<BTreeSet<_>>())
            .unwrap_or_default();
        for app in apps {
            self.load_research_catalog(&app, cx);
        }
    }

    pub(crate) fn receive_research_resources(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind != "project_resources" {
            return false;
        }
        match serde_json::from_value::<ProjectResourceCatalog>(event.data.clone()) {
            Ok(catalog) => {
                self.research.loading.remove(&catalog.app);
                self.research.catalogs.insert(catalog.app.clone(), catalog);
            }
            Err(_) => {
                self.research.loading.clear();
                self.research.error = Some(self.t("research.invalid_reference").into());
            }
        }
        cx.notify();
        true
    }

    pub(crate) fn project_overview(&self, project: Option<&Project>, cx: &mut Context<Self>) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let saved = self.saved_research_project();
        let workspace = project.and_then(|project| project.workspace.as_ref());
        let saving =
            (self.research.pending.is_some() || self.research.resolving_workspace.is_some()) && self.error.is_none();
        let overview = div()
            .id("project-overview")
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .overflow_y_scroll();
        if self.active_research_editor().is_some() {
            return overview.p(px(pero_theme::WorkbenchStyle::PAGE))
                .child(self.research_editor(cx)).into_any_element();
        }
        if let Some(saved) = saved {
            let has_goal = !saved.goal.is_empty();
            let chrome = pero_theme::Chrome::from_app(cx);
            let edit = if has_goal {
                pero_theme::action_button("project-overview-edit", self.t("research.edit"),
                    pero_theme::ActionKind::Ghost, chrome, cx)
            } else {
                pero_theme::ghost_icon_button("project-overview-edit", chrome, cx)
                    .icon(Icon::default().path("icons/plus.svg"))
                    .accessibility_label(self.t("research.add_goal")).tooltip(self.t("research.add_goal"))
            }
                .disabled(saving)
                .relative().child(self.view_bounds.projects.probe("edit".into()))
                .on_click(cx.listener(|this, _, window, cx| this.edit_research_project(ProjectEdit::Goal, window, cx)));
            return overview.child(
                div().flex_shrink_0().p(chrome.geo(pero_theme::SPACE_16))
                    .flex().flex_col().gap(chrome.geo(pero_theme::SPACE_8))
                    .child(div().flex().items_center().gap(chrome.geo(pero_theme::SPACE_8))
                        .child(self.icon("target").text_color(p.text_muted))
                        .child(div().flex_1().text_size(chrome.text(pero_theme::TYPE_BODY))
                            .font_weight(FontWeight::SEMIBOLD).child(self.t("research.goal")))
                        .child(edit))
                    .child(div().whitespace_normal()
                        .text_size(chrome.text(if has_goal { pero_theme::TYPE_BODY } else { pero_theme::TYPE_CAPTION }))
                        .text_color(if has_goal { p.text } else { p.text_muted })
                        .child(if has_goal { gpui_kit::component::text::TextView::markdown("project-goal", saved.goal.clone()).selectable(true).into_any_element() } else { div().child(self.t("research.goal_empty")).into_any_element() })),
            ).into_any_element();
        }
        overview.p(px(pero_theme::WorkbenchStyle::PAGE)).child(
            div().flex().flex_col().gap(px(12.))
                .child(div().font_weight(FontWeight::SEMIBOLD).child(self.t(if workspace.is_some() {
                    "project.workspace"
                } else {
                    "project.shared"
                })))
                .when_some(workspace.cloned(), |el, path| {
                    el.child(div().text_color(p.text_muted).whitespace_normal().child(path))
                })
                .child(
                    div().flex().flex_wrap().gap(px(8.))
                        .child(
                            Button::new("project-view-tasks")
                                .primary()
                                .label(self.t("project.view_tasks"))
                                .relative().child(self.view_bounds.projects.probe("view-tasks".into()))
                                .on_click(cx.listener(|this, _, _, cx| this.select_project_view(ProjectTab::Tasks, cx))),
                        )
                        .when(workspace.is_some(), |el| {
                            el.child(
                                Button::new("project-start-research")
                                    .ghost()
                                    .label(self.t("research.from_workspace"))
                                    .disabled(saving)
                                    .on_click(cx.listener(|this, _, window, cx| this.edit_research_project(crate::research_projects::ProjectEdit::Details, window, cx))),
                            )
                        }),
                ),
        ).into_any_element()
    }

    pub(crate) fn research_resources(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let references = self.saved_research_project().map(|project| project.resources.as_slice()).unwrap_or_default();
        let saving = self.research.pending.is_some() && self.error.is_none();
        let compact = self.project_agent_active();
        div()
            .id("research-resources")
            .when(!compact, |el| el.flex_1().min_h_0().overflow_y_scroll())
            .when(compact, |el| el.flex_shrink_0())
            .p(px(if compact { pero_theme::SPACE_16 } else { pero_theme::WorkbenchStyle::PAGE }))
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .gap(px(8.))
                    .child(
                        div()
                            .flex_1()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.t("research.linked")),
                    )
                    .child(
                        Button::new("research-link")
                            .when(compact, |button| button.ghost().small()
                                .icon(Icon::default().path(if self.research.choosing {"icons/x.svg"} else {"icons/plus.svg"}))
                                .accessibility_label(self.t(if self.research.choosing {"worker.local.cancel"} else {"research.link"}))
                                .tooltip(self.t(if self.research.choosing {"worker.local.cancel"} else {"research.link"})))
                            .when(!compact, |button| button
                                .when(references.is_empty() && !self.research.choosing, |button| button.primary())
                                .when(!references.is_empty() || self.research.choosing, |button| button.outline())
                                .label(self.t(if self.research.choosing {"worker.local.cancel"} else {"research.link"})))
                            .disabled(saving)
                            .relative()
                            .child(self.view_bounds.projects.probe("link".into()))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.research.choosing = !this.research.choosing;
                                cx.notify();
                            })),
                    )
                    .when(!references.is_empty(), |el| el.child(
                        Button::new("research-refresh")
                            .ghost()
                            .when(compact, |button| button.small().icon(Icon::default().path("icons/refresh.svg")).accessibility_label(self.t("remote.refresh")).tooltip(self.t("remote.refresh")))
                            .when(!compact, |button| button.label(self.t("remote.refresh")))
                            .disabled(saving || !self.research.loading.is_empty())
                            .relative()
                            .child(self.view_bounds.projects.probe("refresh".into()))
                            .on_click(cx.listener(|this, _, _, cx| this.refresh_project_resources(cx))),
                    )),
            )
            .when_some(
                self.error.as_ref().filter(|_| self.active_research_editor().is_none()),
                |el, error| {
                    el.child(
                        div()
                            .id("research-alert")
                            .role(Role::Alert)
                            .text_color(p.error)
                            .whitespace_normal()
                            .child(self.t(error).to_string()),
                    )
                },
            )
            .when(references.is_empty() && !self.research.choosing, |el| {
                el.child(div().text_color(p.text_muted).whitespace_normal()
                    .when(compact, |el| el.text_size(pero_theme::Chrome::from_app(cx).text(pero_theme::TYPE_CAPTION)))
                    .child(self.t("research.links_empty")))
            })
            .children(references.iter().enumerate().map(|(index, reference)| {
                let catalog = self.research.catalogs.get(&reference.app);
                let current = catalog.and_then(|catalog| {
                    catalog
                        .resources
                        .iter()
                        .find(|r| r.reference.kind == reference.kind && r.reference.id == reference.id)
                });
                self.research_resource_row(index, reference, current, catalog.and_then(|c| c.error.as_deref()), cx)
            }))
            .when(self.research.choosing, |el| el.child(self.research_resource_picker(cx)))
            .into_any_element()
    }

    fn research_resource_row(
        &self,
        index: usize,
        reference: &ProjectResourceRef,
        current: Option<&ProjectResourceSummary>,
        error: Option<&str>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let loading = self.research.loading.contains(&reference.app);
        let saving =
            (self.research.pending.is_some() || self.research.resolving_workspace.is_some()) && self.error.is_none();
        let missing =
            current.is_none() && !loading && error.is_none() && self.research.catalogs.contains_key(&reference.app);
        let changed = current.is_some_and(|record| record.reference.revision != reference.revision);
        let title = current
            .map(|record| record.title.clone())
            .unwrap_or_else(|| self.t("research.missing_title").to_string());
        let app_label = if reference.app == "paper-agent" {
            self.t("nav.papers")
        } else if reference.app == "control-lab" {
            "Control Lab"
        } else if reference.app == "notebook" {
            "Notebook"
        } else if reference.is_data_dataset() {
            self.t("nav.data")
        } else {
            "Lab"
        };
        let href = if reference.is_notebook_entry() {
            reference.notebook_revision_location()
        } else if reference.is_data_dataset() {
            reference.data_version_location()
        } else {
            current.map(|record| record.location.clone())
        };
        let open_label = format!("{} {title}", self.t("project.open"));
        let linked_identity = if reference.is_notebook_entry() {
            format!("{app_label} · v{}", reference.revision)
        } else if reference.is_data_dataset() {
            format!("{app_label} · {}", reference.revision.get(..12).unwrap_or(&reference.revision))
        } else {
            app_label.to_string()
        };
        let remove = reference.clone();
        div()
            .py(px(8.))
            .border_b(px(0.5))
            .border_color(p.border)
            .flex()
            .flex_col()
            .gap(px(4.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .flex_wrap()
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .whitespace_normal()
                            .font_weight(FontWeight::MEDIUM)
                            .child(title),
                    )
                    .when_some(href, |el, href| {
                        el.child(
                            Button::new(("resource-open", index))
                                .ghost()
                                .label(self.t("project.open"))
                                .accessibility_label(open_label)
                                .relative()
                                .child(self.view_bounds.projects.probe(format!("resource-open:{index}")))
                                .on_click(
                                    cx.listener(move |this, _, window, cx| this.open_workspace_link(&href, window, cx)),
                                ),
                        )
                    })
                    .child(
                        Button::new(("resource-unlink", index))
                            .ghost()
                            .label(self.t("research.unlink"))
                            .disabled(saving)
                            .relative()
                            .child(self.view_bounds.projects.probe(format!("unlink:{index}")))
                            .on_click(
                                cx.listener(move |this, _, _, cx| {
                                    this.link_research_resource(remove.clone(), true, cx)
                                }),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .flex_wrap()
                    .gap(px(12.))
                    .text_size(px(12.))
                    .text_color(p.text_muted)
                    .child(linked_identity)
                    .when_some(current.filter(|_| !reference.is_data_dataset() || !changed), |el, record| {
                        let summary = match record.summary.as_str() {
                            "simulation" => self.t("research.simulation"),
                            "import" => "",
                            _ => record.summary.as_str(),
                        };
                        el.when(!summary.is_empty() && reference.app != "control-lab", |el| {
                            el.child(summary.to_string())
                        })
                        .when(!record.status.is_empty(), |el| {
                            el.child(self.research_status(&record.status))
                        })
                    }),
            )
            .when_some(
                current.and_then(|record| record.verification.as_ref()),
                |el, verdict| {
                    el.child(
                        div()
                            .whitespace_normal()
                            .text_color(if verdict == "FAIL" { p.error } else { p.text })
                            .child(format!("{}: {}", self.t("research.verification"), verdict)),
                    )
                },
            )
            .when(loading, |el| {
                el.child(div().text_color(p.text_muted).child(self.t("research.loading")))
            })
            .when_some(error, |el, error| {
                let app = reference.app.clone();
                el.child(
                    div()
                        .id("research-alert")
                        .role(Role::Alert)
                        .text_color(p.warning)
                        .whitespace_normal()
                        .child(error.to_string()),
                )
                .child(
                    Button::new(("resource-retry", index))
                        .ghost()
                        .label(self.t("research.retry"))
                        .on_click(cx.listener(move |this, _, _, cx| this.load_research_catalog(&app, cx))),
                )
            })
            .when(missing, |el| {
                el.child(
                    div()
                        .id("research-alert")
                        .role(Role::Alert)
                        .text_color(p.warning)
                        .child(self.t("research.missing")),
                )
            })
            .when(changed, |el| {
                let updated = current.unwrap().reference.clone();
                el.child(
                    div()
                        .text_color(p.warning)
                        .whitespace_normal()
                        .child(self.t(if reference.is_notebook_entry() || reference.is_data_dataset() { "research.pinned_changed" } else { "research.changed" })),
                )
                .child(
                    Button::new(("resource-update", index))
                        .ghost()
                        .label(self.t("research.update_reference"))
                        .relative()
                        .child(self.view_bounds.projects.probe(format!("update:{index}")))
                        .disabled(saving)
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.link_research_resource(updated.clone(), false, cx)),
                        ),
                )
            })
            .into_any_element()
    }

    fn research_status(&self, status: &str) -> String {
        let key = match status {
            "idle" => "research.idle",
            "completed" => "research.completed",
            "running" => "filter.running",
            "failed" => "research.failed",
            "draft" => "research.draft",
            "unverified" => "research.unverified",
            "abstract" => "research.abstract",
            "full-text" | "pdf" => "research.full_text",
            "study-saved" => "research.study_saved",
            "report-saved" => "research.report_saved",
            "budget-exhausted" => "research.budget_exhausted",
            "no-trials" => "research.no_trials",
            _ => return status.to_string(),
        };
        self.t(key).into()
    }

    fn research_resource_picker(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let saved = self.saved_research_project();
        div()
            .id("research-resource-picker")
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div().flex().flex_wrap().gap(px(8.)).children(
                    [
                        ("paper-agent", "nav.papers"),
                        ("control-lab", "research.control"),
                        ("lab", "research.lab"),
                        ("notebook", "Notebook"),
                        ("data", "nav.data"),
                    ]
                    .into_iter()
                    .map(|(app, label)| {
                        let available = self
                            .apps
                            .entries
                            .iter()
                            .any(|record| record.name == app && record.enabled);
                        Button::new(SharedString::from(format!("research-catalog:{app}")))
                            .outline()
                            .label(if app == "notebook" { "Notebook" } else { self.t(label) })
                            .disabled(!available || self.research.loading.contains(app))
                            .relative()
                            .child(self.view_bounds.projects.probe(format!("catalog:{app}")))
                            .on_click(cx.listener(move |this, _, _, cx| this.load_research_catalog(app, cx)))
                    }),
                ),
            )
            .child(
                Button::new("research-manage-apps")
                    .ghost()
                    .label(self.t("apps.manage"))
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.navigate(crate::workspace::WorkbenchPage::Apps, cx);
                        this.refresh_apps(cx);
                    })),
            )
            .when(
                self.research.catalogs.is_empty() && self.research.loading.is_empty(),
                |el| {
                    el.child(
                        div()
                            .text_color(p.text_muted)
                            .whitespace_normal()
                            .child(self.t("research.choose_app")),
                    )
                },
            )
            .children(self.research.loading.iter().map(|app| {
                div()
                    .text_color(p.text_muted)
                    .child(format!("{}: {}", app, self.t("research.loading")))
            }))
            .children(self.research.catalogs.iter().map(|(app, catalog)| {
                div()
                    .flex()
                    .flex_col()
                    .gap(px(8.))
                    .when_some(catalog.error.clone(), |el, error| {
                        let app = app.clone();
                        el.child(
                            div()
                                .id("research-alert")
                                .role(Role::Alert)
                                .text_color(p.warning)
                                .whitespace_normal()
                                .child(error),
                        )
                        .child(
                            Button::new(SharedString::from(format!("catalog-retry:{app}")))
                                .ghost()
                                .label(self.t("research.retry"))
                                .on_click(cx.listener(move |this, _, _, cx| this.load_research_catalog(&app, cx))),
                        )
                    })
                    .when(catalog.resources.is_empty() && catalog.error.is_none(), |el| {
                        el.child(div().text_color(p.text_muted).child(format!(
                            "{}: {}",
                            app,
                            self.t("research.catalog_empty")
                        )))
                    })
                    .children(catalog.resources.iter().enumerate().map(|(index, resource)| {
                        let linked = saved.is_some_and(|p| {
                            p.resources.iter().any(|r| {
                                r.app == resource.reference.app
                                    && r.kind == resource.reference.kind
                                    && r.id == resource.reference.id
                            })
                        });
                        let reference = resource.reference.clone();
                        div()
                            .py(px(6.))
                            .border_b(px(0.5))
                            .border_color(p.border)
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .whitespace_normal()
                                    .child(resource.title.clone()),
                            )
                            .child(div().text_color(p.text_muted).child(self.t(
                                if resource.reference.kind == "paper" {
                                    "research.paper"
                                } else if resource.reference.kind == "study" {
                                    "research.study"
                                } else if resource.reference.is_data_dataset() {
                                    "nav.data"
                                } else {
                                    "research.experiment"
                                },
                            )))
                            .child(
                                Button::new(SharedString::from(format!("link-resource:{app}:{index}")))
                                    .ghost()
                                    .label(self.t(if linked {
                                        "research.linked_action"
                                    } else {
                                        "research.link_action"
                                    }))
                                    .disabled(linked || self.research.pending.is_some() && self.error.is_none())
                                    .relative()
                                    .child(
                                        self.view_bounds
                                            .projects
                                            .probe(format!("attach:{app}:{}", resource.reference.id)),
                                    )
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.link_research_resource(reference.clone(), false, cx)
                                    })),
                            )
                    }))
            }))
            .into_any_element()
    }
}
