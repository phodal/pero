//! Retained document items. Navigation owns selection; each item owns its view.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{prelude::*, *};
use pero_chat_ui::content_reader::ContentReader;
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
            let subscription =
                cx.subscribe_in(&view, window, move |this, reader, action, window, cx| {
                    this.handle_document_action(&close_item, reader, action, window, cx)
                });
            let observed_item = item.clone();
            let observer = cx.observe(&view, move |this, view, cx| {
                this.observe_document_view(&observed_item, &view, cx)
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
        self.navigation.ensure_document_layout();
        if !self.recovery.applying {
            self.ensure_document_panes(window, cx);
        }
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
                match serde_json::from_value::<pero_contracts::content_location::DocumentOpening>(
                    event.data.clone(),
                ) {
                    Ok(opening) => {
                        let (header, location) = opening.into_parts();
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
                                open.view
                                    .update(cx, |view, cx| view.saved(document.clone(), cx));
                                for pane in &self.pane_views {
                                    if pane.item == open.item && pane.view != open.view {
                                        pane.view.update(cx, |view, cx| {
                                            view.saved(document.clone(), cx)
                                        });
                                    }
                                }
                                self.navigation
                                    .bind_document_revision(&open.item, document.revision);
                            }
                        } else if event.request_id.as_deref() == Some("reload") {
                            if let Some(open) = self
                                .documents
                                .iter()
                                .find(|open| open.view.read(cx).document.id == document.id)
                            {
                                open.view.update(cx, |view, cx| {
                                    view.reload(document.clone(), window, cx)
                                });
                                for pane in &self.pane_views {
                                    if pane.item == open.item && pane.view != open.view {
                                        pane.view.update(cx, |view, cx| {
                                            view.reload(document.clone(), window, cx)
                                        });
                                    }
                                }
                            }
                        } else {
                            self.open_document(document, window, cx);
                            if let Some(location) = location {
                                if let Some(item) = self.navigation.current().cloned() {
                                    if let Some(view) = self.active_document_view(&item) {
                                        view.update(cx, |view, cx| {
                                            view.reveal_record(location.record as usize, window, cx)
                                        });
                                    }
                                }
                            }
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
                    for pane in &self.pane_views {
                        if pane.item == open.item && pane.view != open.view {
                            pane.view.update(cx, |view, cx| view.file_failed(key, cx));
                        }
                    }
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
        self.pane_views.retain(|view| &view.item != item);
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
        for pane in &self.pane_views {
            if let Some(primary) = self.documents.iter().find(|open| open.item == pane.item) {
                let document = primary.view.read(cx).document.clone();
                if pane.view != primary.view
                    && !pane.view.read(cx).document.shares_source(&document)
                {
                    pane.view.update(cx, |view, cx| view.replace(document, cx));
                }
            }
        }
    }

    pub(crate) fn document_content(&self, cx: &mut Context<Self>) -> AnyElement {
        if let Some(layout) = self.navigation.pane_layout() {
            if let Some(root) = &layout.root {
                return self.render_pane_tree(root, cx);
            }
        }
        div()
            .flex_1()
            .child(self.t("content.unavailable"))
            .into_any_element()
    }

    pub(crate) fn document_label(&self, item: &WorkspaceItem, cx: &App) -> (String, String) {
        self.documents
            .iter()
            .find(|open| &open.item == item)
            .map(|open| {
                let icon = pero_chat_ui::icon_theme::document_icon(
                    &open.view.read(cx).document,
                    pero_theme::UiAppearance::global(cx).dark,
                );
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
                    "file".into(),
                )
            })
    }
}
