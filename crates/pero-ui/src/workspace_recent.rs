//! Recent content is a searchable Kit list; previews use the pane's ordinary tab model.
use crate::{
    app::Workbench,
    workspace::{WorkspaceItem, tab_navigation::PreviewOrigin},
};
use gpui_kit::{
    component::{
        WindowExt,
        button::Button,
        list::{List, ListDelegate, ListItem, ListState},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::pane_tabs::OpenIntent;

gpui_kit::actions!(recent_content, [OpenRecentContent]);

pub(crate) struct RecentContent {
    owner: WeakEntity<Workbench>,
    open_label: String,
    entries: Vec<(WorkspaceItem, String)>,
    filtered: Vec<usize>,
    selected: Option<usize>,
    origin: PreviewOrigin,
}
impl RecentContent {
    fn finish(&self, keep: bool, window: &mut Window, cx: &mut App) {
        // Close synchronously: a delayed Dialog focus restore must not steal the editor focus.
        window.close_dialog(cx);
        let owner = self.owner.clone();
        let origin = self.origin.clone();
        window.defer(cx, move |window, cx| {
            let _ = owner.update(cx, |this, cx| {
                if keep {
                    if let Some(view) = this.navigation.active_view_id() {
                        this.navigation.promote_view(view);
                    }
                } else {
                    this.navigation.cancel_preview(origin);
                }
                this.ensure_document_panes(window, cx);
                this.activate_route(this.navigation.route().clone(), window, cx);
                this.queue_workspace_checkpoint(cx);
                cx.notify();
            });
        });
    }
}
impl ListDelegate for RecentContent {
    type Item = ListItem;
    fn items_count(&self, _: usize, _: &App) -> usize {
        self.filtered.len()
    }
    fn render_item(
        &mut self,
        ix: IndexPath,
        _: &mut Window,
        _: &mut Context<ListState<Self>>,
    ) -> Option<ListItem> {
        let entry = *self.filtered.get(ix.row)?;
        Some(ListItem::new(ix.row).child(self.entries[entry].1.clone()))
    }
    fn perform_search(
        &mut self,
        query: &str,
        _: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Task<()> {
        let query = query.to_lowercase();
        self.filtered = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(index, (_, title))| {
                title.to_lowercase().contains(&query).then_some(index)
            })
            .collect();
        cx.notify();
        Task::ready(())
    }
    fn set_selected_index(
        &mut self,
        ix: Option<IndexPath>,
        window: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) {
        self.selected = ix.and_then(|ix| self.filtered.get(ix.row).copied());
        if let Some(index) = self.selected {
            let item = self.entries[index].0.clone();
            let _ = self.owner.update(cx, |this, cx| {
                this.navigation.open_with_intent(item, OpenIntent::Preview);
                this.ensure_document_panes(window, cx);
                this.activate_route(this.navigation.route().clone(), window, cx);
                cx.notify();
            });
            let list = cx.entity().downgrade();
            window.defer(cx, move |window, cx| {
                let _ = list.update(cx, |list, cx| list.focus(window, cx));
            });
        }
    }
    fn confirm(&mut self, _: bool, window: &mut Window, cx: &mut Context<ListState<Self>>) {
        if self.selected.is_some() {
            self.finish(true, window, cx);
        }
    }
    fn cancel(&mut self, window: &mut Window, cx: &mut Context<ListState<Self>>) {
        self.finish(false, window, cx);
    }
    fn render_empty(
        &mut self,
        _: &mut Window,
        _cx: &mut Context<ListState<Self>>,
    ) -> impl IntoElement {
        let owner = self.owner.clone();
        let origin = self.origin.clone();
        div().p(px(12.)).child(
            Button::new("recent-open-file")
                .label(self.open_label.clone())
                .on_click(move |_, window, cx| {
                    window.close_dialog(cx);
                    let owner = owner.clone();
                    let origin = origin.clone();
                    window.defer(cx, move |window, cx| {
                        let _ = owner.update(cx, |this, cx| {
                            this.navigation.cancel_preview(origin);
                            this.ensure_document_panes(window, cx);
                            this.choose_document(cx);
                        });
                    });
                }),
        )
    }
}
impl Workbench {
    pub(crate) fn open_recent_content(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if window.has_active_dialog(cx) {
            return;
        }
        self.remember_current_location(cx);
        let origin = self.navigation.preview_origin();
        let entries = self
            .navigation
            .items()
            .iter()
            .rev()
            .filter(|item| matches!(item, WorkspaceItem::Document { .. }))
            .map(|item| (item.clone(), self.content_label(item, cx).0))
            .collect::<Vec<_>>();
        let delegate = RecentContent {
            owner: cx.entity().downgrade(),
            open_label: self.t("content.open_file").to_owned(),
            filtered: (0..entries.len()).collect(),
            entries,
            selected: None,
            origin: origin.clone(),
        };
        let list = cx.new(|cx| ListState::new(delegate, window, cx).searchable(true));
        let focus_list = list.clone();
        let owner = cx.entity().downgrade();
        let title = self.t("workspace.recent_content").to_owned();
        window.open_dialog(cx, move |dialog, _, _| {
            let owner = owner.clone();
            let origin = origin.clone();
            dialog
                .title(title.clone())
                .close_button(false)
                .overlay_closable(false)
                .child(List::new(&list).h(px(320.)))
                .on_cancel(move |_, window, cx| {
                    window.close_dialog(cx);
                    let owner = owner.clone();
                    let origin = origin.clone();
                    window.defer(cx, move |window, cx| {
                        let _ = owner.update(cx, |this, cx| {
                            this.navigation.cancel_preview(origin);
                            this.ensure_document_panes(window, cx);
                            this.activate_route(this.navigation.route().clone(), window, cx);
                            cx.notify();
                        });
                    });
                    false
                })
        });
        window.defer(cx, move |window, cx| {
            focus_list.update(cx, |list, cx| {
                list.set_selected_index(Some(IndexPath::default()), window, cx);
                list.focus(window, cx);
            })
        });
        cx.notify();
    }
}
