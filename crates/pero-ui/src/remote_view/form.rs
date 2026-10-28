use super::*;

impl Workbench {
    pub(crate) fn remote_form(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = self.palettes.get(self.dark);
        let busy = self.remote.loading() || self.remote.submitting;
        let agent = self.remote_agent();
        let field = |label: &str, child: AnyElement| {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(section_title(p, label))
                .child(child)
        };
        div()
            .id("remote-form")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .px(px(24.))
            .py(px(20.))
            .child(
                div()
                    .max_w(px(720.))
                    .flex()
                    .flex_col()
                    .gap(px(14.))
                    .child(
                        div()
                            .text_size(px(22.))
                            .font_weight(FontWeight::BOLD)
                            .child(self.t("remote.new")),
                    )
                    .child(field(
                        self.t("remote.title"),
                        Input::new(&self.remote.title)
                            .aria_label(self.t("remote.title"))
                            .accessibility_id("remote.title")
                            .disabled(busy)
                            .into_any_element(),
                    ))
                    .child(field(
                        self.t("remote.prompt"),
                        Editor::new(&self.remote.prompt)
                            .h(px(132.))
                            .aria_label(self.t("remote.prompt"))
                            .disabled(busy)
                            .into_any_element(),
                    ))
                    .child(field(
                        self.t("remote.acceptance"),
                        Editor::new(&self.remote.acceptance)
                            .h(px(88.))
                            .aria_label(self.t("remote.acceptance"))
                            .disabled(busy)
                            .into_any_element(),
                    ))
                    .child(
                        div()
                            .flex()
                            .when(narrow, |el| el.flex_col())
                            .gap(px(12.))
                            .child(
                                div().flex_1().min_w_0().child(field(
                                    self.t("remote.project"),
                                    Input::new(&self.remote.project)
                                        .aria_label(self.t("remote.project"))
                                        .disabled(busy)
                                        .into_any_element(),
                                )),
                            )
                            .child(
                                div().flex_1().min_w_0().child(field(
                                    self.t("remote.workspace"),
                                    Input::new(&self.remote.workspace)
                                        .aria_label(self.t("remote.workspace"))
                                        .disabled(busy)
                                        .into_any_element(),
                                )),
                            ),
                    )
                    .child(field(
                        self.t("remote.agent"),
                        div()
                            .flex()
                            .flex_wrap()
                            .gap(px(6.))
                            .when(self.agents.is_empty(), |el| el.child(agent.clone()))
                            .children(self.agents.iter().enumerate().map(|(i, a)| {
                                let id = a.id.clone();
                                Button::new(("remote-agent", i))
                                    .outline()
                                    .small()
                                    .label(a.name.clone())
                                    .toggled(agent == a.id)
                                    .when(agent == a.id, |b| b.bg(p.color("accent-soft")))
                                    .disabled(busy)
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.remote.agent = Some(id.clone());
                                        cx.notify();
                                    }))
                            }))
                            .into_any_element(),
                    ))
                    .when_some(self.remote.form_error, |el, key| {
                        el.child(
                            div()
                                .id("remote-form-error")
                                .role(Role::Alert)
                                .aria_label(self.t(key))
                                .whitespace_normal()
                                .text_color(p.color("error"))
                                .child(self.t(key)),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(10.))
                            .child(
                                Button::new("remote-create")
                                    .primary()
                                    .label(self.t(if busy {
                                        "remote.creating"
                                    } else {
                                        "remote.create"
                                    }))
                                    .disabled(busy)
                                    .on_click(cx.listener(|this, _, _, cx| this.create_remote(cx))),
                            )
                            .child(
                                Button::new("remote-discard")
                                    .ghost()
                                    .label(self.t("remote.close_form"))
                                    .disabled(busy)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.remote.creating = false;
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .text_size(px(12.))
                            .text_color(p.color("text-muted"))
                            .child(self.t("remote.draft_hint")),
                    ),
            )
    }
}
