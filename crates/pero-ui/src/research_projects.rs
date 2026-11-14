//! Local research presentation. App records remain with their owning backends.
use crate::{app::Workbench, projects::{Project, ProjectTab}, workspace::WorkspaceItem};
use gpui_kit::{
    component::{
        button::*,
        input::{Input, InputEvent, InputState, Textarea, TextareaState},
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
    pub editor: Option<ProjectEditor>,
    pub choosing: bool,
    catalogs: BTreeMap<String, ProjectResourceCatalog>,
    loading: BTreeSet<String>,
    pending: Option<(ResearchProject, Option<String>, bool)>,
    resolving_workspace: Option<(ResearchProject, Option<String>)>,
    error: Option<String>,
}
pub(crate) struct ProjectEditor {
    original: Option<ResearchProject>,
    source_key: Option<String>,
    title: Entity<InputState>,
    goal: Entity<TextareaState>,
    workspace: Entity<InputState>,
    _subscriptions: Vec<Subscription>,
}
impl ResearchProjectsView {
    #[cfg(target_family = "wasm")]
    pub fn snapshot(&self, cx: &App) -> serde_json::Value {
        json!({"choosing":self.choosing,"loading":self.loading,"catalogs":self.catalogs,"error":self.error,
            "saving":self.pending.is_some() || self.resolving_workspace.is_some(),"editor":self.editor.as_ref().map(|editor|json!({
                "title":editor.title.read(cx).value().as_ref(),"goal":editor.goal.read(cx).value().as_ref(),
                "workspace":editor.workspace.read(cx).value().as_ref()}))})
    }
}

impl Workbench {
    pub(crate) fn cancel_research_editor(&mut self) {
        self.research.editor = None;
        self.research.resolving_workspace = None;
    }

    pub(crate) fn saved_research_project(&self) -> Option<&ResearchProject> {
        let id = self.selected_project.as_deref()?.strip_prefix("research:")?;
        self.preferences
            .research_projects
            .iter()
            .find(|project| project.id == id)
    }

    pub(crate) fn edit_research_project(&mut self, new: bool, window: &mut Window, cx: &mut Context<Self>) {
        let original = (!new).then(|| self.saved_research_project().cloned()).flatten();
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
        let goal = cx.new(|cx| TextareaState::new(window, cx).default_value(goal));
        let workspace = cx.new(|cx| InputState::new(window, cx).default_value(workspace));
        let mut subscriptions: Vec<_> = [&title, &workspace]
            .into_iter()
            .map(|input| cx.subscribe(input, |_, _, _: &InputEvent, cx| cx.notify()))
            .collect();
        subscriptions.push(cx.subscribe(&goal, |_, _, _: &InputEvent, cx| cx.notify()));
        title.update(cx, |input, cx| input.focus(window, cx));
        self.research.editor = Some(ProjectEditor {
            original,
            source_key: if new { None } else { self.selected_project.clone() },
            title,
            goal,
            workspace,
            _subscriptions: subscriptions,
        });
        self.research.choosing = false;
        self.research.resolving_workspace = None;
        self.research.error = None;
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

    fn persist_research(&mut self, project: ResearchProject, close_editor: bool, cx: &mut Context<Self>) {
        let mut preferences = self.preferences.clone();
        preferences.research_projects.retain(|p| p.id != project.id);
        preferences.research_projects.push(project.clone());
        self.research.pending = Some((project, self.selected_project.clone(), close_editor));
        self.research.error = None;
        self.save_preferences(preferences, cx);
    }

    fn save_research_editor(&mut self, cx: &mut Context<Self>) {
        let Some(editor) = self.research.editor.as_ref() else {
            return;
        };
        let title = editor.title.read(cx).value().to_string();
        let goal = editor.goal.read(cx).value().to_string();
        let workspace = editor.workspace.read(cx).value().trim().to_string();
        let workspace = (!workspace.is_empty()).then_some(workspace);
        let source_key = editor.source_key.clone();
        let candidate = if let Some(mut original) = editor.original.clone() {
            original.edit(title, goal, workspace).map(|_| original)
        } else {
            ResearchProject::new(self.new_research_id(), title, goal, workspace)
        };
        self.research.resolving_workspace = None;
        match candidate {
            Ok(project) => {
                if let Some(path) = project.workspace.as_ref().filter(|path| **path != self.workspace) {
                    let path = path.clone();
                    self.research.resolving_workspace = Some((project, source_key));
                    self.error = None;
                    self.command(json!({"action":"workspace","path":path}), cx);
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

    pub(crate) fn research_workspace_ready(&mut self, path: &str, cx: &mut Context<Self>) {
        let Some((mut project, source_key)) = self.research.resolving_workspace.take() else {
            return;
        };
        match project.edit(project.title.clone(), project.goal.clone(), Some(path.to_owned())) {
            Ok(()) => {
                self.persist_research(project, true, cx);
                if let Some(pending) = &mut self.research.pending {
                    pending.1 = source_key;
                }
            }
            Err(error) => self.research_error(error, cx),
        }
    }

    pub(crate) fn research_saved(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((project, previous, close_editor)) = self.research.pending.take() else {
            return;
        };
        if !self.preferences.research_projects.contains(&project) {
            return;
        }
        let key = format!("research:{}", project.id);
        if let Some(previous) = previous {
            self.navigation
                .replace_identity(&WorkspaceItem::Project(previous), WorkspaceItem::Project(key.clone()));
        }
        self.navigation.open(WorkspaceItem::Project(key.clone()));
        if close_editor || self.selected_project.as_deref() != Some(key.as_str()) {
            self.project_tab = ProjectTab::Overview;
        }
        self.selected_project = Some(key);
        if close_editor {
            self.research.editor = None;
        }
        self.research.error = None;
        if let Some(path) = project.workspace {
            if path != self.workspace {
                self.command(json!({"action":"workspace","path":path}), cx);
            }
        }
        self.refresh_project_resources(cx);
        self.sync_follow(cx);
        let _ = window;
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

    pub(crate) fn research_editor(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(editor) = self.research.editor.as_ref() else {
            return div().into_any_element();
        };
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let saving =
            (self.research.pending.is_some() || self.research.resolving_workspace.is_some()) && self.error.is_none();
        let field = |label: &str, id: &str, element: AnyElement| {
            div()
                .flex()
                .flex_col()
                .gap(px(4.))
                .child(div().text_color(p.text_muted).child(label.to_string()))
                .child(
                    div()
                        .relative()
                        .child(element)
                        .child(self.view_bounds.projects.probe(id.to_string())),
                )
        };
        div()
            .id("research-editor")
            .w_full()
            .max_w(px(760.))
            .py(px(12.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(field(
                self.t("research.title"),
                "research-title",
                pero_theme::WorkbenchStyle::input(Input::new(&editor.title), cx)
                    .aria_label(self.t("research.title"))
                    .disabled(saving)
                    .into_any_element(),
            ))
            .child(field(
                self.t("research.goal"),
                "research-goal",
                Textarea::new(&editor.goal)
                    .aria_label(self.t("research.goal"))
                    .h(px(80.))
                    .disabled(saving)
                    .into_any_element(),
            ))
            .child(field(
                self.t("research.workspace"),
                "research-workspace",
                pero_theme::WorkbenchStyle::input(Input::new(&editor.workspace), cx)
                    .aria_label(self.t("research.workspace"))
                    .disabled(saving)
                    .into_any_element(),
            ))
            .when_some(
                self.research
                    .error
                    .clone()
                    .or_else(|| self.error.as_ref().map(|error| self.t(error).to_string())),
                |el, error| {
                    el.child(
                        div()
                            .id("research-alert")
                            .role(Role::Alert)
                            .text_color(p.error)
                            .whitespace_normal()
                            .child(error),
                    )
                },
            )
            .child(
                div()
                    .flex()
                    .gap(px(8.))
                    .child(
                        Button::new("research-save")
                            .primary()
                            .label(self.t("research.save"))
                            .loading(saving)
                            .disabled(saving)
                            .relative()
                            .child(self.view_bounds.projects.probe("save".into()))
                            .on_click(cx.listener(|this, _, _, cx| this.save_research_editor(cx))),
                    )
                    .child(
                        Button::new("research-cancel")
                            .ghost()
                            .label(self.t("worker.local.cancel"))
                            .disabled(saving)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.research.editor = None;
                                this.research.error = None;
                                this.research.pending = None;
                                this.research.resolving_workspace = None;
                                cx.notify();
                            })),
                    ),
            )
            .into_any_element()
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
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE));
        if self.research.editor.is_some() {
            return overview.child(self.research_editor(cx)).into_any_element();
        }
        if let Some(saved) = saved {
            let has_goal = !saved.goal.is_empty();
            let has_resources = !saved.resources.is_empty();
            return overview.child(
                div().max_w(px(760.)).flex().flex_col().gap(px(12.))
                    .child(div().font_weight(FontWeight::SEMIBOLD).child(self.t("research.goal")))
                    .child(div().whitespace_normal().text_color(if has_goal { p.text } else { p.text_muted })
                        .child(if has_goal { saved.goal.clone() } else { self.t("research.goal_empty").to_string() }))
                    .child(
                        div().flex().flex_wrap().gap(px(8.))
                            .child(
                                Button::new("research-edit")
                                    .when(!has_goal, |button| button.primary())
                                    .when(has_goal, |button| button.ghost())
                                    .label(self.t(if has_goal { "research.edit" } else { "research.add_goal" }))
                                    .disabled(saving)
                                    .relative().child(self.view_bounds.projects.probe("edit".into()))
                                    .on_click(cx.listener(|this, _, window, cx| this.edit_research_project(false, window, cx))),
                            )
                            .child(
                                Button::new("research-project-agent")
                                    .outline().label(self.t("project.agent"))
                                    .relative().child(self.view_bounds.projects.probe("agent:entry".into()))
                                    .on_click(cx.listener(|this, _, _, cx| this.show_project_agents(cx))),
                            )
                            .child(
                                Button::new("research-continue")
                                    .when(has_goal, |button| button.primary())
                                    .when(!has_goal, |button| button.outline())
                                    .label(self.t(if has_resources { "research.view_resources" } else { "research.link" }))
                                    .relative().child(self.view_bounds.projects.probe("research-continue".into()))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.project_tab = ProjectTab::ResearchResources;
                                        this.research.choosing = !has_resources;
                                        cx.notify();
                                    })),
                            ),
                    ),
            ).into_any_element();
        }
        overview.child(
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
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.project_tab = ProjectTab::Tasks;
                                    cx.notify();
                                })),
                        )
                        .when(workspace.is_some(), |el| {
                            el.child(
                                Button::new("project-start-research")
                                    .ghost()
                                    .label(self.t("research.from_workspace"))
                                    .disabled(saving)
                                    .on_click(cx.listener(|this, _, window, cx| this.edit_research_project(false, window, cx))),
                            )
                        }),
                ),
        ).into_any_element()
    }

    pub(crate) fn research_resources(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let references = self.saved_research_project().map(|project| project.resources.as_slice()).unwrap_or_default();
        let saving = self.research.pending.is_some() && self.error.is_none();
        div()
            .id("research-resources")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p(px(pero_theme::WorkbenchStyle::PAGE))
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
                            .when(references.is_empty() && !self.research.choosing, |button| button.primary())
                            .when(!references.is_empty() || self.research.choosing, |button| button.outline())
                            .label(self.t(if self.research.choosing {
                                "worker.local.cancel"
                            } else {
                                "research.link"
                            }))
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
                            .label(self.t("remote.refresh"))
                            .disabled(saving || !self.research.loading.is_empty())
                            .relative()
                            .child(self.view_bounds.projects.probe("refresh".into()))
                            .on_click(cx.listener(|this, _, _, cx| this.refresh_project_resources(cx))),
                    )),
            )
            .when_some(
                self.error.as_ref().filter(|_| self.research.editor.is_none()),
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
                el.child(div().text_color(p.text_muted).child(self.t("research.links_empty")))
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
        } else {
            "Lab"
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
                    .when_some(current, |el, record| {
                        let href = record.location.clone();
                        el.child(
                            Button::new(("resource-open", index))
                                .ghost()
                                .label(self.t("project.open"))
                                .accessibility_label(format!("{} {}", self.t("project.open"), record.title))
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
                    .child(app_label)
                    .when_some(current, |el, record| {
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
                        .child(self.t("research.changed")),
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
