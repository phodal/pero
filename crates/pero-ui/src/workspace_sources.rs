//! Deferred source materialization and recovery reset controls.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::{
    component::{Disableable, Sizable, button::*},
    prelude::*,
    *,
};
use pero_contracts::{
    content_origin::ContentOrigin,
    workspace_session::{SourceKey, WorkspaceSource},
};
impl Workbench {
    pub(crate) fn publish_workspace_source(
        &mut self,
        document: &pero_contracts::content_document::ContentDocument,
        cx: &mut Context<Self>,
    ) {
        let key = SourceKey::of(&document.header());
        if self
            .recovery
            .sent
            .iter()
            .any(|published| published.key == key && published.document.shares_source(document))
        {
            return;
        }
        self.recovery.sequence += 1;
        let request = format!("workspace-source:{}", self.recovery.sequence);
        self.command(serde_json::json!({"method":"workspace","action":"source_begin","request_id":request,"header":document.header(),"total_bytes":document.bytes}),cx);
        let text = document.source();
        let mut offset = 0;
        loop {
            let mut end =
                (offset + pero_contracts::workspace_source::SOURCE_CHUNK_BYTES).min(text.len());
            while !text.is_char_boundary(end) {
                end -= 1;
            }
            let done = end == text.len();
            self.command(serde_json::json!({"method":"workspace","action":"source_chunk","request_id":request,"chunk":{"offset":offset,"text":&text[offset..end],"done":done}}),cx);
            if done {
                break;
            }
            offset = end;
        }
        self.recovery.sent.retain(|published| published.key != key);
        self.recovery
            .sent
            .push(super::workspace_restore::PublishedSource {
                key,
                document: document.clone(),
            });
    }
    pub(crate) fn has_workspace_document(&self, item: &WorkspaceItem) -> bool {
        self.documents.iter().any(|open| &open.item == item)
            || self
                .recovery
                .deferred
                .iter()
                .any(|document| &document.saved.item() == item)
    }
    pub(crate) fn request_workspace_source(
        &mut self,
        item: &WorkspaceItem,
        cx: &mut Context<Self>,
    ) {
        let Some(document) = self
            .recovery
            .deferred
            .iter_mut()
            .find(|document| &document.saved.item() == item)
        else {
            return;
        };
        if document.loading {
            return;
        }
        document.loading = true;
        document.failed = false;
        let key = SourceKey::of(&document.saved.header);
        self.recovery.sequence += 1;
        self.command(serde_json::json!({"method":"workspace","action":"read","request_id":format!("workspace-read:{}",self.recovery.sequence),"key":key}),cx);
    }
    pub(crate) fn materialize_workspace_source(
        &mut self,
        source: WorkspaceSource,
        conflict: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let key = SourceKey::of(&source.header);
        let Some(index) = self
            .recovery
            .deferred
            .iter()
            .position(|document| SourceKey::of(&document.saved.header) == key)
        else {
            return;
        };
        let deferred = self.recovery.deferred.remove(index);
        self.restore_workspace_draft(
            key.clone(),
            deferred.saved.draft_ref.clone(),
            deferred.saved.draft.as_deref(),
            source.text.len(),
        );
        let item = deferred.saved.item();
        let navigation = self.navigation.snapshot();
        let applying = self.recovery.applying;
        self.recovery.applying = true;
        self.open_document(source.header.into_document(source.text), window, cx);
        self.navigation.restore(navigation);
        if let Some(open) = self.documents.iter_mut().find(|open| open.item == item) {
            self.recovery
                .sent
                .push(super::workspace_restore::PublishedSource {
                    key,
                    document: open.view.read(cx).document.clone(),
                });
            open.owner_seen = false;
            open.cached = !matches!(
                deferred.saved.header.source.origin,
                ContentOrigin::File { .. }
            );
            open.view.update(cx, |view, cx| {
                if let Some(draft) = deferred.saved.draft {
                    view.restore_draft(draft, window, cx);
                }
                view.restore_reading_state(deferred.saved.reading, window, cx);
                if conflict {
                    view.file_failed("content.conflict", cx);
                }
                if deferred.close_after_load {
                    view.request_close(cx);
                }
            });
        }
        self.recovery.applying = applying;
        if !applying {
            self.ensure_document_panes(window, cx);
        }
        if !applying && self.navigation.current() == Some(&item) {
            self.activate_route(crate::workspace::WorkspaceRoute::Content(item), window, cx);
        }
        cx.notify();
    }
    pub(crate) fn deferred_document_content(
        &self,
        item: &WorkspaceItem,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let deferred = self
            .recovery
            .deferred
            .iter()
            .find(|document| &document.saved.item() == item);
        let failed = deferred.is_some_and(|document| document.failed);
        let draft = deferred.is_some_and(|document| {
            (document.saved.draft.is_some()
                || document.saved.draft_ref.is_some()
                || document.saved.legacy_draft)
        });
        let retry = item.clone();
        let copy = item.clone();
        let close = item.clone();
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .p(px(16.))
            .child(self.t(if failed {
                "workspace.source_failed"
            } else {
                "workspace.source_loading"
            }))
            .when(failed, |view| {
                view.child(
                    Button::new("retry-workspace-source")
                        .small()
                        .label(self.t("workspace.source_retry"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request_workspace_source(&retry, cx)
                        })),
                )
            })
            .when(failed && draft, |view| {
                view.child(
                    Button::new("save-recovery-draft")
                        .small()
                        .label(self.t("content.save_as"))
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.choose_document_copy(&copy, cx)),
                        ),
                )
            })
            .when(failed, |view| {
                view.child(
                    Button::new("close-unavailable-source")
                        .ghost()
                        .small()
                        .label(self.t(
                            if draft && deferred.is_some_and(|document| document.close_after_load) {
                                "workspace.discard_missing_confirm"
                            } else if draft {
                                "workspace.discard_missing"
                            } else {
                                "workspace.close_missing"
                            },
                        ))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            let Some(deferred) = this
                                .recovery
                                .deferred
                                .iter_mut()
                                .find(|document| document.saved.item() == close)
                            else {
                                return;
                            };
                            if draft && !deferred.close_after_load {
                                deferred.close_after_load = true;
                                cx.notify();
                                return;
                            }
                            this.discard_document(&close, window, cx);
                        })),
                )
            })
            .into_any_element()
    }
    pub(crate) fn recovery_controls(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.recovery.failed {
            return None;
        }
        Some(div().flex().items_center().gap(px(8.)).px(px(20.)).py(px(6.))
            .when(self.recovery.reset_confirm,|view|view.child(self.t("workspace.reset_warning")))
            .child(Button::new("reset-workspace-recovery").small().label(self.t(if self.recovery.reset_confirm {"workspace.reset_confirm"} else {"workspace.reset"})).disabled(self.recovery.reset_pending.is_some()).on_click(cx.listener(|this,_,_,cx| {
                if !this.recovery.reset_confirm {this.recovery.reset_confirm=true;cx.notify();return;}
                this.recovery.sequence+=1;let request=format!("workspace-reset:{}",this.recovery.sequence);this.recovery.reset_pending=Some(request.clone());
                this.command(serde_json::json!({"method":"workspace","action":"reset","request_id":request}),cx);
            })))
            .when(self.recovery.reset_confirm,|view|view.child(Button::new("cancel-workspace-reset").ghost().small().label(self.t("content.keep_editing")).on_click(cx.listener(|this,_,_,cx| {this.recovery.reset_confirm=false;cx.notify();}))))
            .into_any_element())
    }
}
