use crate::{app::Workbench, projects::ProjectTab, workspace::WorkspaceItem};
use gpui_kit::{
    base::Selectable,
    component::{Disableable, Icon, Sizable, button::*},
    prelude::*,
    *,
};
use gpui_webview::WebView;
use pero_chat_ui::{ResourcePrimary, resource_menu};
use pero_contracts::i18n::text;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone, Deserialize)]
struct Evidence {
    id: String,
    sha256: String,
    bytes: u64,
}

#[derive(Clone, Deserialize, PartialEq)]
struct DesktopHandoff {
    request_id: String,
    reason: String,
    state: HandoffState,
}

#[derive(Clone, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
enum HandoffState {
    Requested,
    Returned,
}

impl DesktopHandoff {
    fn requested(run: &Value) -> Option<Self> {
        serde_json::from_value::<Self>(run["desktop_handoff"].clone())
            .ok()
            .filter(|handoff| handoff.state == HandoffState::Requested)
    }
}

pub(crate) struct RunDesktop {
    run_id: String,
    locale: String,
    live: bool,
    controlling: bool,
    handoff: Option<DesktopHandoff>,
    control_handoff_id: Option<String>,
    returned_handoff_id: Option<String>,
    covered: bool,
    evidence_visible: bool,
    request: Option<String>,
    view: Option<Entity<WebView>>,
    evidence: Vec<Evidence>,
    missing: Vec<String>,
    feedback: Option<String>,
}

#[derive(Default)]
pub(crate) struct RunDesktopPanel {
    pub(crate) view: Option<Entity<RunDesktop>>,
    dismissed_handoff: Option<String>,
}

struct DesktopRun {
    id: String,
    live: bool,
    handoff: Option<DesktopHandoff>,
}

impl Workbench {
    fn selected_desktop_run(&self) -> Option<DesktopRun> {
        let Some(WorkspaceItem::Task(selected)) = self.navigation.current() else {
            return None;
        };
        let detail = &self.remote.data["detail"];
        let task = &detail["task"];
        let run = &detail["run"];
        let id = run["id"].as_str()?;
        if self.project_tab != ProjectTab::Tasks
            || self.remote.data["selected_task_id"].as_str() != Some(selected)
            || task["id"].as_str() != Some(selected)
            || run["desktop_profile"] != "blender"
        {
            return None;
        }
        let live = run["status"] == "running"
            && task["current_run_id"] == id
            && (self.remote.operator() || self.remote.mine(task));
        Some(DesktopRun {
            id: id.to_owned(),
            live,
            handoff: live.then(|| DesktopHandoff::requested(run)).flatten(),
        })
    }

    pub(crate) fn run_desktop_available(&self) -> bool {
        self.selected_desktop_run().is_some()
    }

    pub(crate) fn run_desktop_toggle(&self, cx: &mut Context<Self>) -> AnyElement {
        let active = self.run_desktop_active();
        let label = self.t(if active {
            "run_desktop.close"
        } else {
            "run_desktop.resources"
        });
        pero_theme::ghost_icon_button("titleband-artifacts", pero_theme::Chrome::from_app(cx), cx)
            .icon(Icon::default().path(if active {
                "icons/panel-right-close.svg"
            } else {
                "icons/panel-right-open.svg"
            }))
            .selected(active)
            .toggled(active)
            .tooltip(label)
            .accessibility_label(label)
            .on_click(cx.listener(|this, _, _, cx| {
                if this.run_desktop_active() {
                    this.close_run_desktop(cx);
                } else if let Some(run) = this.selected_desktop_run() {
                    this.mount_run_desktop(run, false, cx);
                }
            }))
            .into_any_element()
    }

