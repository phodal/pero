//! Workbench recovery orchestration. Host owns durable bytes; views own reading state.
use crate::{
    app::Workbench,
    workspace::{WorkbenchPage, WorkspaceItem, WorkspaceRoute, WorkspaceSnapshot},
};
use gpui_kit::{prelude::*, *};
use pero_contracts::{
    HostEvent,
    content_origin::ContentOrigin,
    workspace_session::{
        SavedDocument, SavedWeb, SourceKey, WorkspaceRestore, WorkspaceSession, WorkspaceSource,
    },
};

#[derive(Default)]
pub(crate) struct WorkspaceRecovery {
    requested: bool,
    ready: bool,
    pub(crate) applying: bool,
    queued: bool,
    replayed: bool,
    catalog: bool,
    pending: Option<WorkspaceRestore>,
    last: Option<WorkspaceSession>,
    pub(crate) sent: Vec<PublishedSource>,
    pub(crate) sequence: u64,
    pub(crate) deferred: Vec<DeferredDocument>,
    pub(crate) drafts: Vec<crate::workspace_draft_upload::DraftUpload>,
    pub(crate) failed: bool,
    pub(crate) reset_confirm: bool,
    pub(crate) reset_pending: Option<String>,
    #[cfg(not(target_family = "wasm"))]
    native_close: Option<String>,
}
pub(crate) struct DeferredDocument {
    pub saved: SavedDocument,
    pub loading: bool,
    pub failed: bool,
    pub close_after_load: bool,
}
pub(crate) struct PublishedSource {
    pub(crate) key: SourceKey,
    pub(crate) document: pero_contracts::content_document::ContentDocument,
}
impl Workbench {
    pub(crate) fn receive_workspace(
        &mut self,
        event: &HostEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        match event.kind.as_str() {
            "ready" => {
                if !self.recovery.requested {
                    self.recovery.requested = true;
                    self.command(serde_json::json!({"method":"workspace","action":"get"}), cx);
                }
                false
            }
            "replay" => {
                self.recovery.replayed = true;
                false
            }
            "apps_catalog" => {
                self.recovery.catalog = true;
                false
            }
            "workspace_restored" => {
                match serde_json::from_value::<WorkspaceRestore>(event.data.clone()) {
                    Ok(restored) => self.recovery.pending = Some(restored),
                    Err(_) => self.error = Some(self.t("workspace.recovery_failed").into()),
                }
                true
            }
            "workspace_source" => {
                if let Ok(recovered) = serde_json::from_value::<
                    pero_contracts::workspace_session::RecoveredSource,
                >(event.data.clone())
                {
                    if let Some(draft) = recovered.draft {
                        let key = SourceKey::of(&recovered.source.header);
                        if let Some(document) = self
                            .recovery
                            .deferred
                            .iter_mut()
                            .find(|document| SourceKey::of(&document.saved.header) == key)
                        {
                            document.saved.draft = Some(draft);
                        }
                    }
                    self.materialize_workspace_source(
                        recovered.source,
                        recovered.conflict,
                        window,
                        cx,
                    );
                }
                true
            }
            "workspace_source_error" => {
                if let Ok(key) = serde_json::from_value::<SourceKey>(event.data["key"].clone()) {
                    if let Some(document) = self
                        .recovery
                        .deferred
                        .iter_mut()
                        .find(|document| SourceKey::of(&document.saved.header) == key)
                    {
                        document.loading = false;
                        document.failed = true;
                        if let Some(draft) = event.data["draft"].as_str() {
                            document.saved.draft = Some(draft.to_owned());
                        }
                    }
                    self.resume_workspace_close(&WorkspaceItem::Document { origin: key.origin, source: key.source }, false, window, cx);
                }
                cx.notify();
                true
            }
            "workspace_reset" => {
                self.recovery.reset_pending = None;
                self.recovery.reset_confirm = false;
                self.recovery.failed = false;
                self.recovery.ready = true;
                self.recovery.sent.clear();
                self.recovery.last = None;
                let dirty = self
                    .documents
                    .iter()
                    .filter_map(|open| {
                        let view = open.view.read(cx);
                        view.draft(cx).map(|text| {
                            (
                                SourceKey::of(&view.document.header()),
                                text,
                                view.document.bytes,
                            )
                        })
                    })
                    .collect::<Vec<_>>();
                for (source, text, bytes) in dirty {
                    self.restore_workspace_draft(source, None, Some(&text), bytes);
                }
                self.error = None;
                self.queue_workspace_checkpoint(cx);
                cx.notify();
                true
            }
            "workspace_source_stored" => true,
            "draft_stored" => {
                if let Some(request) = &event.request_id {
                    self.acknowledge_workspace_draft(request);
                }
                true
            }
            "workspace_saved" => {
                #[cfg(not(target_family = "wasm"))]
                if self.recovery.native_close.as_deref() == event.request_id.as_deref()
                    && self.recovery.native_close.is_some()
                {
                    self.recovery.native_close = None;
                    let handle = window.window_handle();
                    cx.defer(move |cx| {
                        let _ = handle.update(cx, |_, window, _| window.remove_window());
                    });
                }
                true
            }
            "workspace_error" => {
                self.pending_close = None;
                #[cfg(not(target_family = "wasm"))]
                if self.recovery.native_close.as_deref() == event.request_id.as_deref()
                    && self.recovery.native_close.is_some()
                {
                    self.recovery.native_close = None;
                    let answer = window.prompt(
                        PromptLevel::Warning,
                        self.t("workspace.save_failed"),
                        Some(&event.text),
                        &[
                            self.t("content.keep_editing"),
                            self.t("workspace.recovery_close"),
                        ],
                        cx,
                    );
                    cx.spawn_in(window, async move |_, cx| {
                        if answer.await == Ok(1) {
                            let _ = cx.update(|window, _| window.remove_window());
                        }
                    })
                    .detach();
                }

                self.recovery.reset_pending = None;
                self.recovery.sent.clear();
                self.recovery.last = None;
                if event.request_id.is_none() {
                    self.recovery.failed = true;
                    self.recovery.ready = false;
                }
                self.error = Some(
                    self.t(if event.request_id.is_some() {
                        "workspace.save_failed"
                    } else {
                        "workspace.recovery_failed"
                    })
                    .into(),
                );
                true
            }
            _ => false,
        }
    }
    pub(crate) fn apply_workspace_recovery(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.recovery.replayed || !(self.recovery.catalog || cfg!(not(target_family = "wasm")))
        {
            return;
        }
        let Some(restored) = self.recovery.pending.take() else {
            return;
        };
        self.recovery.ready = true;
        let Some(mut session) = restored.session else {
            #[cfg(not(target_family = "wasm"))]
            self.navigation.show(WorkbenchPage::Conversation);
            return;
        };
        // A user action made while loading wins over the saved selection.
        if self.navigation.snapshot() != WorkspaceSnapshot::default() {
            return;
        }
        self.recovery.applying = true;
        self.recovery.sent.clear();
        self.recovery.deferred = session
            .documents
            .iter()
            .cloned()
            .map(|saved| DeferredDocument {
                failed: restored.unavailable.contains(&SourceKey::of(&saved.header)),
                saved,
                loading: false,
                close_after_load: false,
            })
            .collect();
        self.navigation.restore(session.navigation.clone());
        for source in restored.sources {
            let conflict = restored.conflicts.contains(&source.header.source.id);
            self.materialize_workspace_source(source, conflict, window, cx);
        }
        for page in &session.web {
            let mut document = if let Some(html) = &page.html {
                pero_contracts::web_document::WebDocument::inline(html.clone())
            } else {
                pero_contracts::web_document::WebDocument::open(
                    pero_contracts::web_document::WebAddress::try_from(page.id.clone())
                        .expect("saved Web identity"),
                )
            };
            document.observation.url = page.url.clone();
            self.web_documents.push(document);
            self.web_command(
                serde_json::json!({"action":"web_restore","id":page.id,"url":page.url,"html":page.html}),
                window,
                cx,
            );
        }
        let route = self.navigation.route().clone();
        for document in &mut session.documents {
            if document.draft_ref.is_some() || document.legacy_draft {
                document.draft = None;
            }
        }
        self.recovery.last = Some(session);
        self.recovery.applying = false;
        self.restore_pane_app_surfaces(cx);
        self.activate_route(route, window, cx);
    }
    pub(crate) fn queue_workspace_checkpoint(&mut self, cx: &mut Context<Self>) {
        if !self.connected || !self.recovery.ready || self.recovery.applying || self.recovery.queued
        {
            return;
        }
        self.recovery.queued = true;
        cx.spawn(async move |this, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(500))
                .await;
            let _ = this.update(cx, |this, cx| {
                this.recovery.queued = false;
                if let Some(command) = this.workspace_checkpoint(false, false, cx) {
                    this.command(command, cx);
                }
            });
        })
        .detach();
    }
    pub(crate) fn remember_current_location(&mut self, cx: &App) {
        let Some(item) = self.navigation.current().cloned() else {
            return;
        };
        if let Some(view) = self.active_document_view(&item) {
            self.navigation
                .observe_reading(&item, view.read(cx).reading_state(cx));
        }
    }
    pub(crate) fn record_document_jump(
        &mut self,
        item: &WorkspaceItem,
        before: pero_contracts::reader_state::ReaderState,
        after: pero_contracts::reader_state::ReaderState,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        self.navigation.select(item);
        self.navigation.jump(item, before, after);
        self.queue_workspace_checkpoint(cx);
        cx.notify();
    }
    /// Force is used at a window boundary, where the caller waits for the Host acknowledgement.
    pub(crate) fn workspace_checkpoint(
        &mut self,
        discard: bool,
        force: bool,
        cx: &mut Context<Self>,
    ) -> Option<serde_json::Value> {
        if !self.recovery.ready || self.recovery.applying {
            return None;
        }
        for view in &self.pane_views {
            self.navigation
                .observe_view_reading(view.id, view.view.read(cx).reading_state(cx));
        }
        self.remember_current_location(cx);
        let expired = self.navigation.prune_document_registry();
        self.documents.retain(|open| !expired.contains(&open.item));
        self.pane_views.retain(|view| !expired.contains(&view.item));
        self.recovery.deferred.retain(|open| !expired.contains(&open.saved.item()));
        for item in expired {
            if let WorkspaceItem::Document { origin: ContentOrigin::File { .. }, source } = item {
                self.command(serde_json::json!({"method":"documents","action":"release","source":source}), cx);
            }
        }
        let navigation = self.navigation.snapshot();
        let mut documents = Vec::new();
        let sources: Vec<WorkspaceSource> = Vec::new();
        let mut refresh = Vec::new();
        let open_documents = self
            .documents
            .iter()
            .filter(|open| navigation.items.contains(&open.item))
            .map(|open| (open.item.clone(), open.view.clone()))
            .collect::<Vec<_>>();
        for (_, view) in open_documents {
            let document = view.read(cx).document.clone();
            let header = document.header();
            let key = SourceKey::of(&header);
            let dirty = view.read(cx).dirty();
            let draft_ref = if discard {
                None
            } else {
                self.flush_workspace_draft(&document, dirty, cx)
            };
            documents.push(SavedDocument {
                header: header.clone(),
                reading: view.read(cx).reading_state(cx),
                draft: None,
                draft_ref,
                legacy_draft: false,
            });
            if !self
                .recovery
                .sent
                .iter()
                .any(|sent| sent.key == key && sent.document.shares_source(&document))
            {
                if matches!(header.source.origin, ContentOrigin::File { .. }) {
                    refresh.push(key.clone());
                } else {
                    self.publish_workspace_source(&document, cx);
                }
                self.recovery.sent.retain(|sent| sent.key != key);
                self.recovery.sent.push(PublishedSource { key, document });
            }
        }
        documents.extend(
            self.recovery
                .deferred
                .iter()
                .filter(|document| navigation.items.contains(&document.saved.item()))
                .map(|document| {
                    let mut saved = document.saved.clone();
                    if saved.legacy_draft {
                        saved.draft = None;
                    }
                    if discard {
                        saved.draft = None;
                        saved.draft_ref = None;
                        saved.legacy_draft = false;
                    }
                    saved
                }),
        );
        self.recovery.sent.retain(|published| {
            documents
                .iter()
                .any(|document| SourceKey::of(&document.header) == published.key)
        });
        self.recovery.drafts.retain(|state| {
            documents
                .iter()
                .any(|document| SourceKey::of(&document.header) == state.source)
        });
        let web = self
            .web_documents
            .iter()
            .filter(|page| {
                navigation
                    .items
                    .contains(&WorkspaceItem::Web(page.id.clone()))
            })
            .map(|page| SavedWeb {
                id: page.id.clone(),
                url: page.observation.url.clone(),
                html: page.html.clone(),
            })
            .collect();
        let session = WorkspaceSession {
            version: 1,
            workspace: self.workspace.clone(),
            navigation,
            documents,
            web,
        };
        if !force
            && sources.is_empty()
            && refresh.is_empty()
            && self.recovery.last.as_ref() == Some(&session)
        {
            return None;
        }
        self.recovery.last = Some(session.clone());
        self.recovery.sequence += 1;
        Some(
            serde_json::json!({"method":"workspace","action":"save","request_id":format!("workspace:{}",self.recovery.sequence),"session":session,"sources":sources,"refresh":refresh}),
        )
    }
    #[cfg(not(target_family = "wasm"))]
    pub(crate) fn checkpoint_native_close(
        &mut self,
        discard: bool,
        cx: &mut Context<Self>,
    ) -> bool {
        if !self.connected {
            return true;
        }
        if self.recovery.native_close.is_some() {
            return false;
        }
        let Some(command) = self.workspace_checkpoint(discard, true, cx) else {
            return true;
        };
        self.recovery.native_close = command["request_id"].as_str().map(str::to_owned);
        self.command(command, cx);
        false
    }
    pub(crate) fn navigate_history(
        &mut self,
        forward: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.remember_current_location(cx);
        if let Some(entry) = self.navigation.step_history(forward) {
            if let (WorkspaceRoute::Content(item @ WorkspaceItem::Document { .. }), Some(state)) =
                (&entry.route, entry.reading)
            {
                if let Some(document) = self
                    .recovery
                    .deferred
                    .iter_mut()
                    .find(|document| &document.saved.item() == item)
                {
                    document.saved.reading = state.clone();
                }
                if let Some(view) = self.active_document_view(item) {
                    view.update(cx, |view, cx| view.restore_reading_state(state, window, cx));
                }
            }
            self.activate_route(entry.route, window, cx);
        }
        self.queue_workspace_checkpoint(cx);
    }
    pub(crate) fn toggle_document_split(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.split_document_pane(
            pero_contracts::workspace_panes::SplitDirection::Right,
            window,
            cx,
        );
    }
}
