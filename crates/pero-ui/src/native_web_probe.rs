//! Opt-in native acceptance and composition preview. No Host, credentials or URL registration.
use crate::{app::Workbench, theme::Palettes, workspace::WorkbenchPage};
use gpui_kit::component::{ActiveTheme, button::*};
use gpui_kit::{prelude::*, *};
use pero_contracts::web_document::WebLoad;
use std::{cell::Cell, path::PathBuf, rc::Rc, time::Duration};

const SNAPSHOT: &str = r#"(()=>{
 const input=document.querySelector('#draft');
 if(!window.probeIdentity){window.probeIdentity=String(Math.random());input.value='retained form';}
 return {heading:document.querySelector('h1').textContent,bridge:typeof window.pero,form:input.value,identity:window.probeIdentity};
})()"#;
#[derive(serde::Deserialize)]
struct Snapshot {
    heading: String,
    bridge: String,
    form: String,
    identity: String,
}
enum Reply {
    Initial(String),
    Retained(String),
}
struct Probe {
    preview: bool,
    overlay_clicks: u32,
    root: Entity<Workbench>,
    uri: String,
    receipt: PathBuf,
    passed: Rc<Cell<bool>>,
    stage: u8,
    identity: String,
    sender: async_channel::Sender<Reply>,
    _observer: Subscription,
}
impl Probe {
    fn new(
        preview: bool,
        uri: String,
        receipt: PathBuf,
        passed: Rc<Cell<bool>>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let palettes: Palettes =
            serde_json::from_str(include_str!("../../../web/src/theme.generated.json"))
                .expect("palette");
        pero_theme::ResolvedAppearance::resolve(&Default::default(), false, &palettes).install(cx);
        let root = cx.new(|cx| Workbench::new(palettes, false, "en".into(), window, cx));
        let observer = cx.observe_in(&root, window, |this, _, window, cx| {
            this.progress(window, cx)
        });
        let (sender, receiver) = async_channel::unbounded();
        cx.spawn_in(window, async move |this, cx| {
            while let Ok(reply) = receiver.recv().await {
                if this
                    .update_in(cx, |this, window, cx| this.reply(reply, window, cx))
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn_in(window, async move |this, cx| {
            if preview {
                return;
            }
            cx.background_executor()
                .timer(Duration::from_secs(30))
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.stage != 255 {
                    this.finish(
                        Some("Native Web view did not finish the acceptance flow".into()),
                        window,
                        cx,
                    );
                }
            });
        })
        .detach();
        root.update(cx, |root, cx| {
            root.web_command(
                serde_json::json!({"action":"web_open","url":uri}),
                window,
                cx,
            )
        });
        Self {
            preview,
            overlay_clicks: 0,
            root,
            uri,
            receipt,
            passed,
            stage: 0,
            identity: String::new(),
            sender,
            _observer: observer,
        }
    }
    fn query(&self, retained: bool, cx: &App) -> anyhow::Result<()> {
        let source = self
            .root
            .read(cx)
            .native_web_pages
            .get(&self.uri)
            .ok_or_else(|| anyhow::anyhow!("No native source"))?;
        let sender = self.sender.clone();
        source.view.read(cx).inspect(SNAPSHOT, cx, move |value| {
            let _ = sender.try_send(if retained {
                Reply::Retained(value)
            } else {
                Reply::Initial(value)
            });
        })
    }
    fn reply(&mut self, reply: Reply, window: &mut Window, cx: &mut Context<Self>) {
        let (retained, text) = match reply {
            Reply::Initial(text) => (false, text),
            Reply::Retained(text) => (true, text),
        };
        let snapshot = (|| -> anyhow::Result<Snapshot> {
            let value: serde_json::Value = serde_json::from_str(&text)?;
            Ok(if let Some(text) = value.as_str() {
                serde_json::from_str(text)?
            } else {
                serde_json::from_value(value)?
            })
        })();
        let snapshot = match snapshot {
            Ok(value) => value,
            Err(error) => {
                self.finish(Some(error.to_string()), window, cx);
                return;
            }
        };
        if snapshot.heading != "Native first"
            || snapshot.bridge != "undefined"
            || snapshot.form != "retained form"
        {
            self.finish(
                Some("Native page source or authority differs".into()),
                window,
                cx,
            );
            return;
        }
        if !retained {
            self.identity = snapshot.identity;
            self.stage = 2;
            self.root.update(cx, |root, cx| {
                root.navigate(WorkbenchPage::Projects, cx);
                root.sync_web_surface(None, cx);
                root.web_command(
                    serde_json::json!({"action":"web_open","url":self.uri}),
                    window,
                    cx,
                );
            });
            if let Err(error) = self.query(true, cx) {
                self.finish(Some(error.to_string()), window, cx);
            }
        } else {
            if snapshot.identity != self.identity {
                self.finish(
                    Some("Opening a retained native view reloaded the page".into()),
                    window,
                    cx,
                );
                return;
            }
            self.stage = 3;
            let root = self.root.read(cx);
            let source = &root.native_web_pages[&self.uri];
            if let Err(error) =
                source
                    .view
                    .read(cx)
                    .inspect("document.querySelector('#next').click()", cx, |_| {})
            {
                self.finish(Some(error.to_string()), window, cx);
            }
        }
    }
    fn progress(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.preview || self.stage == 255 {
            return;
        }
        let page = self.root.read(cx).web_documents.first().cloned();
        let Some(page) = page else {
            return;
        };
        if let WebLoad::Failed(error) = page.observation.load {
            self.finish(Some(error), window, cx);
            return;
        }
        if !matches!(page.observation.load, WebLoad::Ready) {
            return;
        }
        match self.stage {
            0 => {
                self.stage = 1;
                if let Err(error) = self.query(false, cx) {
                    self.finish(Some(error.to_string()), window, cx);
                }
            }
            3 if page.observation.title == "Native second"
                && page.observation.url.as_str().ends_with("/b") =>
            {
                if !page.observation.can_back {
                    self.finish(
                        Some("Native history did not expose Back".into()),
                        window,
                        cx,
                    );
                    return;
                }
                self.stage = 4;
                self.root.update(cx, |root, cx| {
                    root.web_command(
                        serde_json::json!({"action":"web_back","id":self.uri}),
                        window,
                        cx,
                    )
                });
            }
            4 if page.observation.url.as_str() == self.uri => {
                if !page.observation.can_forward {
                    self.finish(
                        Some("Native history did not expose Forward".into()),
                        window,
                        cx,
                    );
                    return;
                }
                self.stage = 5;
                self.root.update(cx, |root, cx| {
                    root.web_command(
                        serde_json::json!({"action":"web_forward","id":self.uri}),
                        window,
                        cx,
                    )
                });
            }
            5 if page.observation.title == "Native second"
                && page.observation.url.as_str().ends_with("/b") =>
            {
                self.root.update(cx, |root, cx| root.web_command(
                    serde_json::json!({"action":"web_open","url":format!("{}?second-view",self.uri)}),window,cx));
                // Hidden windows do not paint. Exercise actual native child visibility
                // through the same layout/selection reconciliation used by the renderer.
                let error = self.root.update(cx, |root, cx| {
                    for source in root.native_web_pages.values() {
                        source.view.update(cx, |view, cx| view.show_for_probe(cx));
                    }
                    root.layout = crate::layout::WorkspaceLayout::resolve(
                        1488.,
                        root.navigation.route(),
                        root.tab,
                        &root.preferences.layout,
                        false,
                    );
                    root.sync_web_surface(None, cx);
                    let original = root.native_web_pages[&self.uri].view.read(cx).visible(cx);
                    let other = root.native_web_pages[&format!("{}?second-view", self.uri)]
                        .view
                        .read(cx)
                        .visible(cx);
                    if original || !other {
                        return Some("Inactive native Web view remained visible".into());
                    }
                    root.layout = crate::layout::WorkspaceLayout::resolve(
                        1488.,
                        root.navigation.route(),
                        root.tab,
                        &root.preferences.layout,
                        true,
                    );
                    root.sync_web_surface(None, cx);
                    root.native_web_pages
                        .values()
                        .any(|source| source.view.read(cx).visible(cx))
                        .then(|| "Covered native Web view remained visible".into())
                });
                self.finish(error, window, cx);
            }
            _ => {}
        }
    }
    fn finish(&mut self, error: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        self.stage = 255;
        let active = window.is_window_active();
        // Confirm Wry actually registered native surfaces, rather than silently
        // falling back to ordinary child views on a Fast backend.
        #[cfg(all(feature = "native-fast", any(target_os = "macos", target_os = "linux")))]
        let native_surfaces = window
            .enable_window_composition()
            .and_then(|composition| {
                Ok(composition
                    .children(None)?
                    .into_iter()
                    .filter(|id| {
                        composition.surface_kind(*id).ok() == Some(CompositionSurfaceKind::Native)
                    })
                    .count())
            })
            .ok();
        #[cfg(not(all(feature = "native-fast", any(target_os = "macos", target_os = "linux"))))]
        let native_surfaces: Option<usize> = None;
        self.root.update(cx, |root, cx| {
            let ids: Vec<_> = root
                .web_documents
                .iter()
                .map(|page| page.id.clone())
                .collect();
            for id in ids {
                root.web_command(
                    serde_json::json!({"action":"web_close","id":id}),
                    window,
                    cx,
                );
            }
        });
        let released = self.root.read(cx).native_web_pages.is_empty()
            && self.root.read(cx).web_documents.is_empty();
        let success = error.is_none() && (self.preview || !active) && released;
        self.passed.set(success);
        let receipt = serde_json::json!({
            "passed": success,
            "error": error,
            "window_active": active,
            "released": released,
            "gpui_fast": gpui_kit::GPUI_FAST,
            "native_surfaces": native_surfaces,
            "preview": self.preview,
            "overlay_clicks": self.overlay_clicks,
            "checks": if self.preview {
                vec!["interactive composition preview; inspect screenshots separately"]
            } else {
                vec!["actual Wry page DOM", "no Host bridge", "retained native page and form",
                    "native back and forward", "inactive and covered native views hidden",
                    "source and native handle teardown"]
            },
            "visual_acceptance": false,
        });
        let _ = std::fs::write(&self.receipt, serde_json::to_vec_pretty(&receipt).unwrap());
        cx.quit();
    }
}
impl Render for Probe {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.preview {
            return self.root.clone().into_any_element();
        }
        div()
            .relative()
            .size_full()
            .child(self.root.clone())
            .child(deferred(
                div()
                    .id("composition-preview-overlay")
                    .absolute()
                    .top(px(180.))
                    .left(px(300.))
                    .p(px(16.))
                    .bg(cx.theme().background)
                    .border_1()
                    .border_color(cx.theme().border)
                    .occlude()
                    .child(
                        Button::new("composition-preview-click")
                            .primary()
                            .label(format!("Overlay clicks: {}", self.overlay_clicks))
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.overlay_clicks += 1;
                                cx.notify();
                            })),
                    ),
            ))
            .into_any_element()
    }
}

