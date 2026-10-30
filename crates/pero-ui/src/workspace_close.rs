//! Closing views is a preflight transaction; source buffers outlive every clone.
use pero_contracts::{
    pane_tabs::ViewId,
    workspace_panes::{PaneId, PaneLayout},
    workspace_session::{WorkspaceItem, WorkspaceRoute},
};

#[derive(serde::Serialize)]
pub(crate) struct ClosePlan {
    views: Vec<ViewId>,
    pane: Option<PaneId>,
    discarded: Vec<WorkspaceItem>,
    waiting: Option<WorkspaceItem>,
    prompting: bool,
}
impl ClosePlan {
    fn new(views: Vec<ViewId>, pane: Option<PaneId>) -> Self {
        Self {
            views,
            pane,
            discarded: vec![],
            waiting: None,
            prompting: false,
        }
    }
    /// A source is affected only when every remaining view belongs to this close.
    fn last_sources(&self, layout: &PaneLayout) -> Vec<WorkspaceItem> {
        let mut result = vec![];
        for item in layout.items() {
            let WorkspaceRoute::Content(source) = &item.route else {
                continue;
            };
            if self.views.contains(&item.id)
                && !result.contains(source)
                && layout
                    .items()
                    .iter()
                    .filter(|view| view.route == item.route)
                    .all(|view| self.views.contains(&view.id))
            {
                result.push(source.clone());
            }
        }
        result
    }
    fn edited(&mut self, item: &WorkspaceItem) {
        self.discarded.retain(|source| source != item);
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
mod shell {
    use super::*;
    use crate::{app::Workbench, workspace_restore::DeferredDocument};
    use gpui_kit::{
        component::{WindowExt, button::Button, dialog::DialogFooter},
        prelude::*,
        *,
    };
    use pero_contracts::{content_origin::ContentOrigin, workspace_session::SavedDocument};
    fn defer_answer(
        owner: WeakEntity<Workbench>,
        answer: Option<(WorkspaceItem, bool)>,
        window: &mut Window,
        cx: &mut App,
    ) {
        window.defer(cx, move |window, cx| {
            let _ = owner.update(cx, |this, cx| {
                let Some(plan) = &mut this.pending_close else {
                    return;
                };
                plan.prompting = false;
                match answer {
                    Some((source, true)) => this.save_before_close(source, window, cx),
                    Some((source, false)) => {
                        plan.discarded.push(source);
                        this.advance_workspace_close(window, cx);
                    }
                    None => {
                        this.pending_close = None;
                        cx.notify();
                    }
                }
            });
        });
    }
    impl Workbench {
        pub(crate) fn close_pane_tab(
            &mut self,
            view: ViewId,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            if self.pending_close.is_some() {
                return;
            }
            self.pending_close = Some(ClosePlan::new(vec![view], None));
            self.advance_workspace_close(window, cx);
        }
        pub(crate) fn request_close_pane(
            &mut self,
            pane: PaneId,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            if self.pending_close.is_some() {
                return;
            }
            let Some(leaf) = self
                .navigation
                .pane_layout()
                .and_then(|layout| layout.leaf(pane))
            else {
                return;
            };
            self.pending_close = Some(ClosePlan::new(
                leaf.tabs.items().iter().map(|item| item.id).collect(),
                Some(pane),
            ));
            self.advance_workspace_close(window, cx);
        }
        pub(crate) fn invalidate_close_decision(&mut self, item: &WorkspaceItem) {
            if let Some(plan) = &mut self.pending_close {
                plan.edited(item);
            }
        }
        fn close_source_dirty(&self, item: &WorkspaceItem, cx: &App) -> bool {
            self.documents
                .iter()
                .find(|open| &open.item == item)
                .is_some_and(|open| open.view.read(cx).dirty())
                || self
                    .recovery
                    .deferred
                    .iter()
                    .find(|open| &open.saved.item() == item)
                    .is_some_and(|open| {
                        open.saved.draft_ref.is_some()
                            || open.saved.draft.is_some()
                            || open.saved.legacy_draft
                    })
        }
        pub(crate) fn advance_workspace_close(
            &mut self,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            let Some(plan) = &self.pending_close else {
                return;
            };
            if plan.prompting || plan.waiting.is_some() {
                return;
            }
            let sources = self
                .navigation
                .pane_layout()
                .map(|layout| plan.last_sources(layout))
                .unwrap_or_default();
            let next = sources
                .iter()
                .find(|source| {
                    !plan.discarded.contains(source) && self.close_source_dirty(source, cx)
                })
                .cloned();
            if let Some(source) = next {
                self.pending_close.as_mut().unwrap().prompting = true;
                let title = self
                    .documents
                    .iter()
                    .find(|open| open.item == source)
                    .map(|open| open.view.read(cx).document.title.clone())
                    .or_else(|| {
                        self.recovery
                            .deferred
                            .iter()
                            .find(|open| open.saved.item() == source)
                            .map(|open| open.saved.header.source.title.clone())
                    })
                    .unwrap_or_default();
                let owner = cx.entity().downgrade();
                let message = self.t("content.unsaved").to_owned();
                let save = self.t("content.save").to_owned();
                let discard = self.t("workspace.close_dont_save").to_owned();
                let cancel = self.t("workspace.close_cancel").to_owned();
                window.open_dialog(cx, move |dialog, _, _| {
                    let cancel_owner = owner.clone();
                    let save_owner = owner.clone();
                    let save_source = source.clone();
                    dialog
                        .title(message.clone())
                        .child(title.clone())
                        .close_button(false)
                        .overlay_closable(false)
                        .on_cancel(move |_, window, cx| {
                            defer_answer(cancel_owner.clone(), None, window, cx);
                            true
                        })
                        .on_ok(move |_, window, cx| {
                            defer_answer(
                                save_owner.clone(),
                                Some((save_source.clone(), true)),
                                window,
                                cx,
                            );
                            true
                        })
                        .footer(
                            DialogFooter::new().children(
                                [
                                    ("close-cancel", cancel.clone(), None),
                                    (
                                        "close-discard",
                                        discard.clone(),
                                        Some((source.clone(), false)),
                                    ),
                                    ("close-save", save.clone(), Some((source.clone(), true))),
                                ]
                                .into_iter()
                                .map(|(id, label, answer)| {
                                    let owner = owner.clone();
                                    Button::new(id).label(label).on_click(move |_, window, cx| {
                                        window.close_dialog(cx);
                                        defer_answer(owner.clone(), answer.clone(), window, cx);
                                    })
                                }),
                            ),
                        )
                });
                return;
            }
            self.commit_workspace_close(sources, window, cx);
        }
        fn save_before_close(
            &mut self,
            item: WorkspaceItem,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            if !self.close_source_dirty(&item, cx) {
                self.advance_workspace_close(window, cx);
                return;
            }
            let reference = if self.documents.iter().any(|open| open.item == item) {
                self.begin_workspace_file_save(&item, cx)
            } else {
                self.recovery
                    .deferred
                    .iter()
                    .find(|open| open.saved.item() == item)
                    .and_then(|open| open.saved.draft_ref.clone())
            };
            if let Some(draft) = reference {
                for open in &self.documents {
                    if open.item == item {
                        open.view.update(cx, |view, cx| view.file_saving(cx));
                    }
                }
                for open in &self.pane_views {
                    if open.item == item {
                        open.view.update(cx, |view, cx| view.file_saving(cx));
                    }
                }
                self.pending_close.as_mut().unwrap().waiting = Some(item);
                self.command(serde_json::json!({"method":"documents","action":"save_draft","request_id":format!("save:{}",draft.source.source),"draft":draft}), cx);
            } else {
                // Old inline recovery is materialized once before using the normal journal save.
                if self
                    .recovery
                    .deferred
                    .iter()
                    .any(|open| open.saved.item() == item)
                {
                    self.pending_close.as_mut().unwrap().waiting = Some(item.clone());
                    self.request_workspace_source(&item, cx);
                } else {
                    self.pending_close = None;
                    self.error = Some(self.t("content.file_failed").into());
                }
            }
            cx.notify();
        }
        pub(crate) fn loaded_workspace_close(
            &mut self,
            item: &WorkspaceItem,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            if self
                .pending_close
                .as_ref()
                .is_some_and(|plan| plan.waiting.as_ref() == Some(item))
            {
                self.pending_close.as_mut().unwrap().waiting = None;
                self.save_before_close(item.clone(), window, cx);
            }
        }
        pub(crate) fn resume_workspace_close(
            &mut self,
            item: &WorkspaceItem,
            success: bool,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            if !self
                .pending_close
                .as_ref()
                .is_some_and(|plan| plan.waiting.as_ref() == Some(item))
            {
                return;
            }
            if !success {
                self.pending_close = None;
                cx.notify();
                return;
            }
            self.pending_close.as_mut().unwrap().waiting = None;
            self.advance_workspace_close(window, cx);
        }
        fn commit_workspace_close(
            &mut self,
            sources: Vec<WorkspaceItem>,
            window: &mut Window,
            cx: &mut Context<Self>,
        ) {
            let Some(plan) = self.pending_close.take() else {
                return;
            };
            self.remember_current_location(cx);
            // Persist Host-owned baselines before dropping the last live File owner.
            if let Some(command) = self.workspace_checkpoint(false, true, cx) {
                self.command(command, cx);
            }
            for item in &plan.discarded {
                self.navigation.clear_document_locations(item);
            }
            for view in plan.views {
                self.navigation.close_view(view);
            }
            if let Some(pane) = plan.pane {
                self.navigation.close_pane(pane);
            }
            let empty = self
                .navigation
                .pane_layout()
                .map(|layout| {
                    layout
                        .leaves()
                        .into_iter()
                        .filter(|pane| pane.tabs.items().is_empty())
                        .map(|pane| pane.id)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            for pane in empty {
                self.navigation.close_pane(pane);
            }
            // Keep lightweight source descriptors for pane history, but release all Reader/Undo state.
            let mut released = vec![];
            for item in sources {
                if self.navigation.view_count(&item) > 0 {
                    continue;
                }
                if let Some(index) = self.documents.iter().position(|open| open.item == item) {
                    let open = self.documents.remove(index);
                    let document = open.view.read(cx).document.clone();
                    self.recovery.deferred.push(DeferredDocument {
                        saved: SavedDocument {
                            header: document.header(),
                            reading: if open.view.read(cx).dirty() {
                                open.view.read(cx).reading_state(cx).without_location()
                            } else {
                                open.view.read(cx).reading_state(cx)
                            },
                            draft: None,
                            draft_ref: None,
                            legacy_draft: false,
                        },
                        loading: false,
                        failed: false,
                        close_after_load: false,
                    });
                    // Host owns File baselines; publish checkpoint before dropping that owner.
                    if matches!(document.origin, ContentOrigin::File { .. }) {
                        released.push(document);
                    }
                } else if let Some(open) = self
                    .recovery
                    .deferred
                    .iter_mut()
                    .find(|open| open.saved.item() == item)
                {
                    if plan.discarded.contains(&item) {
                        open.saved.reading = open.saved.reading.clone().without_location();
                    }
                    open.saved.draft = None;
                    open.saved.draft_ref = None;
                    open.saved.legacy_draft = false;
                }
                self.pane_views.retain(|view| view.item != item);
                self.recovery.sent.retain(|published| {
                    WorkspaceItem::Document {
                        origin: published.key.origin.clone(),
                        source: published.key.source.clone(),
                    } != item
                });
                self.recovery.drafts.retain(|draft| {
                    WorkspaceItem::Document {
                        origin: draft.source.origin.clone(),
                        source: draft.source.source.clone(),
                    } != item
                });
            }
            if let Some(command) = self.workspace_checkpoint(false, true, cx) {
                self.command(command, cx);
            }
            for document in released {
                self.command(serde_json::json!({"method":"documents","action":"release","source":document.id}), cx);
            }
            self.ensure_document_panes(window, cx);
            self.activate_route(self.navigation.route().clone(), window, cx);
            cx.notify();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{content_origin::ContentOrigin, workspace_panes::SplitDirection};
    #[test]
    fn preflight_targets_last_source_only_and_edits_revoke_discard() {
        let source = WorkspaceItem::Document {
            origin: ContentOrigin::File {
                path: "/tmp/a".into(),
            },
            source: "/tmp/a".into(),
        };
        let route = WorkspaceRoute::Content(source.clone());
        let mut layout = PaneLayout::new(route.clone(), None);
        let first = layout.focused.unwrap();
        layout
            .split(first, SplitDirection::Right, route, None)
            .unwrap();
        let views = layout
            .items()
            .iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        assert!(
            ClosePlan::new(vec![views[0]], None)
                .last_sources(&layout)
                .is_empty()
        );
        let mut plan = ClosePlan::new(views, Some(first));
        assert_eq!(plan.last_sources(&layout), vec![source.clone()]);
        plan.discarded.push(source.clone());
        plan.edited(&source);
        assert!(plan.discarded.is_empty());
        assert_eq!(
            layout.items().len(),
            2,
            "preflight never closes a tab before every decision succeeds"
        );
    }
}
