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
        let Some(open) = self.documents.iter().find(|open| &open.item == item) else {
            return;
        };
        let source = &open.view.read(cx).document;
        let suggested = match &source.origin {
            ContentOrigin::File { path } => path.clone(),
            _ => {
                let mut name = source.title.clone();
                if std::path::Path::new(&name).extension().is_none() {
                    let extension = match source.format {
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
    pub(crate) fn save_as_pending(&self, item: &WorkspaceItem) -> bool {
        self.pending_save_as
            .as_ref()
            .is_some_and(|pending| &pending.item == item)
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
            let Some(open) = self.documents.iter().find(|open| open.item == item) else {
                self.pending_save_as = None;
                self.error = Some(self.t("content.unavailable").into());
                return true;
            };
            let reader = open.view.read(cx);
            let text = reader
                .draft(cx)
                .unwrap_or_else(|| reader.document.source().into());
            let protected_sources = self
                .documents
                .iter()
                .filter(|open| open.item != item && open.view.read(cx).dirty())
                .map(|open| open.view.read(cx).document.id.clone())
                .collect::<Vec<_>>();
            self.command(serde_json::json!({"method":"documents","action":"save_as","request_id":request,"copy":{"path":path,"text":text,"protected_sources":protected_sources}}),cx);
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
            .documents
            .iter()
            .find(|open| open.item == item)
            .map(|open| {
                let view = open.view.read(cx);
                (
                    view.reading_state(cx),
                    view.draft(cx)
                        .unwrap_or_else(|| view.document.source().into()),
                )
            });
        // A destination edited while the picker/write was pending keeps its own buffer.
        if self
            .documents
            .iter()
            .any(|open| open.item == target && open.item != item && open.view.read(cx).dirty())
        {
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
        if file_source {
            self.navigation.replace_identity(&item, target.clone());
            self.documents.retain(|open| open.item != item);
            if let WorkspaceItem::Document { source, .. } = &item {
                if source != &document.id {
                    self.command(serde_json::json!({"method":"documents","action":"release","source":source}),cx);
                }
            }
        }
        let saved = document.source().to_string();
        self.open_document(document, window, cx);
        if let Some((reading, current)) = source {
            if let Some(open) = self.documents.iter().find(|open| open.item == target) {
                open.view.update(cx, |view, cx| {
                    let mut reading = reading;
                    if file_source && current != saved {
                        // Restore newer edits before bounding their selection against the target text.
                        view.restore_draft(current, window, cx);
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