    pub(crate) fn run_desktop_toolbar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let view = self.remote.run_desktop.view.clone()?;
        let desktop = view.read(cx);
        let live = desktop.live;
        let selected = if desktop.evidence_visible {
            ResourcePrimary::Artifacts
        } else {
            ResourcePrimary::Desktop
        };
        let tabs = [ResourcePrimary::Desktop, ResourcePrimary::Artifacts];
        let owner = cx.entity().downgrade();
        let target = view.clone();
        let launcher = resource_menu(
            tabs.into_iter()
                .filter(|pane| live || *pane != ResourcePrimary::Desktop),
            selected,
            &self.locale,
            false,
            move |pane, cx| {
                let _ = owner.update(cx, |_, cx| {
                    target.update(cx, |desktop, cx| desktop.select(pane, cx));
                    cx.notify();
                });
            },
        );
        Some(
            div()
                .id("run-resources-toolbar")
                .size_full()
                .flex()
                .items_center()
                .gap_1()
                .px_2()
                .child(
                    div()
                        .id("run-resources-tabs")
                        .role(Role::TabList)
                        .aria_label(self.t("run_desktop.resources"))
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .items_center()
                        .gap_1()
                        .children(tabs.into_iter().enumerate().map(|(i, pane)| {
                            let target = view.clone();
                            Button::new(("run-resource-tab", i))
                                .role(Role::Tab)
                                .ghost()
                                .small()
                                .label(self.t(pane.label()))
                                .toggled(selected == pane)
                                .selected(selected == pane)
                                .disabled(!live && pane == ResourcePrimary::Desktop)
                                .on_click(cx.listener(move |_, _, _, cx| {
                                    target.update(cx, |desktop, cx| desktop.select(pane, cx));
                                    cx.notify();
                                }))
                        })),
                )
                .child(launcher)
                .into_any_element(),
        )
    }

    pub(crate) fn sync_run_desktop(&mut self, covered: bool, cx: &mut Context<Self>) {
        let selected = self.selected_desktop_run();
        if let Some(view) = self.remote.run_desktop.view.clone() {
            if let Some(run) = selected
                .as_ref()
                .filter(|run| run.id == view.read(cx).run_id)
            {
                view.update(cx, |view, cx| view.sync(run, &self.locale, covered, cx));
                return;
            }
            view.update(cx, |view, _| view.release());
            self.remote.run_desktop.view = None;
        }
        if let Some(run) = selected {
            if run.handoff.as_ref().is_some_and(|handoff| {
                self.remote.run_desktop.dismissed_handoff.as_deref() != Some(&handoff.request_id)
            }) {
                self.mount_run_desktop(run, covered, cx);
            }
        }
    }

    fn close_run_desktop(&mut self, cx: &mut Context<Self>) {
        if let Some(view) = self.remote.run_desktop.view.take() {
            self.remote.run_desktop.dismissed_handoff = view.update(cx, |view, _| {
                view.release();
                view.handoff
                    .as_ref()
                    .map(|handoff| handoff.request_id.clone())
            });
            cx.notify();
        }
    }

    fn mount_run_desktop(&mut self, run: DesktopRun, covered: bool, cx: &mut Context<Self>) {
        let view = cx.new(|cx| RunDesktop::new(run, &self.locale, covered, cx));
        self.remote.run_desktop.view = Some(view);
        cx.notify();
    }

    pub(crate) fn accept_run_desktop(
        &mut self,
        event: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(view) = &self.remote.run_desktop.view {
            view.update(cx, |view, cx| view.accept(event, window, cx));
        }
    }
}

impl RunDesktop {
    fn new(run: DesktopRun, locale: &str, covered: bool, cx: &mut Context<Self>) -> Self {
        let mut state = Self {
            run_id: run.id,
            locale: locale.to_owned(),
            live: run.live,
            controlling: false,
            handoff: run.handoff,
            control_handoff_id: None,
            returned_handoff_id: None,
            covered,
            evidence_visible: !run.live,
            request: None,
            view: None,
            evidence: Vec::new(),
            missing: Vec::new(),
            feedback: None,
        };
        if !state.live {
            state.show_evidence(cx);
        } else if state.handoff.is_none() {
            state.connect("watch", cx);
        }
        state
    }

    fn sync(&mut self, run: &DesktopRun, locale: &str, covered: bool, cx: &mut Context<Self>) {
        let handoff = run
            .handoff
            .clone()
            .filter(|handoff| self.returned_handoff_id.as_deref() != Some(&handoff.request_id));
        let handoff_arrived = handoff.is_some() && self.handoff != handoff;
        if self.handoff != handoff || self.covered != covered || self.locale != locale {
            self.handoff = handoff;
            self.covered = covered;
            self.locale = locale.to_owned();
            cx.notify();
        }
        if self.live && !run.live {
            self.show_evidence(cx);
            self.live = false;
        } else if run.live {
            let became_live = !self.live;
            self.live = true;
            if handoff_arrived && self.evidence_visible {
                self.evidence_visible = false;
                self.request = None;
                self.feedback = None;
                cx.notify();
            } else if became_live && self.handoff.is_none() {
                self.connect("watch", cx);
            }
        }
    }

    fn select(&mut self, pane: ResourcePrimary, cx: &mut Context<Self>) {
        match pane {
            ResourcePrimary::Desktop if self.live && self.evidence_visible => {
                self.connect("watch", cx)
            }
            ResourcePrimary::Artifacts if !self.evidence_visible => self.show_evidence(cx),
            _ => {}
        }
    }

