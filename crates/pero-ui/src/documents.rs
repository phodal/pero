//! Retained document items. Navigation owns selection; each item owns its view.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{prelude::*, *};
use pero_chat_ui::content_reader::{ContentReader, ReaderAction};
use pero_contracts::content_document::{ContentDocument, ContentFormat};
use pero_contracts::content_origin::ContentOrigin;

pub(crate) struct WorkspaceDocument {
    pub item: WorkspaceItem,
    pub view: Entity<ContentReader>,
    _subscriptions: Vec<Subscription>,
}

impl Workbench {
    pub(crate) fn open_document(
        &mut self,
        document: ContentDocument,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let item = WorkspaceItem::Document {
            origin: document.origin.clone(),
            source: document.id.clone(),
        };
        let view = if let Some(open) = self.documents.iter_mut().find(|open| open.item == item) {
            open.view.update(cx, |view, cx| {
                if view.dirty() && document.revision != view.document.revision {
                    view.file_failed("content.conflict", cx);
                } else {
                    view.replace(document, cx);
                }
            });
            open.view.clone()
        } else {
            let locale = self.locale.clone();
            let view = cx.new(|cx| ContentReader::new(document, locale, window, cx).workspace(cx));
            let close_item = item.clone();
            let subscription=cx.subscribe_in(&view,window,move |this,_,action,window,cx| {
                match action {
                    ReaderAction::Save {source,revision,text}=>this.command(serde_json::json!({"method":"documents","action":"save","request_id":format!("save:{source}"),"source":source,"revision":revision,"text":text}),cx),
                    ReaderAction::Reload {path}=>this.command(serde_json::json!({"method":"documents","action":"open","request_id":"reload","path":path}),cx),
                    ReaderAction::DiscardAndClose=>this.discard_document(&close_item,window,cx),
                    ReaderAction::Link(href)=> {
                        let origin=match &close_item {WorkspaceItem::Document {origin,..}=>origin,_=>return};
                        match pero_contracts::content_link::ContentLink::resolve(origin,href) {
                            pero_contracts::content_link::ContentLink::File(href)=> {
                                let WorkspaceItem::Document {source,..}=&close_item else {return;};
                                this.command(serde_json::json!({"method":"documents","action":"follow","request_id":"link","source":source,"href":href}),cx);
                            }
                            pero_contracts::content_link::ContentLink::External(url)=>cx.open_url(&url),
                            _=> {this.error=Some(this.t("content.link_unavailable").into());cx.notify();}
                        }
                    }
                }
            });
            let observer = cx.observe(&view, |_, _, cx| cx.notify());
            self.documents.push(WorkspaceDocument {
                item: item.clone(),
                view: view.clone(),
                _subscriptions: vec![subscription, observer],
            });
            view
        };
        self.navigation.open(item);
        self.sync_follow(cx);
        view.update(cx, |view, cx| view.focus(window, cx));
        cx.notify();
    }

