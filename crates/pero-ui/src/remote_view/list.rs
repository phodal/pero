use super::*;

impl Workbench {
    pub(crate) fn remote_list(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        use crate::projects::TaskStatusFilter;
        let owner = cx.entity().clone();
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let loading = self.remote.loading();
        let query = self.remote.search.read(cx).value().to_lowercase();
        let unbound = self
            .current_project(cx)
            .is_some_and(|project| project.shared_id.is_none());
        let project = self.current_project(cx);
        let all_projects = self.selected_project.is_none();
        let visible = self
            .remote
            .tasks()
            .iter()
            .filter(|task| {
                (all_projects
                    || project
                        .as_ref()
                        .is_some_and(|project| project.contains_task(string(task, "project_id"))))
                    && self.remote.task_visible(task)
                    && self.task_status.matches(phase(task))
                    && (query.is_empty() || string(task, "title").to_lowercase().contains(&query))
            })
            .collect::<Vec<_>>();
        let toolbar = div()
            .px(px(pero_theme::WorkbenchStyle::PAGE))
            .py(px(6.))
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                div().flex_1().min_w_0().child(
                    pero_theme::WorkbenchStyle::input(Input::new(&self.remote.search), cx)
                        .prefix(self.icon("search"))
                        .w_full(),
                ),
            )
            .child(
                Button::new("remote-refresh")
                    .ghost()
                    .small()
                    .label(self.t(if loading {
                        "remote.refreshing"
                    } else {
                        "remote.refresh"
                    }))
                    .disabled(loading)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.command(json!({"action":"remote_refresh"}), cx)
                    })),
            )
            .when(self.remote.operator(), |el| {
                el.child(
                    Button::new("remote-new")
                        .primary()
                        .small()
                        .icon(IconName::Plus)
                        .label(self.t("remote.new"))
                        .disabled(loading || unbound)
                        .on_click(
                            cx.listener(|this, _, window, cx| this.start_remote_form(window, cx)),
                        ),
                )
            });
        let filters = div()
            .px(px(pero_theme::WorkbenchStyle::PAGE))
            .pb(px(12.))
            .flex()
            .flex_wrap()
            .gap(px(6.))
            .children(
                TaskStatusFilter::ALL
                    .into_iter()
                    .enumerate()
                    .map(|(i, status)| {
                        Button::new(("task-status", i))
                            .ghost()
                            .small()
                            .label(self.t(status.label_key()))
                            .toggled(self.task_status == status)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.task_status = status;
                                cx.notify();
                            }))
                    }),
            );
        let sources = div()
            .px(px(pero_theme::WorkbenchStyle::PAGE))
            .pb(px(10.))
            .flex()
            .flex_wrap()
            .gap(px(6.))
            .when(self.remote.client(), |el| {
                el.children(
                    ["remote.available", "remote.mine", "filter.all"]
                        .into_iter()
                        .enumerate()
                        .map(|(i, key)| {
                            Button::new(("remote-filter", i))
                                .ghost()
                                .xsmall()
                                .label(self.t(key))
                                .toggled(self.remote.filter == i)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.remote.filter = i;
                                    cx.notify();
                                }))
                        }),
                )
            })
            .when(!self.remote.repositories().is_empty(), |el| {
                el.children(
                    [
                        ("", "filter.all"),
                        ("github", "remote.issues"),
                        ("roadmap", "remote.roadmap"),
                    ]
                    .into_iter()
                    .enumerate()
                    .map(|(i, (kind, key))| {
                        Button::new(("remote-source-filter", i))
                            .ghost()
                            .xsmall()
                            .label(self.t(key))
                            .toggled(string(&self.remote.data, "source_kind") == kind)
                            .disabled(loading)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.command(
                                    json!({"action":"remote_filter","source_kind":kind,"tag":""}),
                                    cx,
                                )
                            }))
                    }),
                )
            });
        let header = div()
            .h(px(38.))
            .px(px(12.))
            .flex()
            .items_center()
            .gap(px(12.))
            .bg(p.surface_muted)
            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
            .text_color(p.text_muted)
            .child(div().flex_1().child(self.t("cloud.col.task")))
            .child(div().w(px(105.)).child(self.t("cloud.col.status")))
            .when(!narrow, |el| {
                el.child(div().w(px(100.)).child(self.t("field.agent")))
                    .child(div().w(px(150.)).child(self.t("project.execution_target")))
            });
        let scroll = div()
            .id("remote-task-scroll")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&self.task_scroll)
            .on_scroll(cx.listener(|this, _, _, cx| this.request_more_tasks(cx)))
            .px(px(pero_theme::WorkbenchStyle::PAGE))
            .pb(px(16.))
            .child(header)
            .when(visible.is_empty(), |el| {
                el.child(
                    div()
                        .py(px(32.))
                        .text_color(p.text_muted)
                        .whitespace_normal()
                        .child(self.t(if loading {
                            "remote.loading"
                        } else if unbound {
                            "project.no_binding"
                        } else {
                            "remote.no_matching_tasks"
                        }))
                        .when(unbound, |el| {
                            el.child(
                                div().mt(px(12.)).child(
                                    Button::new("link-task-project")
                                        .outline()
                                        .small()
                                        .label(self.t("project.binding"))
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.project_tab =
                                                crate::projects::ProjectTab::Settings;
                                            cx.notify();
                                        })),
                                ),
                            )
                        }),
                )
            })
            .children(
                visible
                    .into_iter()
                    .enumerate()
                    .map(|(i, task)| self.task_row(task, i, narrow, cx).into_any_element()),
            )
            .when(self.remote.data["has_more"] == true, |el| {
                el.child(
                    div().py(px(6.)).child(
                        Button::new("remote-load-more")
                            .ghost()
                            .small()
                            .label(self.t(if loading {
                                "remote.loading"
                            } else {
                                "project.more_tasks"
                            }))
                            .disabled(loading || self.task_more_pending)
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.task_more_pending = true;
                                this.command(json!({"action":"remote_more"}), cx);
                            })),
                    ),
                )
            });
        div()
            .id("remote-list")
            .on_prepaint(move |_, window, cx| {
                owner.update(cx, |this, cx| this.follow_task_pages(window, cx))
            })
            .w_full()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(toolbar)
            .child(filters)
            .when(
                self.remote.client() || !self.remote.repositories().is_empty(),
                |el| el.child(sources),
            )
            .when(!string(&self.remote.data, "tag").is_empty(), |el| {
                el.child(
                    div().px(px(pero_theme::WorkbenchStyle::PAGE)).pb(px(8.)).child(
                        Button::new("remote-clear-tag")
                            .outline()
                            .xsmall()
                            .label(format!("#{} ×", string(&self.remote.data, "tag")))
                            .accessibility_label(self.t("remote.clear_tag"))
                            .on_click(cx.listener(|this, _, _, cx| {
                                let kind = string(&this.remote.data, "source_kind").to_string();
                                this.command(
                                    json!({"action":"remote_filter","source_kind":kind,"tag":""}),
                                    cx,
                                );
                            })),
                    ),
                )
            })
            .child(scroll)
    }

    pub(crate) fn task_row(
        &self,
        task: &Value,
        i: usize,
        narrow: bool,
        cx: &mut Context<Self>,
    ) -> Button {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let id = string(task, "id").to_string();
        let title = string(task, "title").to_string();
        let state = phase(task);
        let context = source_context(task);
        let source = source_label(task);
        let worker = string(&task["run"], "worker_id");
        let target = if worker.is_empty() {
            string(task, "workspace_key").to_string()
        } else {
            self.worker_name(worker)
        };
        let label = format!("{} · {}\n{}", title, self.t(state.label_key()), context);
        Button::new(("remote-task", i))
            .ghost()
            .w_full()
            .h(px(56.))
            .rounded_none()
            .px(px(12.))
            .border_b_1()
            .border_color(p.border)
            .accessibility_label(label)
            .child(
                div()
                    .w_full()
                    .flex()
                    .items_center()
                    .gap(px(12.))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .truncate()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(title),
                            )
                            .when(!source.is_empty(), |el| {
                                el.child(
                                    div()
                                        .mt(px(4.))
                                        .truncate()
                                        .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                        .text_color(p.text_muted)
                                        .child(source),
                                )
                            }),
                    )
                    .child(
                        div()
                            .w(px(105.))
                            .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                            .text_color(p.color(tone_colors(state.tone()).1))
                            .child(self.t(state.label_key())),
                    )
                    .when(!narrow, |el| {
                        el.child(
                            div()
                                .w(px(100.))
                                .truncate()
                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                .child(string(task, "agent_id").to_string()),
                        )
                        .child(
                            div()
                                .w(px(150.))
                                .truncate()
                                .text_size(pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption))
                                .text_color(p.text_muted)
                                .child(target),
                        )
                    }),
            )
            .on_click(cx.listener(move |this, _, _, cx| this.open_task(id.clone(), cx)))
    }

    pub(crate) fn follow_task_pages(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.task_list_mounted()
            || self.task_more_pending
            || self.remote.loading()
            || self.remote.data["error"].is_string()
            || !self.remote.data["has_more"].as_bool().unwrap_or(false)
        {
            return;
        }
        // Bounds are from the previous layout. An unmeasured list needs one
        // frame before deciding it does not fill the viewport.
        let unmeasured = self.task_scroll.bounds().size.height <= px(1.);
        if !unmeasured && !self.task_scroll_wants_more() {
            return;
        }
        cx.on_next_frame(window, |this, _, cx| this.request_more_tasks(cx));
    }

    fn task_list_mounted(&self) -> bool {
        if self.navigation.page() != WorkbenchPage::Tasks
            || self.project_tab != crate::projects::ProjectTab::Tasks
            || !self.remote.configured()
            || self.remote.connection.editing
        {
            return false;
        }
        if self.remote.client() && self.remote.public_contributions {
            return false;
        }
        !self.remote.creating && !matches!(self.navigation.current(), Some(WorkspaceItem::Task(_)))
    }

    fn task_scroll_wants_more(&self) -> bool {
        if self.task_more_pending
            || self.remote.loading()
            || self.remote.data["error"].is_string()
            || !self.remote.data["has_more"].as_bool().unwrap_or(false)
            || self.task_scroll.bounds().size.height <= px(1.)
        {
            return false;
        }
        // Offset is negative toward the bottom. A short list has no overflow.
        self.task_scroll.max_offset().y + self.task_scroll.offset().y <= px(240.)
    }

    fn request_more_tasks(&mut self, cx: &mut Context<Self>) {
        if !self.task_scroll_wants_more() {
            return;
        }
        self.task_more_pending = true;
        self.command(json!({"action": "remote_more"}), cx);
    }
}