    fn command(&mut self, mut command: Value, cx: &mut Context<Self>) {
        let request = uuid::Uuid::new_v4().to_string();
        command["run_id"] = json!(self.run_id);
        command["request_id"] = json!(request);
        self.feedback = None;
        match crate::native::session_command(&command.to_string()) {
            Ok(()) => self.request = Some(request),
            Err(error) => self.feedback = Some(error),
        }
        cx.notify();
    }

    fn connect(&mut self, mode: &str, cx: &mut Context<Self>) {
        self.view = None;
        self.evidence_visible = false;
        self.controlling = false;
        self.control_handoff_id = None;
        let mut command = json!({"action":"remote_desktop_open","mode":mode});
        if matches!(mode, "control" | "return") {
            if let Some(handoff) = &self.handoff {
                command["handoff_id"] = json!(handoff.request_id);
            }
        }
        self.command(command, cx);
    }

    fn show_evidence(&mut self, cx: &mut Context<Self>) {
        self.release();
        self.evidence_visible = true;
        self.command(json!({"action":"remote_desktop_artifacts"}), cx);
    }

    fn release(&mut self) {
        let connected = self.view.take().is_some();
        if self.live && connected {
            let _ = crate::native::session_command(
                &json!({"action":"remote_desktop_open", "run_id":self.run_id,
                "request_id":uuid::Uuid::new_v4().to_string(), "mode":"release"})
                .to_string(),
            );
        }
        self.controlling = false;
        self.control_handoff_id = None;
    }

    fn accept(&mut self, value: &Value, window: &mut Window, cx: &mut Context<Self>) {
        if value["run_id"] != self.run_id || value["request_id"].as_str() != self.request.as_deref()
        {
            return;
        }
        self.request = None;
        if let Some(error) = value["error"].as_str() {
            self.feedback = Some(error.into());
        } else if value["action"] == "remote_desktop_open" && value["mode"] == "return" {
            self.returned_handoff_id = value["handoff_id"].as_str().map(str::to_owned);
            self.handoff = None;
            self.connect("watch", cx);
            self.feedback = Some(text(&self.locale, "run_desktop.handoff_returned").into());
        } else if value["action"] == "remote_desktop_open" {
            self.controlling = value["mode"] == "control";
            self.control_handoff_id = value["handoff_id"].as_str().map(str::to_owned);
            let result = value["result"]["invitation"]
                .as_str()
                .ok_or_else(|| "The Worker did not return a desktop connection".to_owned())
                .and_then(|url| Self::webview(url, window, cx));
            match result {
                Ok(view) => self.view = Some(view),
                Err(error) => self.feedback = Some(error),
            }
        } else if value["action"] == "remote_desktop_artifacts" {
            if let Some(bundle) = value["result"]["artifacts"]
                .as_array()
                .and_then(|entries| entries.iter().find(|bundle| bundle["id"] == "desktop"))
            {
                self.evidence = serde_json::from_value(bundle["files"].clone()).unwrap_or_default();
                self.missing =
                    serde_json::from_value(bundle["missing"].clone()).unwrap_or_default();
            }
        } else if value["action"] == "remote_desktop_save" {
            self.feedback = Some(text(&self.locale, "run_desktop.saved").into());
        }
        cx.notify();
    }

    fn webview(
        raw: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<Entity<WebView>, String> {
        let invitation = reqwest::Url::parse(raw).map_err(|_| "Invalid desktop invitation")?;
        if !matches!(invitation.scheme(), "http" | "https")
            || invitation.host().is_none()
            || invitation.path() != "/"
            || invitation.query().is_some()
            || invitation.fragment().is_none()
        {
            return Err("Invalid desktop invitation".into());
        }
        let origin = invitation.origin();
        let builder = wry::WebViewBuilder::new()
            .with_url(raw)
            .with_navigation_handler(move |target| {
                reqwest::Url::parse(&target).is_ok_and(|url| {
                    url.origin() == origin && url.path() == "/" && url.query().is_none()
                })
            })
            .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny);
        let mut view = WebView::build(builder, window, cx).map_err(|error| error.to_string())?;
        view.hide();
        Ok(cx.new(|_| view))
    }
}

