//! Cloud task screens: the grouped task list, a Task's delegation detail and
//! the Worker list. State and commands stay in `remote.rs`.
mod detail;
mod form;
mod list;
mod workers;
use crate::{
    app::Workbench,
    cloud::{Phase, Tone},
    remote::{
        dispatchable, observed_source, remote_event_summary, source_changed, source_closed,
        source_context, source_label, string, task_tags,
    },
    theme::Palette,
    workspace::{WorkbenchPage, WorkspaceItem},
};
use gpui_kit::{
    component::{
        button::*,
        input::{Editor, Input},
        tag::Tag,
        *,
    },
    prelude::*,
    *,
};
use serde_json::{Value, json};

pub(crate) fn phase(task: &Value) -> Phase {
    Phase::of(string(task, "state"), source_closed(task))
}

pub(crate) fn tone_colors(tone: Tone) -> (&'static str, &'static str) {
    match tone {
        Tone::Muted => ("surface-muted", "text-muted"),
        Tone::Info => ("info-bg", "info"),
        Tone::Warning => ("warning-bg", "warning"),
        Tone::Success => ("success-bg", "success"),
        Tone::Danger => ("error-bg", "error"),
    }
}

pub(crate) fn phase_tag(p: &Palette, label: &str, tone: Tone) -> Tag {
    let (bg, fg) = tone_colors(tone);
    Tag::custom(p.color(bg), p.color(fg), p.color(bg))
        .small()
        .rounded(px(4.))
        .child(label.to_string())
}

/// Local wall-clock time of an RFC 3339 timestamp, or nothing when absent.
pub(crate) fn local_time(iso: &str) -> String {
    #[cfg(not(target_family = "wasm"))]
    {
        return chrono::DateTime::parse_from_rfc3339(iso)
            .map(|date| {
                date.with_timezone(&chrono::Local)
                    .format("%H:%M")
                    .to_string()
            })
            .unwrap_or_default();
    }
    #[cfg(target_family = "wasm")]
    {
        if iso.is_empty() {
            return String::new();
        }
        let date = js_sys::Date::new(&wasm_bindgen::JsValue::from_str(iso));
        if date.get_time().is_nan() {
            return String::new();
        }
        format!("{:02}:{:02}", date.get_hours(), date.get_minutes())
    }
}

pub(crate) fn section_title(p: &Palette, text: &str, font_size: Pixels) -> Div {
    div()
        .text_size(font_size)
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(p.text_muted)
        .child(text.to_string())
}

impl Workbench {
    pub(crate) fn worker_count(&self) -> usize {
        self.remote.workers().len()
    }
    pub(crate) fn worker_name(&self, id: &str) -> String {
        self.remote
            .workers()
            .iter()
            .find(|w| string(w, "id") == id)
            .map(|w| string(w, "name").to_string())
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| id.to_string())
    }
    pub fn remote_view(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let detail_visible = self.remote.creating
            || matches!(self.navigation.current(), Some(WorkspaceItem::Task(_)));
        let configured = self.remote.configured();
        let editing = self.remote.connection.editing;
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .when(self.remote.data["error"].is_string(), |el| {
                el.child(
                    div()
                        .id("remote-error")
                        .role(Role::Alert)
                        .aria_label(string(&self.remote.data, "error").to_string())
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .px(px(20.))
                        .py(px(10.))
                        .bg(p.error_bg)
                        .text_color(p.error)
                        .whitespace_normal()
                        .child(string(&self.remote.data, "error").to_string()),
                )
            })
            .when(
                self.remote.operator()
                    && !self.remote.data["error"].is_string()
                    && (self.remote.data["github"]["errors"]
                        .as_array()
                        .is_some_and(|e| !e.is_empty())
                        || self.remote.repositories().iter().any(|r| {
                            r["partial"].as_bool().unwrap_or(false)
                                || !string(r, "error").is_empty()
                        })),
                |el| {
                    el.child(
                        div()
                            .id("remote-source-error")
                            .role(Role::Alert)
                            .aria_label(self.t("remote.sync_incomplete"))
                            .px(px(20.))
                            .py(px(10.))
                            .bg(p.warning_bg)
                            .text_color(p.warning)
                            .whitespace_normal()
                            .child(self.t("remote.sync_incomplete")),
                    )
                },
            )
            .when(editing, |el| el.child(self.remote_connection_view(cx)))
            .when(!configured && !editing,|el|el.child(div().p(px(pero_theme::WorkbenchStyle::PAGE)).flex().flex_col().gap(px(12.))
                .child(div().text_color(p.text_muted).child(self.t("project.connect_tasks")))
                .child(Button::new("project-connect").outline().label(self.t("settings.connections"))
                    .on_click(cx.listener(|this,_,window,cx|{this.navigate(WorkbenchPage::Connections,cx);this.open_remote_connection(window,cx);} )))))
            .when(
                configured && !editing && self.remote.public_contributions && self.remote.client(),
                |el| el.child(self.contribution_view(narrow, cx)),
            )
            .when(
                configured && !editing && (!self.remote.public_contributions || !self.remote.client()),
                |el| {
                    el.child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .when(!detail_visible, |el| {
                                el.child(self.remote_list(narrow, cx))
                            })
                            .when(detail_visible, |el| {
                                el.child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .flex()
                                        .flex_col()
                                        .child(div().px(px(pero_theme::WorkbenchStyle::PAGE)).py(px(8.)).child(Button::new("project-task-back").ghost().small().icon(IconName::ArrowLeft).label(self.t("project.back_tasks"))
                                            .on_click(cx.listener(|this,_,_,cx|{this.remote.creating=false;this.command(json!({"action":"remote_select","task_id":null}),cx);}))))
                                        .when(self.remote.creating, |el| {
                                            el.child(self.remote_form(narrow, cx))
                                        })
                                        .when(!self.remote.creating, |el| {
                                            el.child(self.remote_detail(narrow, cx))
                                        }),
                                )
                            }),
                    )
                },
            )
    }
}
