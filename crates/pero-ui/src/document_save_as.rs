//! Workbench-owned Save As: picker intent, Host write, then source identity transition.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{prelude::*, *};
use pero_contracts::{HostEvent, content_document::ContentDocument, content_origin::ContentOrigin};
gpui_kit::actions!(documents, [SaveDocumentAs]);

pub(crate) struct PendingSaveAs {
    request: String,
    item: WorkspaceItem,
}
pub(crate) struct SaveAsFeedback {
    pub item: WorkspaceItem,
    pub key: &'static str,
}
impl Workbench {
    pub(crate) fn choose_document_save_as(&mut self, cx: &mut Context<Self>) {
        let Some(item) = self.navigation.current().cloned() else {
            return;
        };
        self.choose_document_copy(&item, cx);
    }
    pub(crate) fn choose_document_copy(&mut self, item: &WorkspaceItem, cx: &mut Context<Self>) {
        if !self.connected {
            self.error = Some(self.t("error.connection").into());
            cx.notify();
            return;
        }
        if self.pending_save_as.is_some() {
            return;
        }
        let header = if let Some(open) = self.documents.iter().find(|open| &open.item == item) {
            open.view.read(cx).document.header()
        } else if let Some(document) = self.recovery.deferred.iter().find(|document| {
            &document.saved.item() == item
                && (document.saved.draft.is_some() || document.saved.draft_ref.is_some())
        }) {
            document.saved.header.clone()
        } else {
            return;
        };
        if self.workspace_file_busy(&pero_contracts::workspace_session::SourceKey::of(&header)) {
            return;
        }
        let suggested = match &header.source.origin {
            ContentOrigin::File { path } => path.clone(),
            _ => {
                let mut name = header.source.title.clone();
                if std::path::Path::new(&name).extension().is_none() {
                    let extension = match header.format {
                        pero_contracts::content_document::ContentFormat::Json => "json",
                        pero_contracts::content_document::ContentFormat::JsonLines => "jsonl",
                        pero_contracts::content_document::ContentFormat::Markdown => "md",
                        _ => "txt",
                    };
                    name.push_str(&format!(".{extension}"));
                }
                name
            }
        };
        self.next_request += 1;
        let request = format!("save-as:{}", self.next_request);
        self.pending_save_as = Some(PendingSaveAs {
            request: request.clone(),
            item: item.clone(),
        });
        self.save_as_feedback = None;
        self.error = None;
        self.command(serde_json::json!({"action":"choose_document_save","request_id":request,"suggested":suggested}),cx);
    }
    pub(crate) fn receive_document_save_as(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        if event.kind == "disconnected" {
            if let Some(pending) = self.pending_save_as.take() {
                self.save_as_feedback = Some(SaveAsFeedback {
                    item: pending.item,
                    key: "content.file_failed",
                });
            }
            return false;
        }
        if event.kind == "document_save_choose" {
            self.choose_document_save_as(cx);
            return true;
        }
        let Some(pending) = self.pending_save_as.as_ref() else {
            return false;
        };
        if event.request_id.as_deref() != Some(pending.request.as_str()) {
            return false;
        }
        if event.kind == "document_save_path" {
            let item = pending.item.clone();
            let request = pending.request.clone();
            let Some(path) = event.data["path"].as_str() else {
                return false;
            };
            let legacy = self
                .recovery
                .deferred
                .iter()
                .find(|document| {
                    document.saved.item() == item && document.saved.draft_ref.is_none()
                })
                .and_then(|document| document.saved.draft.clone());
            let view = self.active_document_view(&item);
            let document = view.as_ref().map(|view| view.read(cx).document.clone());
            let (key, draft) = if let Some(document) = &document {
                let dirty = view.as_ref().is_some_and(|view| view.read(cx).dirty());
                let draft = self.flush_workspace_draft(document, dirty, cx);
                if !matches!(document.origin, ContentOrigin::File { .. }) {
                    self.publish_workspace_source(document, cx);
                }
                (
                    pero_contracts::workspace_session::SourceKey::of(&document.header()),
                    draft,
                )
            } else if let Some(document) = self
                .recovery
                .deferred
                .iter()
                .find(|document| document.saved.item() == item)
            {
                (
                    pero_contracts::workspace_session::SourceKey::of(&document.saved.header),
                    document.saved.draft_ref.clone(),
                )
            } else {
                self.pending_save_as = None;
                self.error = Some(self.t("content.unavailable").into());
                return true;
            };
            if matches!(key.origin, ContentOrigin::File { .. }) {
                self.begin_workspace_file_copy(key.clone());
            }
            let mut protected_sources = self
                .documents
                .iter()
                .filter(|open| open.item != item && open.view.read(cx).dirty())
                .map(|open| open.view.read(cx).document.id.clone())
                .collect::<Vec<_>>();
            protected_sources.extend(
                self.recovery
                    .deferred
                    .iter()
                    .filter(|document| {
                        document.saved.item() != item
                            && (document.saved.draft.is_some()
                                || document.saved.draft_ref.is_some()
                                || document.saved.legacy_draft)
                    })
                    .map(|document| document.saved.header.source.id.clone()),
            );
            if let Some(text) = legacy {
                self.command(serde_json::json!({"method":"documents","action":"save_as","request_id":request,"copy":{"path":path,"text":text,"protected_sources":protected_sources}}),cx);
            } else {
                self.command(serde_json::json!({"method":"documents","action":"save_as_reference","request_id":request,"path":path,"source":key,"draft":draft,"protected_sources":protected_sources}),cx);
            }
            return true;
        }
        if !matches!(
            event.kind.as_str(),
            "document_save_cancelled" | "document_file" | "document_error" | "error"
        ) {
            return false;
        }
        let pending = self.pending_save_as.take().unwrap();
        match event.kind.as_str() {
            "document_save_cancelled" => {
                self.save_as_feedback = Some(SaveAsFeedback {
                    item: pending.item,
                    key: "content.save_as_cancelled",
                })
            }
            "document_file" => {
                match serde_json::from_value::<pero_contracts::content_document::DocumentHeader>(
                    event.data.clone(),
                ) {
                    Ok(header) => self.complete_document_copy(
                        pending.item,
                        header.into_document(event.text.clone()),
                        window,
                        cx,
                    ),
                    Err(_) => self.error = Some(self.t("content.file_failed").into()),
                }
            }
            _ => {
                let key = if event.data["reason"] == "conflict" {
                    "content.save_as_conflict"
                } else {
                    "content.file_failed"
                };
                if let WorkspaceItem::Document { source, .. } = &pending.item {
                    self.failed_workspace_file_save(source);
                }
                for open in &self.documents {
                    if open.item == pending.item {
                        open.view.update(cx, |view, cx| view.file_failed(key, cx));
                    }
                }
                for pane in &self.pane_views {
                    if pane.item == pending.item {
                        pane.view.update(cx, |view, cx| view.file_failed(key, cx));
                    }
                }
                self.error = Some(self.t(key).into());
                self.save_as_feedback = Some(SaveAsFeedback {
                    item: pending.item,
                    key,
                });
            }
        }
        cx.notify();
        true
    }
    fn complete_document_copy(
        &mut self,
        item: WorkspaceItem,
        document: ContentDocument,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target = WorkspaceItem::Document {
            origin: document.origin.clone(),
            source: document.id.clone(),
        };
        let source = self
            .active_document_view(&item)
            .map(|view| {
                let view = view.read(cx);
                (
                    view.reading_state(cx),
                    view.draft(cx)
                        .unwrap_or_else(|| view.document.source().into()),
                )
            })
            .or_else(|| {
                self.recovery
                    .deferred
                    .iter()
                    .find(|document| document.saved.item() == item)
                    .and_then(|document| {
                        document
                            .saved
                            .draft
                            .as_ref()
                            .map(|draft| (document.saved.reading.clone(), draft.clone()))
                    })
            });
        // A destination edited while the picker/write was pending keeps its own buffer.
        if self
            .documents
            .iter()
            .any(|open| open.item == target && open.item != item && open.view.read(cx).dirty())
        {
            if let WorkspaceItem::Document { source, .. } = &item {
                self.failed_workspace_file_save(source);
            }
            self.error = Some(self.t("content.save_as_conflict").into());
            return;
        }
        let file_source = matches!(
            &item,
            WorkspaceItem::Document {
                origin: ContentOrigin::File { .. },
                ..
            }
        );
        let pane_readings = self
            .pane_views
            .iter()
            .filter(|pane| pane.item == item)
            .map(|pane| (pane.id, pane.view.read(cx).reading_state(cx)))
            .collect::<Vec<_>>();
        if file_source {
            self.navigation.replace_identity(&item, target.clone());
            self.documents.retain(|open| open.item != item);
            self.recovery
                .deferred
                .retain(|document| document.saved.item() != item);
            if let WorkspaceItem::Document { source, .. } = &item {
                if source != &document.id {
                    self.command(serde_json::json!({"method":"documents","action":"release","source":source}),cx);
                }
            }
        }
        if file_source {
            self.copied_workspace_file(&item, &document);
        }
        let saved = document.source().to_string();
        self.open_document(document, window, cx);
        if let Some((reading, current)) = source {
            let mut targets = self
                .documents
                .iter()
                .filter(|open| open.item == target)
                .map(|open| open.view.clone())
                .collect::<Vec<_>>();
            for pane in &self.pane_views {
                if pane.item == target && !targets.contains(&pane.view) {
                    targets.push(pane.view.clone());
                }
            }
            for view in targets {
                let pane_reading = self
                    .pane_views
                    .iter()
                    .find(|pane| pane.view == view)
                    .and_then(|pane| pane_readings.iter().find(|(id, _)| *id == pane.id))
                    .map(|(_, reading)| reading.clone())
                    .unwrap_or_else(|| reading.clone());
                view.update(cx, |view, cx| {
                    let mut reading = pane_reading;
                    if file_source && current != saved {
                        // Restore newer edits before bounding their selection against the target text.
                        view.restore_draft(current.clone(), window, cx);
                    } else if current != saved {
                        // A producer changed after copying: its newer geometry does not describe this file.
                        reading = reading.without_location();
                    }
                    reading.source_revision = Some(view.document.revision);
                    view.restore_reading_state(reading, window, cx);
                });
            }
        }
        self.error = None;
        self.queue_workspace_checkpoint(cx);
    }
}
