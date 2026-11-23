use super::*;

impl Workbench {
    pub(crate) fn research_editor(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(editor) = self.active_research_editor() else {
            return div().into_any_element();
        };
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let saving = (self.research.pending.is_some()
            || self.research.resolving_workspace.is_some())
            && self.error.is_none();
        let goal_only = editor.mode == ProjectEdit::Goal;
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
            .when(!goal_only, |el| {
                el.child(field(
                    self.t("research.title"),
                    "research-title",
                    pero_theme::WorkbenchStyle::input(Input::new(&editor.title), cx)
                        .aria_label(self.t("research.title"))
                        .disabled(saving)
                        .into_any_element(),
                ))
            })
            .when(editor.mode != ProjectEdit::Details, |el| {
                el.child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_1()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(self.t("research.goal")),
                        )
                        .child(
                            div()
                                .text_size(px(pero_theme::TYPE_CAPTION))
                                .text_color(p.text_muted)
                                .child("Markdown"),
                        )
                        .when(goal_only, |el| {
                            el.child(
                                Button::new("goal-preview")
                                    .ghost()
                                    .small()
                                    .label(self.t(if editor.preview {
                                        "menu.edit"
                                    } else {
                                        "content.preview"
                                    }))
                                    .relative()
                                    .child(self.view_bounds.projects.probe("goal-preview".into()))
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        if let Some(editor) =
                                            this.selected_project.as_ref().and_then(|key| {
                                                this.research.saved_editors.get_mut(key)
                                            })
                                        {
                                            editor.preview = !editor.preview;
                                            if !editor.preview {
                                                editor.goal.update(cx, |input, cx| {
                                                    input.focus(window, cx)
                                                });
                                            }
                                            cx.notify();
                                        }
                                    })),
                            )
                        }),
                )
                .child(if editor.preview {
                    gpui_kit::component::text::TextView::markdown(
                        "goal-preview-body",
                        editor.goal.read(cx).value(),
                    )
                    .selectable(true)
                    .into_any_element()
                } else {
                    div()
                        .relative()
                        .child(
                            Editor::new(&editor.goal)
                                .aria_label(self.t("research.goal"))
                                .h(px(if goal_only { 240. } else { 110. }))
                                .disabled(saving),
                        )
                        .child(self.view_bounds.projects.probe("research-goal".into()))
                        .into_any_element()
                })
            })
            .when(!goal_only, |el| {
                el.child(field(
                    self.t("research.workspace"),
                    "research-workspace",
                    pero_theme::WorkbenchStyle::input(Input::new(&editor.workspace), cx)
                        .aria_label(self.t("research.workspace"))
                        .disabled(saving)
                        .into_any_element(),
                ))
            })
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
                            .label(self.t(if goal_only {
                                "content.save"
                            } else {
                                "research.save"
                            }))
                            .loading(saving)
                            .disabled(saving)
                            .relative()
                            .child(self.view_bounds.projects.probe("save".into()))
                            .on_click(cx.listener(|this, _, _, cx| this.save_research_editor(cx))),
                    )
                    .child(
                        Button::new("research-cancel")
                            .relative()
                            .child(self.view_bounds.projects.probe("edit-cancel".into()))
                            .ghost()
                            .label(self.t("worker.local.cancel"))
                            .disabled(saving)
                            .on_click(cx.listener(|this, _, _, cx| {
                                let source = this
                                    .active_research_editor()
                                    .and_then(|editor| editor.source_key.clone());
                                if let Some(key) = source.as_ref().filter(|key| {
                                    this.research.saved_editors.contains_key(key.as_str())
                                }) {
                                    this.research.saved_editors.remove(key);
                                } else {
                                    this.research.transient_editor = None;
                                }
                                this.research.error = None;
                                if this
                                    .research
                                    .pending
                                    .as_ref()
                                    .is_some_and(|(_, key, _)| key == &source)
                                {
                                    this.research.pending = None;
                                }
                                if this
                                    .research
                                    .resolving_workspace
                                    .as_ref()
                                    .is_some_and(|(_, key)| key == &source)
                                {
                                    this.research.resolving_workspace = None;
                                }
                                cx.notify();
                            })),
                    ),
            )
            .into_any_element()
    }
}