    pub(crate) fn has_unsaved_documents(&self,cx:&App)->bool {self.documents.iter().any(|open|open.view.read(cx).dirty())}
    pub(crate) fn choose_document(&mut self, cx: &mut Context<Self>) {
        self.command(serde_json::json!({"action":"choose_document"}), cx);
    }
    pub(crate) fn receive_document(
        &mut self,
        event: &pero_contracts::HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        match event.kind.as_str() {
            "document_choose" => {
                self.choose_document(cx);
                true
            }
            "document_file" | "document_open" => {
                match serde_json::from_value::<pero_contracts::content_document::DocumentHeader>(
                    event.data.clone(),
                ) {
                    Ok(header) => {
                        let document = header.into_document(event.text.clone());
                        if event
                            .request_id
                            .as_deref()
                            .is_some_and(|id| id.starts_with("save:"))
                        {
                            if let Some(open) = self
                                .documents
                                .iter()
                                .find(|open| open.view.read(cx).document.id == document.id)
                            {
                                open.view.update(cx, |view, cx| view.saved(document, cx));
                            }
                        } else if event.request_id.as_deref() == Some("reload") {
                            if let Some(open) = self
                                .documents
                                .iter()
                                .find(|open| open.view.read(cx).document.id == document.id)
                            {
                                open.view
                                    .update(cx, |view, cx| view.reload(document, window, cx));
                            }
                        } else {
                            self.open_document(document, window, cx);
                        }
                        self.error = None;
                    }
                    Err(_) => self.error = Some(self.t("content.file_failed").into()),
                }
                cx.notify();
                true
            }
            "document_error" => {
                let key = match event.data["reason"].as_str() {
                    Some("conflict") => "content.conflict",
                    Some("unsupported") => "content.unsupported",
                    _ => "content.file_failed",
                };
                if let Some(open) = self.documents.iter().find(|open| {
                    Some(open.view.read(cx).document.id.as_str()) == event.data["source"].as_str()
                }) {
                    open.view.update(cx, |view, cx| view.file_failed(key, cx));
                } else {
                    self.error = Some(self.t(key).into());
                }
                cx.notify();
                true
            }
            _ => false,
        }
    }
    pub(crate) fn discard_document(
        &mut self,
        item: &WorkspaceItem,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let WorkspaceItem::Document {
            origin: ContentOrigin::File { .. },
            source,
        } = item
        {
            self.command(
                serde_json::json!({"method":"documents","action":"release","source":source}),
                cx,
            );
        }
        self.documents.retain(|open| &open.item != item);
        if let Some(route) = self.navigation.close(item) {
            self.activate_route(route, window, cx);
        }
        cx.notify();
    }
    pub(crate) fn reconcile_documents(&mut self, cx: &mut Context<Self>) {
        let chats = &self.chat.read(cx).chats;
        self.documents.retain(|open| match &open.item {
            WorkspaceItem::Document {
                origin: ContentOrigin::App { app, panel },
                ..
            } => self.apps.contains_panel(app, panel),
            WorkspaceItem::Document { origin, .. } => origin
                .thread_id()
                .is_none_or(|owner| chats.iter().any(|chat| chat.id == owner)),
            _ => false,
        });
        let updates = self
            .documents
            .iter()
            .filter_map(|open| {
                let WorkspaceItem::Document { origin, source } = &open.item else {
                    return None;
                };
                let document = chats
                    .iter()
                    .find(|chat| Some(chat.id.as_str()) == origin.thread_id())?
                    .tools
                    .iter()
                    .filter_map(|tool| tool.document.as_ref())
                    .find(|document| &document.id == source)?;
                Some((open.view.clone(), document.clone()))
            })
            .collect::<Vec<_>>();
        for (view, document) in updates {
            view.update(cx, |view, cx| view.replace(document, cx));
        }
    }

    pub(crate) fn document_content(&self, _cx: &App) -> AnyElement {
        let view = self
            .documents
            .iter()
            .find(|open| Some(&open.item) == self.navigation.current())
            .map(|open| open.view.clone());
        div()
            .flex_1()
            .min_h_0()
            .children(view.clone())
            .when(view.is_none(), |el| el.child(self.t("content.unavailable")))
            .into_any_element()
    }

    pub(crate) fn document_label(&self, item: &WorkspaceItem, cx: &App) -> (String, &'static str) {
        self.documents
            .iter()
            .find(|open| &open.item == item)
            .map(|open| {
                let icon = match open.view.read(cx).document.format {
                    ContentFormat::Text | ContentFormat::Markdown => "file",
                    _ => "file-code",
                };
                (
                    format!(
                        "{}{}",
                        open.view.read(cx).document.title,
                        if open.view.read(cx).dirty() {
                            " •"
                        } else {
                            ""
                        }
                    ),
                    icon,
                )
            })
            .unwrap_or_else(|| (self.t("content.document").into(), "file"))
    }
}