pub(crate) fn run() -> anyhow::Result<()> {
    let preview = std::env::args().nth(1).as_deref() == Some("--preview-webview");
    let uri = std::env::args()
        .nth(2)
        .ok_or_else(|| anyhow::anyhow!("Provide a loopback fixture URL"))?;
    let receipt = PathBuf::from(
        std::env::args()
            .nth(3)
            .ok_or_else(|| anyhow::anyhow!("Provide a receipt path"))?,
    );
    let passed = Rc::new(Cell::new(false));
    let outcome = passed.clone();
    crate::native::native_application()
        .with_assets(crate::assets::UiAssets)
        .run(move |cx| {
            gpui_kit::init(cx);
            cx.text_system()
                .add_fonts(vec![
                    std::borrow::Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-regular.ttf")
                            .as_slice(),
                    ),
                    std::borrow::Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-bold.ttf").as_slice(),
                    ),
                    std::borrow::Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/JetBrainsMono-Regular.ttf")
                            .as_slice(),
                    ),
                ])
                .expect("probe fonts");
            let options = WindowOptions {
                show: preview,
                focus: preview,
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    point(px(0.), px(0.)),
                    size(px(1000.), px(788.)),
                ))),
                ..Default::default()
            };
            let (window, probe) = gpui_kit::open_window(options, cx, move |window, cx| {
                window.set_window_title("Pero WebView composition preview");
                cx.new(|cx| Probe::new(preview, uri, receipt, outcome, window, cx))
            })
            .expect("native WebView probe");
            if preview {
                let probe = probe.downgrade();
                let _ = window.update(cx, |_, window, cx| {
                    window.on_window_should_close(cx, move |window, cx| {
                        let _ = probe.update(cx, |probe, cx| probe.finish(None, window, cx));
                        false
                    });
                });
            }
        });
    if !passed.get() {
        anyhow::bail!("Native Web view acceptance failed");
    }
    Ok(())
}
