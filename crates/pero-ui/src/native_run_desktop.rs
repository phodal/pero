use crate::{
    app::Workbench,
    projects::ProjectTab,
    remote::RemoteState,
    workspace::{WorkbenchPage, WorkspaceItem},
};
use gpui_kit::{
    base::Selectable,
    component::{Disableable, Icon, Sizable, button::*},
    prelude::*,
    *,
};
use gpui_webview::WebView;
use pero_chat_ui::{PanelTabAction, PanelTabs, ResourcePrimary, panel_launcher, panel_tab_strip};
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
    owner: WeakEntity<Workbench>,
    pane: ResourcePrimary,
    tabs: PanelTabs,
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
    pub(crate) attached: Option<ConversationDesktop>,
}

pub(crate) struct ConversationDesktop {
    thread: String,
    pub(crate) target: RunDesktopTarget,
}

impl ConversationDesktop {
    pub(crate) fn watch<'a>(&self, remote: &'a RemoteState) -> Option<&'a Value> {
        let watch = &remote.data["watched_desktop"];
        (watch["task_id"] == self.target.task_id).then_some(watch)
    }
}

#[derive(Clone)]
pub(crate) struct RunDesktopTarget {
    pub(crate) task_id: String,
    pub(crate) run_id: String,
}

impl RunDesktopTarget {
    fn permitted(remote: &RemoteState, task: &Value) -> bool {
        remote.operator() || remote.mine(task)
    }

    pub(crate) fn from_summary(remote: &RemoteState, task: &Value) -> Option<Self> {
        if task["state"] != "running"
            || task["current_desktop_profile"] != "blender"
            || !Self::permitted(remote, task)
        {
            return None;
        }
        Some(Self {
            task_id: task["id"].as_str()?.to_owned(),
            run_id: task["current_run_id"].as_str()?.to_owned(),
        })
    }
}

struct DesktopRun {
    id: String,
    live: bool,
    handoff: Option<DesktopHandoff>,
}

impl DesktopRun {
    fn from_detail(remote: &RemoteState, detail: &Value, task_id: &str) -> Option<Self> {
        let task = &detail["task"];
        let run = &detail["run"];
        let id = run["id"].as_str()?;
        if task["id"] != task_id || run["desktop_profile"] != "blender" {
            return None;
        }
        let live = run["status"] == "running"
            && task["current_run_id"] == id
            && RunDesktopTarget::permitted(remote, task);
        Some(Self {
            id: id.to_owned(),
            live,
            handoff: live.then(|| DesktopHandoff::requested(run)).flatten(),
        })
    }
}

