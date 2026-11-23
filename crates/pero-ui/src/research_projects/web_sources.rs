//! Project materials can read reviewed sources without opening a conversation.
#[cfg(all(feature = "native-probe", target_os = "macos"))]
pub(crate) mod shared_probe;
use crate::app::Workbench;
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    project_source::{
        ProjectSourceId, ProjectWebSource, ProjectWebSourceSummary, SharedWebSourceTarget,
    },
};
use serde_json::json;

#[derive(Default)]
pub(super) struct WebSourcesView {
    target: Option<WebSourceTarget>,
    sources: Vec<ProjectWebSourceSummary>,
    preview: Option<ProjectWebSource>,
    pending: Option<(String, Option<ProjectSourceId>)>,
    error: Option<String>,
}

#[derive(Clone, PartialEq, Eq)]
enum WebSourceTarget {
    Local(String),
    Shared(SharedWebSourceTarget),
}

impl WebSourceTarget {
    fn project_id(&self) -> &str {
        match self {
            Self::Local(id) => id,
            Self::Shared(target) => &target.project_id,
        }
    }
}

impl Workbench {
    pub(crate) fn shared_web_source_target(&self, cx: &App) -> Option<SharedWebSourceTarget> {
        let project_id = self.current_project(cx)?.shared_id?;
        let identity = &self.remote.data["identity"];
        if !self.remote.configured()
            || !self.remote.client()
            || !identity["projects"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.as_str() == Some(project_id.as_str()))
            })
        {
            return None;
        }
        let target = SharedWebSourceTarget {
            project_id,
            account_id: identity["id"].as_str()?.to_owned(),
            origin: self.remote.data["connection"]["url"].as_str()?.to_owned(),
        };
        target.route()?;
        Some(target)
    }

    fn web_source_choices(&self, cx: &App) -> [Option<WebSourceTarget>; 2] {
        let local = self
            .saved_research_project()
            .map(|project| WebSourceTarget::Local(project.id.clone()));
        let shared = self
            .shared_web_source_target(cx)
            .map(WebSourceTarget::Shared);
        [local, shared]
    }

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
        self.request_project_web_source(None, None, cx);
    }

    fn request_project_web_source(
        &mut self,
        source: Option<ProjectSourceId>,
        target: Option<WebSourceTarget>,
        cx: &mut Context<Self>,
    ) {
        let choices = self.web_source_choices(cx);
        let target = target.or_else(|| self.research.web_sources.target.clone());
        let target =
            target.filter(|target| choices.iter().flatten().any(|choice| choice == target));
        let target = if source.is_some() {
            target
        } else {
            target.or_else(|| choices.into_iter().flatten().next())
        };
        let Some(target) = target else {
            return;
        };
        let view = &mut self.research.web_sources;
        if view.target.as_ref() != Some(&target) {
            *view = WebSourcesView {
                target: Some(target.clone()),
                ..Default::default()
            };
        }
        self.next_request += 1;
        let id = format!("project-materials-{}", self.next_request);
        view.pending = Some((id.clone(), source.clone()));
        view.error = None;
        let verb = if source.is_some() { "read" } else { "list" };
        let (method, mut request) = match target {
            WebSourceTarget::Local(project) => {
                ("project_sources", json!({"kind":verb,"projectId":project}))
            }
            WebSourceTarget::Shared(target) => (
                "shared_project_sources",
                json!({"kind":verb,"target":target}),
            ),
        };
        if let Some(source) = source {
            request["id"] = json!(source);
        }
        self.command(
            json!({"method":method,"request_id":id,"request":request}),
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
        } else if let Some(expected) = reading {
            serde_json::from_value::<ProjectWebSource>(value["source"].clone())
                .map_err(|error| error.to_string())
                .and_then(|source| {
                    if &source.source.capture().id != expected
                        || !view
                            .target
                            .as_ref()
                            .is_some_and(|target| target.project_id() == source.project_id)
                    {
                        return Err("The source did not match the selected Project".into());
                    }
                    view.preview = Some(source);
                    Ok(())
                })
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
        let choices = self.web_source_choices(cx);
        if !choices.iter().any(Option::is_some) {
            return None;
        }
        let view = &self.research.web_sources;
        let current = view
            .target
            .as_ref()
            .is_some_and(|target| choices.iter().flatten().any(|choice| choice == target));
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
                .when(choices[1].is_some(), |panel| {
                    panel.child(
                        div().flex().items_center().gap(px(8.)).children(
                            choices
                                .into_iter()
                                .enumerate()
                                .filter_map(|(index, target)| {
                                    let target = target?;
                                    let label = self.t(if index == 0 {
                                        "research.web_sources_local"
                                    } else {
                                        "research.web_sources_shared"
                                    });
                                    Some(
                                        Button::new(("web-source-scope", index))
                                            .ghost()
                                            .small()
                                            .label(label)
                                            .selected(view.target.as_ref() == Some(&target))
                                            .on_click(cx.listener(move |this, _, _, cx| {
                                                this.request_project_web_source(
                                                    None,
                                                    Some(target.clone()),
                                                    cx,
                                                );
                                            })),
                                    )
                                }),
                        ),
                    )
                })
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
                                    this.request_project_web_source(Some(id.clone()), None, cx)
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
