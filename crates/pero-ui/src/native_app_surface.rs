//! Retained native App panels and their SDK context.
use crate::{
    app::Workbench,
    workspace::{WorkspaceItem, WorkspaceRoute},
};
use gpui_kit::{component::{button::*, notification::Notification, Sizable, WindowExt}, prelude::*, *};
use gpui_webview::WebView;
use pero_contracts::HostEvent;
use serde_json::{Value, json};

pub(crate) struct NativeAppPage {
    view: Option<Entity<WebView>>,
    error: Option<String>,
    ready: bool,
    location: Option<String>,
    context: Value,
    pending: std::collections::HashSet<String>,
}
pub(crate) struct NativeAppMessage(pub Value);
impl EventEmitter<NativeAppMessage> for NativeAppPage {}
const BRIDGE: &str = r#"
addEventListener('message',event=>{
 if(event.source!==window)return;
 const message=event.data;
 if(!message||typeof message.type!=='string')return;
 if(message.type==='pero:app:sdk'||message.type==='pero:app:examples'||message.type==='pero:app:ready'||message.type==='pero:app:chat'||message.type==='pero:app-use:result'||message.type==='pero:app:open-session')window.ipc.postMessage(JSON.stringify(message));
 if(message.type==='pero:app:chat-slot')window.postMessage({type:'pero:app:chat-slot-result',id:message.id,active:false},'*');
});
addEventListener('pointerdown',()=>window.ipc.postMessage('{"type":"focus"}'),true);
"#;
impl NativeAppPage {
    fn new(name: String, entry: String, frame_origins: Vec<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (sender, receiver) = async_channel::unbounded();
        let loads = sender.clone();
        let links = sender.clone();
        let popups = sender.clone();
        let client = crate::native::apps();
        let owner = name.clone();
        let allowed = format!("pero-app://{name}/");
        let ipc_origin = allowed.clone();
        let builder = wry::WebViewBuilder::new()
            .with_url(format!("pero-app://{name}/{entry}"))
            .with_initialization_script_for_main_only(BRIDGE, true)
            .with_asynchronous_custom_protocol("pero-app".into(), move |_, request, responder| {
                let client = client.clone();
                let name = owner.clone();
                std::thread::spawn(move || responder.respond(client.serve(&name, request)));
            })
            .with_navigation_handler(move |uri| {
                if uri.starts_with(&allowed) || frame_origins.iter().any(|origin| uri == *origin || uri.strip_prefix(origin).is_some_and(|tail| tail.starts_with('/'))) {
                    return true;
                }
                let _ = links.try_send(json!({"type":"link","url":uri}));
                false
            })
            .with_new_window_req_handler(move |uri, _| {
                let _ = popups.try_send(json!({"type":"link","url":uri}));
                wry::NewWindowResponse::Deny
            })
            .with_on_page_load_handler(move |event, _| {
                if matches!(event, wry::PageLoadEvent::Finished) {
                    let _ = loads.try_send(json!({"type":"loaded"}));
                }
            })
            .with_ipc_handler(move |request| {
                if !request.uri().to_string().starts_with(&ipc_origin) { return; }
                if request.body().len() <= 256_000 {
                    if let Ok(message) = serde_json::from_str::<Value>(request.body()) {
                        let _ = sender.try_send(message);
                    }
                }
            });
        let (view, error) = match WebView::build(builder, window, cx) {
            Ok(mut view) => {
                view.hide();
                (Some(cx.new(|_| view)), None)
            }
            Err(error) => (None, Some(error.to_string())),
        };
        cx.spawn(async move |this, cx| {
            while let Ok(message) = receiver.recv().await {
                if this
                    .update(cx, |this, cx| {
                        match message["type"].as_str() {
                            Some("loaded" | "pero:app:ready") => {
                                this.ready |= message["type"] == "pero:app:ready";
                                if this.ready {
                                    if let Some(location)=this.location.take() {this.navigate(location,cx);}
                                }
                                this.send(
                                    json!({"type":"pero:app:context","context":this.context}),
                                    cx,
                                );
                            }
                            _ => cx.emit(NativeAppMessage(message)),
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        })
        .detach();
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_secs(30))
                .await;
            let _ = this.update(cx, |this, cx| {
                if !this.ready && this.error.is_none() {
                    this.error = Some("The App did not finish loading. Retry opening it.".into());
                    if let Some(view) = &this.view {
                        view.update(cx, |view, _| view.hide());
                    }
                    cx.notify();
                }
            });
        })
        .detach();
        Self {
            view,
            error,
            ready: false,
            location:None,
            context: Value::Null,
            pending: Default::default(),
        }
    }
    pub fn navigate(&mut self, location:String, cx:&App) {
        if self.ready {self.send(json!({"type":"pero:app:location","location":location}),cx);}
        else {self.location=Some(location);}
    }
    pub fn insert_text(&self, text: &str, cx: &App) -> bool {
        let Some(view) = &self.view else {
            return false;
        };
        let Ok(literal) = serde_json::to_string(text) else {
            return false;
        };
        let script = format!(
            "(function(){{const text={literal};const el=document.activeElement;if(!(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement))return;const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const set=Object.getOwnPropertyDescriptor(proto,'value').set;const start=el.selectionStart??el.value.length;const end=el.selectionEnd??start;set.call(el,el.value.slice(0,start)+text+el.value.slice(end));const caret=start+text.length;el.selectionStart=el.selectionEnd=caret;el.dispatchEvent(new InputEvent('input',{{bubbles:true,inputType:'insertFromPaste',data:text}}));}})()"
        );
        let _ = view.read(cx).raw().evaluate_script(&script);
        true
    }
    pub fn perform_edit(&self, command: &str, cx: &App) -> bool {
        #[cfg(target_os = "macos")]
        {
            let Some(view) = &self.view else {
                return false;
            };
            return crate::native_web::edit_macos(view.read(cx).raw(), command);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (command, cx);
            false
        }
    }
    pub fn send(&self, message: Value, cx: &App) {
        if let Some(view) = &self.view {
            let _ = view
                .read(cx)
                .raw()
                .evaluate_script(&format!("window.postMessage({message},'*')"));
        }
    }
    fn sync(&mut self, mut context: Value, cx: &mut Context<Self>) {
        context["titlebar"]=json!(true);
        if !context["active"].as_bool().unwrap_or(false) || self.error.is_some() {
            if let Some(view) = &self.view {
                view.update(cx, |view, _| view.hide());
            }
        }
        if self.context != context {
            if let Some(view) = &self.view {
                let theme = if context["dark"] == true {
                    wry::Theme::Dark
                } else {
                    wry::Theme::Light
                };
                view.update(cx, |view, _| {
                    let _ = view.set_theme(theme);
                });
            }
            self.context = context;
            self.send(
                json!({"type":"pero:app:context","context":self.context}),
                cx,
            );
        }
    }
    #[cfg(feature = "native-probe")]
    pub fn inspect(
        &self,
        script: &str,
        cx: &App,
        callback: impl Fn(String) + Send + 'static,
    ) -> anyhow::Result<()> {
        self.view
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("App WebView unavailable"))?
            .read(cx)
            .raw()
            .evaluate_script_with_callback(script, callback)?;
        Ok(())
    }
}
impl Render for NativeAppPage {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if let Some(view) = self.view.as_ref().filter(|_| self.error.is_none()) {
            view.update(cx, |view, _| {
                if !view.visible() {
                    view.show();
                }
            });
        }
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .h_full()
            .when(!self.ready && self.error.is_none(), |el| {
                el.child(pero_contracts::i18n::text(
                    self.context["locale"].as_str().unwrap_or("en"),
                    "apps.loading_panel",
                ))
            })
            .children(self.view.clone().filter(|_| self.error.is_none()))
    }
}
pub(crate) struct RetainedApp {
    pub view: Entity<NativeAppPage>,
    _subscription: Subscription,
    _observation: Subscription,
}
impl Workbench {
    pub(crate) fn paste_app_text(&self, cx: &App) -> bool {
        #[cfg(not(target_family = "wasm"))]
        {
            if !self.layout.embedded_surface_visible {
                return false;
            }
            let Some(WorkspaceItem::App { name, panel }) = self.navigation.current() else {
                return false;
            };
            let Some(page) = self.native_app_pages.get(&(name.clone(), panel.clone())) else {
                return false;
            };
            let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) else {
                return page.view.read(cx).perform_edit("paste", cx);
            };
            return page.view.read(cx).insert_text(&text, cx);
        }
        #[cfg(target_family = "wasm")]
        {
            let _ = cx;
            false
        }
    }
    pub(crate) fn native_app_rpc(&mut self,event:HostEvent,_window:&mut Window,cx:&mut Context<Self>) {
        let id=event.request_id.unwrap_or_default();
        let input=event.data;
        let apps=crate::native::apps();
        let result=(|| -> anyhow::Result<Option<Value>> {
            match input["action"].as_str() {
                Some("selected")=>{
                    let chat=self.chat.read(cx);
                    Ok(Some(chat.active_chat.and_then(|index|chat.chats.get(index)).map(|chat|json!(chat.id)).unwrap_or(Value::Null)))
                }
                Some("written")=>{
                    let app=input["event"]["data"]["app"].as_str().unwrap_or_default();
                    for ((name,_),view) in &self.native_app_pages { if name==app { view.view.read(cx).send(json!({"type":"pero:app:data-changed"}),cx); view.view.read(cx).send(json!({"type":"pero:app:event","event":"app:written","value":{"app":app}}),cx); } }
                    Ok(Some(Value::Null))
                }
                Some("page")=>{
                    let app=input["scope"]["app"].as_str().ok_or_else(||anyhow::anyhow!("Choose an App"))?;
                    let panel=input["scope"]["panel"].as_str().ok_or_else(||anyhow::anyhow!("Choose a panel"))?;
                    let view=self.native_app_pages.get(&(app.into(),panel.into())).ok_or_else(||anyhow::anyhow!("App not mounted"))?;
                    match input["request"]["action"].as_str() {
                        Some("status")=>Ok(Some(json!({"app":app,"panel":panel,"instance":format!("{:?}",view.view.entity_id()),"visible":view.view.read(cx).context["active"],"active":view.view.read(cx).context["active"],"operable":false,"capturable":false,"rect":{"x":0,"y":0,"width":0,"height":0}}))),
                        Some("semantic")=>{
                            anyhow::ensure!(input["request"]["instance"]==format!("{:?}",view.view.entity_id()),"App instance changed");
                            view.view.update(cx,|view,cx|{view.pending.insert(id.clone());view.send(json!({"type":"pero:app-use:request","id":id,"request":input["request"]}),cx);});
                            Ok(None)
                        }
                        _=>anyhow::bail!("Native App UI operation is unavailable"),
                    }
                }
                _=>anyhow::bail!("Unknown native App request"),
            }
        })();
        match result { Ok(None)=>{}, Ok(Some(value))=>apps.shell_reply(&id,Ok(value)), Err(error)=>{eprintln!("Native App request failed: {error}");apps.shell_reply(&id,Err(error))} }
    }

    pub(crate) fn receive_native_app(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if event.kind != "apps_opened" {
            return;
        }
        #[derive(serde::Deserialize)]
        struct Open {
            name: String,
            panel: String,
            entry: String,
            #[serde(default, rename = "frameOrigins")]
            frame_origins: Vec<String>,
        }
        let Ok(open) = serde_json::from_value::<Open>(event.data.clone()) else {
            return;
        };
        let item = WorkspaceItem::App {
            name: open.name.clone(),
            panel: open.panel.clone(),
        };
        if !self.navigation.items().contains(&item)
            || !self.apps.contains_panel(&open.name, &open.panel)
        {
            return;
        }
        let key = (open.name, open.panel);
        if self.native_app_pages.contains_key(&key) {
            return;
        }
        let view = cx.new(|cx| NativeAppPage::new(key.0.clone(), open.entry, open.frame_origins, window, cx));
        // The parent owns the failure view, including a WebView's loading timeout.
        let observation = cx.observe(&view, |_, _, cx| cx.notify());
        let scope = pero_contracts::AppChatScope {
            app: key.0.clone(),
            panel: key.1.clone(),
        };
        if self.pending_app_location.as_ref().is_some_and(|address|address.scope==scope) {
            let address=self.pending_app_location.take().unwrap();
            view.update(cx,|view,cx|view.navigate(address.location,cx));
        }
        let subscription = cx.subscribe_in(&view, window, move |this, view, event: &NativeAppMessage, window, cx| {
            let message = &event.0;
            let item = WorkspaceItem::App { name: scope.app.clone(), panel: scope.panel.clone() };
            if message["type"] == "pero:app:sdk" {
                let result = (|| -> anyhow::Result<()> {
                    anyhow::ensure!(this.navigation.current()==Some(&item), "Open the App before using Host presentation");
                    let input = &message["input"];
                    match message["operation"].as_str() {
                        Some("navigate") => {
                            let path=input["path"].as_str().ok_or_else(||anyhow::anyhow!("Choose a Pero page"))?;
                            if let Some(target)=path.strip_prefix("/apps/") {
                                let mut parts=target.split('/');let app=parts.next().unwrap_or_default();let panel=parts.next().unwrap_or("main");
                                anyhow::ensure!(parts.next().is_none() && this.apps.contains_panel(app,panel), "App panel is unavailable");
                                this.open_app(app.into(),panel.into(),cx);
                            } else {
                                let page=if path=="/" {"projects"} else {path.strip_prefix('/').ok_or_else(||anyhow::anyhow!("Choose a local Pero page"))?};
                                this.navigate(serde_json::from_value(json!(page))?,cx);
                            }
                        }
                        Some("notify") => {
                            let text=input["message"].as_str().filter(|text|!text.is_empty() && text.len()<=4000).ok_or_else(||anyhow::anyhow!("Invalid notification"))?.to_owned();
                            let note=match input["type"].as_str().unwrap_or("info") { "info"=>Notification::info(text),"success"=>Notification::success(text),"error"=>Notification::error(text),_=>anyhow::bail!("Invalid notification type") };
                            window.push_notification(note,cx);
                        }
                        Some("badge") => {
                            let count=input["count"].as_u64().filter(|count|*count<=999999).ok_or_else(||anyhow::anyhow!("Invalid App count"))? as u32;
                            if count==0 {this.apps.badges.remove(&scope.app);}else{this.apps.badges.insert(scope.app.clone(),count);}
                        }
                        _ => anyhow::bail!("Host presentation unavailable"),
                    }
                    Ok(())
                })();
                let reply=match result {Ok(())=>json!({"type":"pero:app:sdk-result","id":message["id"],"ok":true}),Err(error)=>json!({"type":"pero:app:sdk-result","id":message["id"],"ok":false,"error":error.to_string()})};
                view.read(cx).send(reply,cx);cx.notify();
            }
            if message["type"] == "pero:app:examples" {this.receive_app_examples(scope.clone(),message["state"].clone(),cx);}
            if message["type"] == "focus" { this.focus_surface_item(&item, window, cx); }
            if message["type"] == "link" {this.web_command(json!({"action":"web_open","url":message["url"]}),window,cx);}
            if message["type"] == "pero:app-use:result" {
                if let Some(id) = message["id"].as_str() {
                    let expected = view.update(cx,|view,_|view.pending.remove(id));
                    if expected {
                        let result = if message["ok"] == true { Ok(message["value"].clone()) } else { Err(anyhow::anyhow!("{}", message["error"])) };
                        crate::native::apps().shell_reply(id,result);
                    }
                }
            }
            if message["type"] == "pero:app:open-session" && scope.app=="automations" && this.navigation.current()==Some(&item) {
                if let Some(id)=message["sessionId"].as_str() {this.open_automation_session(id,cx);}
            }
            if message["type"] == "pero:app:chat" {
                let result = (|| -> anyhow::Result<String> {
                    anyhow::ensure!(this.navigation.current()==Some(&item), "Show the App before opening its conversation");
                    this.chat.update(cx, |chat,cx| {
                        chat.open_app_draft(scope.clone(),cx);
                        Ok(chat.active_chat.and_then(|index|chat.chats.get(index)).ok_or_else(||anyhow::anyhow!("Open Chat and retry"))?.id.clone())
                    })
                })();
                let id = message["id"].clone();
                let options = message["options"].clone();
                match result {
                    Err(error) => view.read(cx).send(json!({"type":"pero:app:chat-result","id":id,"ok":false,"error":error.to_string()}),cx),
                    Ok(thread) => {
                        let scope=scope.clone(); let page=view.clone(); let apps=crate::native::apps();
                        cx.spawn_in(window,async move |this,cx| {
                            let request=json!({"operation":"app-context","scope":scope,"thread":thread,"options":options.clone()});
                            let result=cx.background_executor().spawn(async move {apps.context(request)}).await;
                            let _=this.update_in(cx,|this,_,cx| {
                                let reply=match result {
                                    Ok(contexts)=>{
                                        this.set_chat_dock(true,cx);
                                        let mut insertion=HostEvent::new("compose_context",None,options["message"].as_str().unwrap_or_default().to_owned());
                                        insertion.data=json!({"thread_id":thread,"contexts":contexts,"replace":options["mode"]=="replace"});
                                        this.chat.update(cx,|chat,cx|chat.receive(&insertion,cx));
                                        json!({"type":"pero:app:chat-result","id":id,"ok":true,"value":{"threadId":thread}})
                                    }
                                    Err(error)=>json!({"type":"pero:app:chat-result","id":id,"ok":false,"error":error.to_string()}),
                                };
                                page.read(cx).send(reply,cx);
                                cx.notify();
                            });
                        }).detach();
                    }
                }
            }
        });
        self.native_app_pages.insert(
            key,
            RetainedApp {
                view,
                _subscription: subscription,
                _observation: observation,
            },
        );
        cx.notify();
    }
    pub(crate) fn sync_native_apps(&mut self, cx: &mut Context<Self>) {
        let paper_pages = self.native_app_pages.keys().filter(|(name, _)| name == "paper-agent").count();
        self.native_app_pages.retain(|(name, panel), _| {
            self.navigation.items().contains(&WorkspaceItem::App {
                name: name.clone(),
                panel: panel.clone(),
            }) && self.apps.retains_panel(name, panel)
        });
        if self.native_app_pages.keys().filter(|(name, _)| name == "paper-agent").count() < paper_pages {
            crate::native::apps().cancel_docling_confirmation();
        }
        for ((name, panel), page) in &self.native_app_pages {
            let item = WorkspaceItem::App {
                name: name.clone(),
                panel: panel.clone(),
            };
            let active = self.layout.embedded_surface_visible
                && if self.navigation.pane_layout_visible() {
                    self.navigation.pane_layout().is_some_and(|layout| {
                        layout
                            .active_items()
                            .iter()
                            .any(|leaf| leaf.route == WorkspaceRoute::Content(item.clone()))
                    })
                } else {
                    self.navigation.current() == Some(&item)
                };
            page.view.update(cx, |view,cx| view.sync(json!({"active":active,"dark":pero_theme::UiAppearance::global(cx).dark,"appearance":pero_theme::UiAppearance::global(cx),"locale":self.locale}),cx));
        }
    }
    pub(crate) fn native_app_content(
        &self,
        name: &str,
        panel: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if self.apps.preparation.as_ref().is_some_and(|value| value.name == name && value.phase != "ready") {
            return self.app_preparation_content(cx);
        }
        let error = self
            .native_app_pages
            .get(&(name.into(), panel.into()))
            .and_then(|page| page.view.read(cx).error.clone())
            .or_else(|| self.apps.error.clone());
        let key = (name.to_owned(), panel.to_owned());
        let name = name.to_owned();
        let panel = panel.to_owned();
        let chrome = pero_theme::Chrome::from_app(cx);
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .h_full()
            .when_some(error.clone(), |el, error| {
                let diagnostics = format!("App: {name}\nPanel: {panel}\n{error}");
                el.child(
                    div().flex().flex_col().gap(px(12.)).p(px(12.)).min_w_0()
                        .max_w(px(680.)).text_size(chrome.text(14.))
                        .text_color(chrome.palette.text)
                        .child(div().font_weight(FontWeight::SEMIBOLD).text_size(chrome.text(18.))
                            .child(self.t("apps.open_failed")))
                        .child(div().whitespace_normal().text_color(chrome.palette.text_muted)
                            .child(self.t("apps.open_failed_hint")))
                        .child(div().flex().flex_wrap().items_center().gap(px(8.))
                            .child(Button::new("native-app-retry").small().outline()
                                .label(self.t("apps.retry_open"))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.native_app_pages.remove(&(name.clone(), panel.clone()));
                                    this.pending_app=Some((name.clone(),panel.clone()));
                                    this.refresh_apps(cx);
                                })))
                            .child(Button::new("native-app-error-details").small().ghost()
                                .label(self.t(if self.apps.error_details_open {
                                    "apps.hide_diagnostics"
                                } else { "apps.show_diagnostics" }))
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.apps.error_details_open = !this.apps.error_details_open;
                                    cx.notify();
                                }))))
                        .when(self.apps.error_details_open, |el| el.child(
                            div().flex().flex_col().gap(px(8.)).min_w_0()
                                .child(div().id("native-app-diagnostics").max_h(px(240.))
                                    .overflow_y_scroll().text_size(chrome.text(12.))
                                    .whitespace_normal().child(error))
                                .child(div().flex().child(
                                    Button::new("native-app-copy-diagnostics").small().ghost()
                                        .label(self.t("apps.copy_diagnostics"))
                                        .on_click(cx.listener(move |this, _, window, cx| {
                                            cx.write_to_clipboard(ClipboardItem::new_string(diagnostics.clone()));
                                            window.push_notification(Notification::success(this.t("content.copied")), cx);
                                        }))))))
                )
            })
            .when(
                error.is_none() && self.layout.embedded_surface_visible,
                |el| {
                    if let Some(page) = self.native_app_pages.get(&key) {
                        el.child(page.view.clone())
                    } else {
                        el.child(self.t("apps.loading_panel"))
                    }
                },
            )
            .into_any_element()
    }
}