impl Workbench {
    fn selected_desktop_run(&self) -> Option<DesktopRun> {
        let Some(WorkspaceItem::Task(selected)) = self.navigation.current() else {
            return None;
        };
        if self.project_tab != ProjectTab::Tasks
            || self.remote.data["selected_task_id"] != *selected
        {
            return None;
        }
        DesktopRun::from_detail(&self.remote, &self.remote.data["detail"], selected)
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
                    this.mount_run_desktop(run, false, false, cx);
                }
            }))
            .into_any_element()
    }

    pub(crate) fn run_desktop_toolbar(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let view = self.remote.run_desktop.view.clone()?;
        let desktop = view.read(cx);
        let owner = cx.entity().downgrade();
        let target = view.clone();
        Some(panel_tab_strip(
            &desktop.tabs,
            desktop.pane,
            &self.locale,
            move |action, cx| {
                let _ = owner.update(cx, |this, cx| match action {
                    PanelTabAction::Select(pane) => {
                        target.update(cx, |desktop, cx| desktop.select(pane, cx));
                        cx.notify();
                    }
                    PanelTabAction::Close(pane) => {
                        if pane == ResourcePrimary::Launcher && target.read(cx).tabs.is_empty() {
                            this.close_run_desktop(cx);
                        } else {
                            target.update(cx, |desktop, cx| {
                                let next = desktop.tabs.closed(pane, desktop.pane);
                                desktop.select(next, cx);
                            });
                            cx.notify();
                        }
                    }
                });
            },
            cx,
        ))
    }

    pub(crate) fn open_run_desktop_target(
        &mut self,
        target: RunDesktopTarget,
        cx: &mut Context<Self>,
    ) {
        let Some(thread) = self.chat.read(cx).desktop_pane_thread().map(str::to_owned) else {
            return;
        };
        let task = target.task_id.clone();
        self.remote.run_desktop.attached = Some(ConversationDesktop { thread, target });
        self.command(json!({"action":"remote_watch_desktop","task_id":task}), cx);
        cx.notify();
    }

    pub(crate) fn close_conversation_desktop(&mut self, cx: &mut Context<Self>) {
        if self.remote.run_desktop.attached.take().is_some() {
            if let Some(view) = self.remote.run_desktop.view.take() {
                view.update(cx, |view, _| view.release());
            }
            self.command(json!({"action":"remote_watch_desktop","task_id":null}), cx);
            cx.notify();
        }
    }

    pub(crate) fn sync_run_desktop(&mut self, covered: bool, cx: &mut Context<Self>) {
        if let Some(attached) = &self.remote.run_desktop.attached {
            if self.navigation.page() == WorkbenchPage::Conversation
                && self.remote.configured()
                && self.chat.read(cx).desktop_pane_thread() == Some(attached.thread.as_str())
            {
                let selected = attached
                    .watch(&self.remote)
                    .and_then(|watch| {
                        DesktopRun::from_detail(
                            &self.remote,
                            &watch["detail"],
                            &attached.target.task_id,
                        )
                    })
                    .filter(|run| run.live && run.id == attached.target.run_id);
                if let Some(run) = selected {
                    if let Some(view) = &self.remote.run_desktop.view {
                        view.update(cx, |view, cx| view.sync(&run, &self.locale, covered, cx));
                    } else {
                        self.mount_run_desktop(run, covered, true, cx);
                    }
                } else if let Some(view) = self.remote.run_desktop.view.take() {
                    view.update(cx, |view, _| view.release());
                    cx.notify();
                }
                return;
            }
            self.close_conversation_desktop(cx);
        }
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
                self.mount_run_desktop(run, covered, false, cx);
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

    fn mount_run_desktop(
        &mut self,
        run: DesktopRun,
        covered: bool,
        open_desktop: bool,
        cx: &mut Context<Self>,
    ) {
        let owner = cx.entity().downgrade();
        let view = cx.new(|cx| {
            let mut desktop = RunDesktop::new(run, &self.locale, covered, owner);
            if open_desktop {
                desktop.connect("watch", cx);
            }
            desktop
        });
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
    fn new(run: DesktopRun, locale: &str, covered: bool, owner: WeakEntity<Workbench>) -> Self {
        let pane = if run.handoff.is_some() {
            ResourcePrimary::Desktop
        } else {
            ResourcePrimary::Launcher
        };
        let mut tabs = PanelTabs::default();
        tabs.opened(pane);
        Self {
            run_id: run.id,
            locale: locale.to_owned(),
            live: run.live,
            controlling: false,
            handoff: run.handoff,
            control_handoff_id: None,
            returned_handoff_id: None,
            covered,
            owner,
            pane,
            tabs,
            request: None,
            view: None,
            evidence: Vec::new(),
            missing: Vec::new(),
            feedback: None,
        }
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
            let old = self.pane;
            self.tabs.closed(ResourcePrimary::Desktop, old);
            if old == ResourcePrimary::Desktop {
                self.show_evidence(cx);
            }
            self.live = false;
        } else if run.live {
            self.live = true;
            if handoff_arrived && self.pane != ResourcePrimary::Desktop {
                self.tabs.opened(ResourcePrimary::Desktop);
                self.pane = ResourcePrimary::Desktop;
                self.request = None;
                self.feedback = None;
                cx.notify();
            }
        }
    }

    fn select(&mut self, pane: ResourcePrimary, cx: &mut Context<Self>) {
        if self.pane == pane {
            return;
        }
        match pane {
            ResourcePrimary::Launcher => {
                self.release();
                self.request = None;
                self.feedback = None;
                self.pane = pane;
                cx.notify();
            }
            ResourcePrimary::Desktop if self.live => self.connect("watch", cx),
            ResourcePrimary::Artifacts => self.show_evidence(cx),
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
        self.pane = ResourcePrimary::Desktop;
        self.tabs.opened(self.pane);
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
        self.pane = ResourcePrimary::Artifacts;
        self.tabs.opened(self.pane);
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
            .with_initialization_script_for_main_only(
                r#"addEventListener('DOMContentLoaded', () => {
                    const style = document.createElement('style');
                    style.textContent = 'body { color-scheme: light dark; background: Canvas; color: CanvasText; }'
                        + 'header { padding: 4px 12px; } header h1 { display: none; }'
                        + 'header #status { margin: 0; font-size: 12px; }';
                    document.head.append(style);
                });"#,
                true,
            )
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
        if self.pane == ResourcePrimary::Launcher {
            let mut available = vec![ResourcePrimary::Artifacts];
            if self.live {
                available.insert(0, ResourcePrimary::Desktop);
            }
            let target = cx.entity().downgrade();
            let owner = self.owner.clone();
            return panel_launcher(
                &available,
                &locale,
                move |pane, cx| {
                    let _ = target.update(cx, |desktop, cx| desktop.select(pane, cx));
                    let _ = owner.update(cx, |_, cx| cx.notify());
                },
                cx,
            );
        }
        if self.live && self.pane == ResourcePrimary::Desktop {
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
        if self.pane == ResourcePrimary::Artifacts {
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
            .into_any_element()
    }
}
