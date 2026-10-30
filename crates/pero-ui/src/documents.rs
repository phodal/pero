//! Retained document items. Navigation owns selection; each item owns its view.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{
    component::{ActiveTheme, Disableable, Sizable, button::ButtonVariants as _},
    prelude::*,
    *,
};
use pero_chat_ui::content_reader::{ContentReader, ReaderAction};
use pero_contracts::content_document::ContentDocument;
use pero_contracts::content_origin::ContentOrigin;

pub(crate) struct WorkspaceDocument {
    pub item: WorkspaceItem,
    pub view: Entity<ContentReader>,
    pub cached: bool,
    pub owner_seen: bool,
    _subscriptions: Vec<Subscription>,
}

impl Workbench {
    pub(crate) fn open_document(
        &mut self,
        document: ContentDocument,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        let item = WorkspaceItem::Document {
            origin: document.origin.clone(),
            source: document.id.clone(),
        };
        self.recovery
            .deferred
            .retain(|document| document.saved.item() != item);
        let recovered = self
            .documents
            .iter()
            .position(|open| open.item == item && open.cached)
            .map(|index| {
                let open = self.documents.remove(index);
                open.view.read(cx).reading_state(cx)
            });
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
            let view =
                cx.new(|cx| ContentReader::new(document, locale, window, cx).workspace(window, cx));
            let close_item = item.clone();
            let subscription=cx.subscribe_in(&view,window,move |this,_,action,window,cx| {
                match action {
                    ReaderAction::Save {source,revision,text}=>this.command(serde_json::json!({"method":"documents","action":"save","request_id":format!("save:{source}"),"source":source,"revision":revision,"text":text}),cx),
                    ReaderAction::Navigate {before,after}=>this.record_document_jump(&close_item,before.clone(),after.clone(),cx),
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
            let observed_item = item.clone();
            let observer = cx.observe(&view, move |this, view, cx| {
                this.navigation
                    .observe_reading(&observed_item, view.read(cx).reading_state(cx));
                this.queue_workspace_checkpoint(cx);
                cx.notify();
            });
            self.documents.push(WorkspaceDocument {
                item: item.clone(),
                view: view.clone(),
                cached: false,
                owner_seen: true,
                _subscriptions: vec![subscription, observer],
            });
            view
        };
        if let Some(state) = recovered {
            view.update(cx, |view, cx| view.restore_reading_state(state, window, cx));
        }
        self.navigation.open(item);
        self.sync_follow(cx);
        self.queue_workspace_checkpoint(cx);
        view.update(cx, |view, cx| view.focus(window, cx));
        cx.notify();
    }

    pub(crate) fn has_unsaved_documents(&self, cx: &App) -> bool {
        self.documents.iter().any(|open| open.view.read(cx).dirty())
            || self
                .recovery
                .deferred
                .iter()
                .any(|document| document.saved.draft.is_some())
    }
    pub(crate) fn choose_document(&mut self, cx: &mut Context<Self>) {
        self.command(serde_json::json!({"action":"choose_document"}), cx);
    }
    pub(crate) fn receive_document(
        &mut self,
        event: &pero_contracts::HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if self.receive_document_save_as(event, window, cx) {
            return true;
        }
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
        self.recovery
            .deferred
            .retain(|document| &document.saved.item() != item);
        self.queue_workspace_checkpoint(cx);
        if let Some(route) = self.navigation.close(item) {
            self.activate_route(route, window, cx);
        }
        cx.notify();
    }
    pub(crate) fn reconcile_documents(&mut self, cx: &mut Context<Self>) {
        let chats = &self.chat.read(cx).chats;
        self.documents.retain_mut(|open| {
            let available = match &open.item {
                WorkspaceItem::Document {
                    origin: ContentOrigin::App { app, panel },
                    ..
                } => self.apps.contains_panel(app, panel),
                WorkspaceItem::Document { origin, .. } => origin
                    .thread_id()
                    .is_none_or(|owner| chats.iter().any(|chat| chat.id == owner)),
                _ => false,
            };
            if available {
                open.owner_seen = true;
            }
            available || open.cached && !open.owner_seen
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

    pub(crate) fn document_content(&self, cx: &mut Context<Self>) -> AnyElement {
        let panes = self.navigation.panes();
        let items = panes
            .map(|(left, right, focused)| (vec![left.clone(), right.clone()], focused))
            .unwrap_or_else(|| {
                (
                    self.navigation.current().cloned().into_iter().collect(),
                    crate::workspace::PaneSide::Left,
                )
            });
        let split = items.0.len() == 2;
        div()
            .flex()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .children(items.0.into_iter().enumerate().map(|(index, item)| {
                let open = self.documents.iter().find(|open| open.item == item);
                let cached = open.is_some_and(|open| open.cached);
                let selected = item.clone();
                div()
                    .id(("document-pane", index))
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_w_0()
                    .min_h_0()
                    .when(split, |pane| {
                        pane.border_l_1().border_color(cx.theme().border)
                    })
                    .on_mouse_down(
                        MouseButton::Left,
                        cx.listener(move |this, _, window, cx| {
                            if let Some(route) = this.navigation.select(&selected) {
                                this.activate_route(route, window, cx);
                            }
                            this.queue_workspace_checkpoint(cx);
                        }),
                    )
                    .map(|pane| {
                        pane.child(
                            div()
                                .h(px(28.))
                                .flex()
                                .items_center()
                                .px(px(8.))
                                .text_size(px(12.))
                                .child(
                                    div().flex_1().truncate().child(
                                        open.map(|open| open.view.read(cx).document.title.clone())
                                            .unwrap_or_default(),
                                    ),
                                )
                                .child(
                                    gpui_kit::component::button::Button::new("save-document-as")
                                        .ghost()
                                        .small()
                                        .label(self.t(if self.save_as_pending(&item) {
                                            "content.saving_as"
                                        } else {
                                            "content.save_as"
                                        }))
                                        .disabled(self.pending_save_as.is_some())
                                        .accessibility_label(self.t("content.save_as"))
                                        .on_click(cx.listener({
                                            let item = item.clone();
                                            move |this, _, _, cx| {
                                                this.choose_document_copy(&item, cx)
                                            }
                                        })),
                                )
                                .when(index == 1 && split, |header| {
                                    header.child(
                                        gpui_kit::component::button::Button::new(
                                            "close-document-split",
                                        )
                                        .ghost()
                                        .small()
                                        .icon(gpui_kit::component::IconName::Close)
                                        .tooltip(self.t("workspace.close_split"))
                                        .on_click(
                                            cx.listener(|this, _, window, cx| {
                                                this.toggle_document_split(window, cx)
                                            }),
                                        ),
                                    )
                                }),
                        )
                    })
                    .when(
                        self.save_as_feedback
                            .as_ref()
                            .is_some_and(|feedback| feedback.item == item),
                        |pane| {
                            pane.child(
                                div()
                                    .px(px(8.))
                                    .text_size(px(12.))
                                    .child(self.t(self.save_as_feedback.as_ref().unwrap().key)),
                            )
                        },
                    )
                    .when(cached, |pane| {
                        pane.child(
                            div()
                                .p(px(8.))
                                .text_size(px(12.))
                                .text_color(cx.theme().muted_foreground)
                                .child(self.t("workspace.cached_source")),
                        )
                    })
                    .children(open.map(|open| open.view.clone()))
                    .when(open.is_none(), |pane| {
                        pane.child(self.deferred_document_content(&item, cx))
                    })
            }))
            .into_any_element()
    }

    pub(crate) fn document_label(&self, item: &WorkspaceItem, cx: &App) -> (String, &'static str) {
        self.documents
            .iter()
            .find(|open| &open.item == item)
            .map(|open| {
                let icon = pero_chat_ui::assets::UiIcon::for_document(
                    &open.view.read(cx).document,
                    pero_theme::UiAppearance::global(cx).dark,
                )
                .name();
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
            .unwrap_or_else(|| {
                (
                    self.recovery
                        .deferred
                        .iter()
                        .find(|document| &document.saved.item() == item)
                        .map(|document| document.saved.header.source.title.clone())
                        .unwrap_or_else(|| self.t("content.document").into()),
                    "file",
                )
            })
    }
}
