//! Project materials can read reviewed sources without opening a conversation.
use crate::app::Workbench;
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    project_source::{ProjectSourceId, ProjectWebSource, ProjectWebSourceSummary},
};
use serde_json::json;

#[derive(Default)]
pub(super) struct WebSourcesView {
    project: String,
    sources: Vec<ProjectWebSourceSummary>,
    preview: Option<ProjectWebSource>,
    pending: Option<(String, bool)>,
    error: Option<String>,
}

impl Workbench {
    pub(crate) fn fail_project_web_sources(
        &mut self,
        request_id: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        let mut failure = HostEvent::new(
            "project_sources_result",
            request_id.map(str::to_owned),
            String::new(),
        );
        failure.data = json!({"ok":false, "error":self.t("error.connection")});
        self.receive_project_web_sources(&failure, cx);
    }

    pub(crate) fn refresh_project_web_sources(&mut self, cx: &mut Context<Self>) {
        self.request_project_web_source(None, cx);
    }

    fn request_project_web_source(
        &mut self,
        source: Option<ProjectSourceId>,
        cx: &mut Context<Self>,
    ) {
        let Some(project) = self.saved_research_project() else {
            return;
        };
        let project = project.id.clone();
        let view = &mut self.research.web_sources;
        if view.project != project {
            *view = WebSourcesView {
                project: project.clone(),
                ..Default::default()
            };
        }
        self.next_request += 1;
        let id = format!("project-materials-{}", self.next_request);
        view.pending = Some((id.clone(), source.is_some()));
        view.error = None;
        let request = match source {
            Some(id) => json!({"kind":"read","projectId":project,"id":id}),
            None => json!({"kind":"list","projectId":project}),
        };
        self.command(
            json!({"method":"project_sources","request_id":id,"request":request}),
            cx,
        );
    }

    pub(crate) fn receive_project_web_sources(
        &mut self,
        event: &HostEvent,
        cx: &mut Context<Self>,
    ) -> bool {
        if event.kind != "project_sources_result" {
            return false;
        }
        let view = &mut self.research.web_sources;
        let Some((id, reading)) = &view.pending else {
            return true;
        };
        if event.request_id.as_deref() != Some(id) {
            return true;
        }
        let value = &event.data["value"];
        let result = if event.data["ok"] != true {
            Err(event.data["error"]
                .as_str()
                .unwrap_or("Project sources are unavailable")
                .to_owned())
        } else if *reading {
            serde_json::from_value(value["source"].clone())
                .map(|source| view.preview = Some(source))
                .map_err(|error| error.to_string())
        } else {
            serde_json::from_value(value["sources"].clone())
                .map(|sources| view.sources = sources)
                .map_err(|error| error.to_string())
        };
        view.error = result.err();
        view.pending = None;
        cx.notify();
        true
    }

    pub(super) fn project_web_sources(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let project = self.saved_research_project()?;
        let view = &self.research.web_sources;
        let current = view.project == project.id;
        let sources = if current {
            view.sources.as_slice()
        } else {
            &[]
        };
        let preview = view.preview.as_ref().filter(|_| current);
        let pending = current && view.pending.is_some();
        let palette = pero_theme::UiAppearance::global(cx).palette.clone();
        Some(
            div()
                .id("project-web-sources")
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .child(
                            div()
                                .flex_1()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(self.t("research.web_sources")),
                        )
                        .child(
                            Button::new("project-web-sources-refresh")
                                .ghost()
                                .small()
                                .icon(Icon::default().path("icons/refresh.svg"))
                                .accessibility_label(self.t("remote.refresh"))
                                .tooltip(self.t("remote.refresh"))
                                .disabled(pending)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.refresh_project_web_sources(cx)
                                })),
                        ),
                )
                .when(pending, |panel| {
                    panel.child(
                        div()
                            .id("project-web-sources-loading")
                            .role(Role::Status)
                            .text_color(palette.text_muted)
                            .child(self.t("research.web_sources_loading")),
                    )
                })
                .when_some(view.error.as_ref().filter(|_| current), |panel, error| {
                    panel.child(
                        div()
                            .id("project-web-sources-error")
                            .role(Role::Alert)
                            .text_color(palette.error)
                            .whitespace_normal()
                            .child(error.clone()),
                    )
                })
                .when(
                    current && sources.is_empty() && !pending && view.error.is_none(),
                    |panel| {
                        panel.child(
                            div()
                                .text_color(palette.text_muted)
                                .whitespace_normal()
                                .child(self.t("research.web_sources_empty")),
                        )
                    },
                )
                .children(sources.iter().enumerate().map(|(index, source)| {
                    let id = source.id.clone();
                    let selected = preview.is_some_and(|source| source.source.capture().id == id);
                    div()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .child(
                            Button::new(("project-web-source", index))
                                .ghost()
                                .selected(selected)
                                .label(source.title.clone())
                                .tooltip(source.title.clone())
                                .disabled(pending)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.request_project_web_source(Some(id.clone()), cx)
                                })),
                        )
                        .child(
                            div()
                                .px(px(8.))
                                .text_color(palette.text_muted)
                                .whitespace_normal()
                                .child(source.url.clone()),
                        )
                }))
                .when_some(preview, |panel, source| {
                    let capture = source.source.capture();
                    let sections: [(&str, &str); 2] = [
                        ("research.web_sources_reason", capture.reason.as_str()),
                        ("research.web_sources_question", capture.question.as_str()),
                    ];
                    panel.child(
                        div()
                            .id("project-web-source-preview")
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .p(px(12.))
                            .gap(px(8.))
                            .bg(palette.surface_muted)
                            .rounded_md()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(8.))
                                    .child(
                                        div()
                                            .flex_1()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .whitespace_normal()
                                            .child(capture.title.clone()),
                                    )
                                    .child(
                                        Button::new("project-web-source-close")
                                            .ghost()
                                            .small()
                                            .icon(Icon::default().path("icons/x.svg"))
                                            .accessibility_label(
                                                self.t("research.web_sources_close"),
                                            )
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.research.web_sources.preview = None;
                                                cx.notify();
                                            })),
                                    ),
                            )
                            .child(div().whitespace_normal().child(capture.content.clone()))
                            .children(
                                sections
                                    .into_iter()
                                    .filter(|(_, value)| !value.is_empty())
                                    .map(|(key, value)| {
                                        div()
                                            .flex()
                                            .flex_col()
                                            .gap(px(4.))
                                            .child(
                                                div()
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .child(self.t(key)),
                                            )
                                            .child(
                                                div().whitespace_normal().child(value.to_owned()),
                                            )
                                    }),
                            ),
                    )
                })
                .into_any_element(),
        )
    }
}
