use gpui_kit::{
    component::{Disableable, Sizable, button::*},
    prelude::*,
    *,
};
use gpui_webview::WebView;
use pero_contracts::i18n::text;
use serde::Deserialize;
use serde_json::{Value, json};
use std::cell::RefCell;

thread_local! {
    static DESKTOP: RefCell<Option<(AnyWindowHandle, Entity<RunDesktop>)>> = const { RefCell::new(None) };
}

#[derive(Clone, Deserialize)]
struct Evidence {
    id: String,
    sha256: String,
    bytes: u64,
}

struct RunDesktop {
    run_id: String,
    locale: String,
    live: bool,
    controlling: bool,
    evidence_visible: bool,
    request: Option<String>,
    view: Option<Entity<WebView>>,
    evidence: Vec<Evidence>,
    missing: Vec<String>,
    feedback: Option<String>,
}

pub(crate) fn open(run_id: &str, live: bool, locale: &str, cx: &mut App) {
    let previous = DESKTOP.with(|slot| slot.borrow_mut().take());
    if let Some((handle, entity)) = previous {
        let same = handle
            .update(cx, |_, window, cx| {
                entity.update(cx, |this, cx| {
                    if this.run_id == run_id {
                        window.activate_window();
                        if !live {
                            this.live = false;
                            this.show_evidence(cx);
                        }
                        true
                    } else {
                        this.release();
                        window.remove_window();
                        false
                    }
                })
            })
            .unwrap_or(false);
        if same {
            DESKTOP.with(|slot| *slot.borrow_mut() = Some((handle, entity)));
            return;
        }
    }
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(px(1000.), px(720.)),
            cx,
        ))),
        window_min_size: Some(size(px(520.), px(360.))),
        ..Default::default()
    };
    let state = RunDesktop {
        run_id: run_id.to_owned(),
        locale: locale.to_owned(),
        live,
        controlling: false,
        evidence_visible: !live,
        request: None,
        view: None,
        evidence: Vec::new(),
        missing: Vec::new(),
        feedback: None,
    };
    if let Ok((handle, entity)) = gpui_kit::open_window(options, cx, |window, cx| {
        window.set_window_title(text(locale, "run_desktop.open"));
        let entity = cx.new(|_| state);
        crate::native_accessibility::attach(window);
        let closing = entity.downgrade();
        window.on_window_should_close(cx, move |_, cx| {
            let _ = closing.update(cx, |desktop, _| desktop.release());
            DESKTOP.with(|slot| slot.borrow_mut().take());
            true
        });
        entity
    }) {
        DESKTOP.with(|slot| *slot.borrow_mut() = Some((handle, entity.clone())));
        entity.update(cx, |desktop, cx| {
            if live {
                desktop.connect("watch", cx);
            } else {
                desktop.show_evidence(cx);
            }
        });
    }
}

pub(crate) fn accept(event: &Value, cx: &mut App) {
    let surface = DESKTOP.with(|slot| slot.borrow().clone());
    if let Some((handle, entity)) = surface {
        let _ = handle.update(cx, |_, window, cx| {
            entity.update(cx, |this, cx| this.accept(event, window, cx))
        });
    }
}

impl RunDesktop {
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
        self.command(json!({"action":"remote_desktop_open","mode":mode}), cx);
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
    }

    fn accept(&mut self, value: &Value, window: &mut Window, cx: &mut Context<Self>) {
        if value["run_id"] != self.run_id || value["request_id"].as_str() != self.request.as_deref()
        {
            return;
        }
        self.request = None;
        if let Some(error) = value["error"].as_str() {
            self.feedback = Some(error.into());
        } else if value["action"] == "remote_desktop_open" {
            self.controlling = value["mode"] == "control";
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
        let view = WebView::build(builder, window, cx).map_err(|error| error.to_string())?;
        Ok(cx.new(|_| view))
    }
}

impl Render for RunDesktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = pero_theme::UiAppearance::global(cx).palette.clone();
        let busy = self.request.is_some();
        let locale = self.locale.clone();
        let mut controls = div()
            .flex()
            .flex_wrap()
            .gap_2()
            .items_center()
            .px_4()
            .py_3()
            .child(div().flex_1().text_sm().child(self.run_id.clone()));
        if self.live {
            controls = controls.child(
                Button::new("run-desktop-reconnect")
                    .small()
                    .outline()
                    .label(text(&locale, "linux_desktop.reconnect"))
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.connect("watch", cx))),
            );
        }
        if self.live && !self.evidence_visible {
            let mode = if self.controlling { "watch" } else { "control" };
            let key = if self.controlling {
                "linux_desktop.return"
            } else {
                "linux_desktop.takeover"
            };
            controls = controls.child(
                Button::new("run-desktop-handoff")
                    .small()
                    .primary()
                    .label(text(&locale, key))
                    .disabled(busy || self.view.is_none())
                    .on_click(cx.listener(move |this, _, _, cx| this.connect(mode, cx))),
            );
        }
        controls = controls
            .child(
                Button::new("run-desktop-evidence")
                    .small()
                    .outline()
                    .label(text(
                        &locale,
                        if self.evidence_visible {
                            "run_desktop.refresh"
                        } else {
                            "run_desktop.evidence"
                        },
                    ))
                    .disabled(busy)
                    .on_click(cx.listener(|this, _, _, cx| this.show_evidence(cx))),
            )
            .child(
                Button::new("run-desktop-close")
                    .small()
                    .ghost()
                    .label(text(&locale, "run_desktop.close"))
                    .on_click(cx.listener(|this, _, window, _| {
                        this.release();
                        DESKTOP.with(|slot| slot.borrow_mut().take());
                        window.remove_window();
                    })),
            );

        let mut body = div().flex_1().min_h_0().flex().flex_col();
        if self.evidence_visible {
            body = body.px_4().gap_2();
            if self.evidence.is_empty() && !busy {
                body = body.child(text(&locale, "run_desktop.evidence_empty"));
            }
            for item in self.evidence.clone() {
                let file = item.id.clone();
                body = body.child(div().flex().items_center().justify_between().gap_2()
                    .child(div().flex().flex_col().child(file.clone()).child(div().text_sm().text_color(palette.text_muted)
                        .child(format!("{} B · {}", item.bytes, item.sha256))))
                    .child(Button::new(SharedString::from(format!("save-{file}"))).outline().small().disabled(busy)
                        .label(text(&locale, "run_desktop.save")).on_click(cx.listener(move |_, _, _, cx| {
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
                if !view.visible() {
                    view.show();
                }
            });
            body = body.child(div().size_full().child(view));
        }
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(palette.color("surface"))
            .text_color(palette.color("text"))
            .child(controls)
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