impl Render for RunDesktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = pero_theme::UiAppearance::global(cx).palette.clone();
        let busy = self.request.is_some();
        let locale = self.locale.clone();
        let paired = self
            .handoff
            .as_ref()
            .is_some_and(|handoff| self.control_handoff_id.as_deref() == Some(&handoff.request_id));
        let mut controls = div().flex().flex_wrap().gap_2().items_center();
        if self.live && !self.evidence_visible {
            let (mode, key) = match (self.controlling, self.handoff.is_some(), paired) {
                (true, true, true) => ("return", "linux_desktop.return"),
                (true, false, _) => ("watch", "linux_desktop.return"),
                _ => ("control", "linux_desktop.takeover"),
            };
            controls = controls
                .child(
                    Button::new("run-desktop-handoff")
                        .small()
                        .primary()
                        .label(text(&locale, key))
                        .disabled(busy || (self.view.is_none() && self.handoff.is_none()))
                        .on_click(cx.listener(move |this, _, _, cx| this.connect(mode, cx))),
                )
                .when(
                    self.handoff.is_none() || self.view.is_some() || self.feedback.is_some(),
                    |el| {
                        el.child(
                            Button::new("run-desktop-reconnect")
                                .small()
                                .ghost()
                                .label(text(&locale, "linux_desktop.reconnect"))
                                .disabled(busy)
                                .on_click(cx.listener(|this, _, _, cx| this.connect("watch", cx))),
                        )
                    },
                );
        } else {
            controls = controls.child(
                Button::new("run-desktop-evidence")
                    .small()
                    .ghost()
                    .label(text(&locale, "run_desktop.refresh"))
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.show_evidence(cx))),
            );
        }
        let mut body = div()
            .id("run-desktop-body")
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col();
        if self.evidence_visible {
            body = body.overflow_y_scroll().px_3().gap_2();
            if self.evidence.is_empty() && !busy {
                body = body.child(text(&locale, "run_desktop.evidence_empty"));
            }
            for item in self.evidence.clone() {
                let file = item.id.clone();
                body = body.child(div().flex().items_center().justify_between().gap_2()
                    .child(div().flex_1().min_w_0().flex().flex_col().child(file.clone()).child(div().truncate().text_sm().text_color(palette.text_muted)
                        .child(format!("{} B · {}", item.bytes, item.sha256))))
                    .child(Button::new(SharedString::from(format!("save-{file}"))).outline().small().disabled(busy)
                        .label(text(&locale, "run_desktop.save"))
                        .accessibility_label(format!("{} · {file}", text(&locale, "run_desktop.save"))).on_click(cx.listener(move |_, _, _, cx| {
                            let picker = cx.prompt_for_new_path(&std::env::var_os("HOME").map(std::path::PathBuf::from)
                                .unwrap_or_else(std::env::temp_dir), Some(&file));
                            let file = file.clone();
                            let sha256 = item.sha256.clone();
                            cx.spawn(async move |owner, cx| {
                                if let Ok(Ok(Some(path))) = picker.await {
                                    let _ = owner.update(cx, |this, cx| this.command(json!({"action":"remote_desktop_save","file":file,"sha256":sha256,"path":path}), cx));
                                }
                            }).detach();
                        }))));
            }
            if !self.missing.is_empty() {
                body = body.child(
                    div()
                        .text_sm()
                        .text_color(palette.text_muted)
                        .child(self.missing.join(", ")),
                );
            }
        } else if let Some(view) = self.view.clone() {
            view.update(cx, |view, _| {
                if self.covered {
                    view.hide();
                } else if !view.visible() {
                    view.show();
                }
            });
            if !self.covered {
                body = body.child(div().size_full().child(view));
            }
        }
        div()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(palette.color("surface"))
            .text_color(palette.color("text"))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .p_3()
                    .when_some(self.handoff.as_ref(), |el, handoff| {
                        el.child(
                            div()
                                .id("run-desktop-request")
                                .role(Role::Group)
                                .aria_label(format!(
                                    "{} · {}",
                                    text(&locale, "run_desktop.handoff_requested"),
                                    handoff.reason
                                ))
                                .child(
                                    div()
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .child(text(&locale, "run_desktop.handoff_requested")),
                                )
                                .child(
                                    div()
                                        .mt_1()
                                        .text_sm()
                                        .whitespace_normal()
                                        .child(handoff.reason.clone()),
                                ),
                        )
                    })
                    .child(controls),
            )
            .when(busy, |el| {
                el.child(
                    div()
                        .px_4()
                        .text_sm()
                        .child(text(&locale, "linux_desktop.loading")),
                )
            })
            .when_some(self.feedback.clone(), |el, feedback| {
                el.child(div().px_4().py_2().text_sm().child(feedback))
            })
            .child(body)
    }
}
