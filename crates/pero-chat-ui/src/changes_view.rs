//! Composer review controls and snapshot comparison pane, independent of document delivery.
use crate::{
    panel::{ChatAction, ChatPanel},
    session_artifacts::ArtifactCollection,
};
use gpui_kit::{
    base::Selectable,
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    workspace_changes::{
        ChangeScope, ChangesMethod, ChangesRequest, DiffLineKind, FileComparison, WorkspaceChanges,
    },
};
use serde::Deserialize;
use serde_json::json;

#[derive(Clone, Default)]
pub struct ChangeReview {
    pub(crate) records: Vec<WorkspaceChanges>,
    pub(crate) selected: Option<(String, usize)>,
    comparison: Option<FileComparison>,
    pending: Option<String>,
    error: Option<String>,
    split: bool,
}
impl ChangeReview {
    fn record(&mut self, summary: WorkspaceChanges) {
        if summary.scope == ChangeScope::Worktree {
            self.records
                .retain(|record| record.scope != ChangeScope::Worktree);
        }
        if let Some(record) = self
            .records
            .iter_mut()
            .find(|record| record.id == summary.id)
        {
            *record = summary;
        } else if summary.total > 0 || summary.scope == ChangeScope::Worktree {
            self.records.push(summary);
        }
    }
}
impl ChatPanel {
    pub(crate) fn changes_event(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        let Some(chat) = self
            .chats
            .iter_mut()
            .find(|chat| Some(&chat.id) == event.thread_id.as_ref())
        else {
            return false;
        };
        let mut followup = None;
        match event.kind.as_str() {
            "workspace_changes" => {
                #[derive(Deserialize)]
                struct Receipt {
                    changes: WorkspaceChanges,
                }
                match serde_json::from_value::<Receipt>(event.data.clone()) {
                    Ok(receipt) => {
                        let current = receipt.changes.scope == ChangeScope::Worktree
                            && event.request_id.is_some();
                        let selected =
                            current.then(|| (chat.id.clone(), receipt.changes.id.clone()));
                        chat.changes.record(receipt.changes);
                        if current {
                            followup = selected;
                        }
                        chat.changes.error = None;
                    }
                    Err(error) => chat.changes.error = Some(error.to_string()),
                }
                if event.request_id.is_some() {
                    chat.changes.pending = None;
                }
            }
            "workspace_changes_catalog" => {
                #[derive(Deserialize)]
                struct Catalog {
                    changes: Vec<WorkspaceChanges>,
                }
                match serde_json::from_value::<Catalog>(event.data.clone()) {
                    Ok(catalog) => {
                        for summary in catalog.changes {
                            chat.changes.record(summary);
                        }
                    }
                    Err(error) => chat.changes.error = Some(error.to_string()),
                }
            }
            "workspace_change_diff" => {
                #[derive(Deserialize)]
                struct Diff {
                    id: String,
                    index: usize,
                    comparison: FileComparison,
                }
                if chat.changes.pending.as_ref() != event.request_id.as_ref() {
                    return true;
                }
                match serde_json::from_value::<Diff>(event.data.clone()) {
                    Ok(diff)
                        if chat
                            .changes
                            .selected
                            .as_ref()
                            .is_some_and(|(id, index)| id == &diff.id && *index == diff.index) =>
                    {
                        chat.changes.comparison = Some(diff.comparison);
                        chat.changes.error = None;
                    }
                    Ok(_) => {}
                    Err(error) => chat.changes.error = Some(error.to_string()),
                }
                chat.changes.pending = None;
            }
            "workspace_changes_error" => {
                if event.request_id.is_none()
                    || chat.changes.pending.as_ref() == event.request_id.as_ref()
                {
                    chat.changes.error = Some(event.text.clone());
                    chat.changes.pending = None;
                }
            }
            _ => return false,
        }
        if let Some((thread, id)) = followup {
            self.read_changes(&thread, &id, 0, cx);
        }
        cx.notify();
        true
    }
    pub(crate) fn request_changes(&mut self, thread: &str, current: bool, cx: &mut Context<Self>) {
        self.next_request += 1;
        let request_id = format!("changes-{}", self.next_request);
        let method = ChangesMethod::WorkspaceChanges;
        let request = if current {
            ChangesRequest::Current {
                method,
                request_id: request_id.clone(),
                thread_id: thread.into(),
            }
        } else {
            ChangesRequest::List {
                method,
                request_id: request_id.clone(),
                thread_id: thread.into(),
            }
        };
        if current {
            if let Some(chat) = self.chats.iter_mut().find(|chat| chat.id == thread) {
                chat.changes.pending = Some(request_id);
                chat.changes.error = None;
            }
        }
        cx.emit(ChatAction::Changes(request));
        cx.notify();
    }
    pub(crate) fn read_changes(
        &mut self,
        thread: &str,
        id: &str,
        index: usize,
        cx: &mut Context<Self>,
    ) {
        let empty = self
            .chats
            .iter()
            .find(|chat| chat.id == thread)
            .and_then(|chat| chat.changes.records.iter().find(|record| record.id == id))
            .is_some_and(|record| record.files.is_empty());
        if empty {
            if let Some(chat) = self.chats.iter_mut().find(|chat| chat.id == thread) {
                chat.changes.selected = Some((id.into(), 0));
                chat.changes.comparison = None;
                chat.changes.pending = None;
                chat.changes.error = None;
            }
            let state = self
                .artifacts
                .conversations
                .entry(thread.into())
                .or_default();
            state.show_pane();
            state.show_changes = true;
            cx.notify();
            return;
        }
        self.next_request += 1;
        let request_id = format!("changes-{}", self.next_request);
        if let Some(chat) = self.chats.iter_mut().find(|chat| chat.id == thread) {
            chat.changes.selected = Some((id.into(), index));
            chat.changes.comparison = None;
            chat.changes.pending = Some(request_id.clone());
            chat.changes.error = None;
        }
        let state = self
            .artifacts
            .conversations
            .entry(thread.into())
            .or_default();
        state.show_pane();
        state.show_changes = true;
        cx.emit(ChatAction::Changes(ChangesRequest::Read {
            method: ChangesMethod::WorkspaceChanges,
            request_id,
            thread_id: thread.into(),
            id: id.into(),
            index,
        }));
        cx.notify();
    }
    /// Review lives beside the permission mode in the composer; full comparisons stay in the reader pane.
    pub(crate) fn output_controls(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(chat) = self.active_chat.and_then(|index| self.chats.get(index)) else {
            return div().into_any_element();
        };
        let state = self.artifacts.conversations.get(&chat.id);
        let open = state.is_some_and(|state| state.open);
        let latest = chat.changes.records.last();
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let thread = chat.id.clone();
        let selected = latest.map(|summary| summary.id.clone());
        let docs = state.map_or(0, |state| state.items.len());
        let docs_thread = thread.clone();
        div()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                crate::theme::WorkbenchStyle::composer_control(
                    Button::new("composer-diff").ghost(),
                    cx,
                )
                .relative()
                .children(
                    self.artifacts
                        .bounds
                        .get(&format!("{thread}/changes-toggle"))
                        .map(|bounds| bounds.probe()),
                )
                .icon(Icon::default().path("icons/file-code.svg"))
                .selected(open && state.is_some_and(|state| state.show_changes))
                .accessibility_label(self.t("changes.review"))
                .tooltip(self.t("changes.review_hint"))
                .label(self.t("changes.review"))
                .when_some(latest, |button, summary| {
                    button
                        .child(
                            div()
                                .text_color(p.text_muted)
                                .child(summary.total.to_string()),
                        )
                        .child(
                            div()
                                .text_color(p.success)
                                .child(format!("+{}", summary.added)),
                        )
                        .child(
                            div()
                                .text_color(p.error)
                                .child(format!("−{}", summary.deleted)),
                        )
                })
                .disabled(chat.busy() && latest.is_none())
                .on_click(cx.listener(move |this, _, _, cx| {
                    let state = this
                        .artifacts
                        .conversations
                        .entry(thread.clone())
                        .or_default();
                    if state.open && state.show_changes {
                        state.open = false;
                        state.inline_open = false;
                        cx.notify();
                        return;
                    }
                    state.show_pane();
                    state.show_changes = true;
                    if let Some(id) = &selected {
                        this.read_changes(&thread, id, 0, cx);
                    } else {
                        this.request_changes(&thread, true, cx);
                    }
                    if this.compact {
                        cx.emit(ChatAction::CompactNeedsSpace);
                    }
                    cx.notify();
                })),
            )
            .when(docs > 0, |el| {
                el.child(
                    crate::theme::WorkbenchStyle::composer_control(
                        Button::new("composer-deliveries").ghost(),
                        cx,
                    )
                    .relative()
                    .children(
                        self.artifacts
                            .bounds
                            .get(&format!("{docs_thread}/toggle"))
                            .map(|bounds| bounds.probe()),
                    )
                    .icon(Icon::default().path("icons/file.svg"))
                    .tooltip(self.t("artifacts.title"))
                    .accessibility_label(self.t("artifacts.title"))
                    .label(docs.to_string())
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let state = this
                            .artifacts
                            .conversations
                            .entry(docs_thread.clone())
                            .or_default();
                        state.open = !(state.open && !state.show_changes);
                        state.show_changes = false;
                        cx.notify();
                    })),
                )
            })
            .into_any_element()
    }

    pub(crate) fn changes_panel(
        &self,
        thread: &str,
        _state: &ArtifactCollection,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        use gpui_kit::component::menu::{DropdownMenu, PopupMenuItem};
        let Some(chat) = self.chats.iter().find(|chat| chat.id == thread) else {
            return div().into_any_element();
        };
        let appearance = pero_theme::UiAppearance::global(cx);
        let p = &appearance.palette.clone();
        let code = appearance.typography.code;
        let review = &chat.changes;
        let selected_record = review
            .selected
            .as_ref()
            .and_then(|(id, _)| review.records.iter().find(|record| &record.id == id));
        let selected_file = review
            .selected
            .as_ref()
            .and_then(|(_, index)| selected_record.and_then(|record| record.files.get(*index)));
        let menu_rows: Vec<_> = review
            .records
            .iter()
            .enumerate()
            .map(|(index, record)| {
                let title = if record.scope == ChangeScope::Worktree {
                    self.t("changes.scope_worktree").to_owned()
                } else {
                    self.t("changes.scope_turn")
                        .replace("{number}", &(index + 1).to_string())
                };
                (
                    record.id.clone(),
                    format!(
                        "{title} · {}",
                        self.t("changes.file_count")
                            .replace("{count}", &record.total.to_string())
                    ),
                )
            })
            .collect();
        let scope = review
            .selected
            .as_ref()
            .and_then(|(id, _)| menu_rows.iter().find(|(value, _)| value == id))
            .map(|(_, label)| label.clone())
            .unwrap_or_else(|| self.t("changes.select_record").into());
        let scope_id = review.selected.as_ref().map(|(id, _)| id.clone());
        let menu_thread = thread.to_owned();
        let menu_owner = cx.entity().downgrade();
        let current_thread = thread.to_owned();
        let icon_button = |id: &'static str, icon: &str, label: &str| {
            Button::new(id)
                .ghost()
                .small()
                .w(px(28.))
                .h(px(28.))
                .p_0()
                .icon(Icon::default().path(crate::assets::UiIcon::named(icon).path()))
                .tooltip(label.to_owned())
                .accessibility_label(label.to_owned())
        };
        let mut panel = div()
            .id("changes-reader")
            .w_full()
            .h_full()
            .min_h_0()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(p.surface)
            .text_color(p.text)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .py(px(4.))
                    .child(
                        Button::new("changes-history")
                            .relative()
                            .children(
                                self.artifacts
                                    .bounds
                                    .get(&format!("{thread}/changes-history"))
                                    .map(|bounds| bounds.probe()),
                            )
                            .ghost()
                            .small()
                            .min_w_0()
                            .flex_1()
                            .justify_start()
                            .label(scope)
                            .dropdown_caret(true)
                            .disabled(menu_rows.is_empty())
                            .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                                menu_rows.iter().rev().fold(
                                    menu.min_w(px(220.))
                                        .max_w(px(360.))
                                        .max_h(px(300.))
                                        .scrollable(true),
                                    |menu, (id, label)| {
                                        let id = id.clone();
                                        let thread = menu_thread.clone();
                                        let owner = menu_owner.clone();
                                        menu.item(
                                            PopupMenuItem::new(label.clone())
                                                .checked(scope_id.as_ref() == Some(&id))
                                                .on_click(move |_, _, cx| {
                                                    let _ = owner.update(cx, |this, cx| {
                                                        this.read_changes(&thread, &id, 0, cx)
                                                    });
                                                }),
                                        )
                                    },
                                )
                            }),
                    )
                    .child(
                        icon_button("changes-current", "git-branch", self.t("changes.current"))
                            .relative()
                            .children(
                                self.artifacts
                                    .bounds
                                    .get(&format!("{thread}/changes-current"))
                                    .map(|bounds| bounds.probe()),
                            )
                            .disabled(review.pending.is_some() || chat.busy())
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request_changes(&current_thread, true, cx)
                            })),
                    ),
            )
            .when_some(selected_record, |el, record| {
                el.child(
                    div()
                        .px(px(12.))
                        .pb(px(4.))
                        .flex()
                        .gap(px(8.))
                        .text_size(px(12.))
                        .child(
                            div()
                                .text_color(p.success)
                                .child(format!("+{}", record.added)),
                        )
                        .child(
                            div()
                                .text_color(p.error)
                                .child(format!("−{}", record.deleted)),
                        ),
                )
            })
            .child(
                div()
                    .id("changes-list")
                    .relative()
                    .children(
                        self.artifacts
                            .bounds
                            .get(&format!("{thread}/changes-list"))
                            .map(|bounds| bounds.probe()),
                    )
                    .max_h(px(180.))
                    .overflow_y_scroll()
                    .px(px(8.))
                    .flex()
                    .flex_col()
                    .children(
                        selected_record
                            .into_iter()
                            .flat_map(|record| {
                                record
                                    .files
                                    .iter()
                                    .enumerate()
                                    .map(move |(index, file)| (record, index, file))
                            })
                            .map(|(record, index, file)| {
                                let id = record.id.clone();
                                let selected = review.selected.as_ref().is_some_and(
                                    |(selected, file_index)| {
                                        selected == &id && *file_index == index
                                    },
                                );
                                let thread = thread.to_owned();
                                let title = file
                                    .old_path
                                    .as_ref()
                                    .map(|old| format!("{old} → {}", file.path))
                                    .unwrap_or_else(|| file.path.clone());
                                Button::new(SharedString::from(format!("changed-file-{index}")))
                                    .relative()
                                    .children(
                                        self.artifacts
                                            .bounds
                                            .get(&format!("{thread}/change:{id}:{index}"))
                                            .map(|bounds| bounds.probe()),
                                    )
                                    .ghost()
                                    .small()
                                    .w_full()
                                    .justify_start()
                                    .selected(selected)
                                    .tooltip(title.clone())
                                    .accessibility_label(format!(
                                        "{}: {title}",
                                        self.t("changes.view_diff")
                                    ))
                                    .child(
                                        self.icon("file-code")
                                            .size(px(14.))
                                            .text_color(p.text_muted),
                                    )
                                    .child(
                                        div()
                                            .flex_1()
                                            .min_w_0()
                                            .truncate()
                                            .text_left()
                                            .child(title),
                                    )
                                    .when(file.binary, |button| {
                                        button.child(
                                            div()
                                                .text_color(p.text_muted)
                                                .child(self.t("changes.binary")),
                                        )
                                    })
                                    .when(!file.binary, |button| {
                                        button
                                            .child(
                                                div()
                                                    .text_color(p.success)
                                                    .child(format!("+{}", file.added)),
                                            )
                                            .child(
                                                div()
                                                    .text_color(p.error)
                                                    .child(format!("−{}", file.deleted)),
                                            )
                                    })
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.read_changes(&thread, &id, index, cx)
                                    }))
                            }),
                    ),
            )
            .when_some(
                selected_record.filter(|record| record.total > record.files.len()),
                |el, record| {
                    el.child(
                        div().px(px(12.)).text_color(p.text_muted).child(
                            self.t("changes.partial")
                                .replace("{shown}", &record.files.len().to_string())
                                .replace("{total}", &record.total.to_string()),
                        ),
                    )
                },
            )
            .when_some(review.error.as_ref(), |el, error| {
                el.child(div().p(px(12.)).text_color(p.error).child(error.clone()))
            })
            .when(review.pending.is_some(), |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .py(px(8.))
                        .text_color(p.text_muted)
                        .child(self.t("artifacts.loading")),
                )
            })
            .when(
                selected_record.is_none() && review.pending.is_none() && review.error.is_none(),
                |el| {
                    el.child(
                        div()
                            .p(px(12.))
                            .text_color(p.text_muted)
                            .child(self.t("changes.empty")),
                    )
                },
            )
            .when(
                selected_record.is_some_and(|record| record.total == 0),
                |el| {
                    el.child(
                        div()
                            .p(px(12.))
                            .text_color(p.text_muted)
                            .child(self.t("changes.clean")),
                    )
                },
            );
        if let Some(file) = selected_file {
            let left_thread = thread.to_owned();
            let right_thread = thread.to_owned();
            panel = panel.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .px(px(8.))
                    .py(px(6.))
                    .border_b_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_size(px(13.))
                            .child(file.path.clone()),
                    )
                    .child(
                        icon_button("diff-unified", "layout-list", self.t("changes.unified"))
                            .selected(!review.split)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(chat) =
                                    this.chats.iter_mut().find(|chat| chat.id == left_thread)
                                {
                                    chat.changes.split = false;
                                }
                                cx.notify();
                            })),
                    )
                    .child(
                        icon_button("diff-split", "columns-2", self.t("changes.split"))
                            .relative()
                            .children(
                                self.artifacts
                                    .bounds
                                    .get(&format!("{thread}/changes-layout"))
                                    .map(|bounds| bounds.probe()),
                            )
                            .selected(review.split)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(chat) =
                                    this.chats.iter_mut().find(|chat| chat.id == right_thread)
                                {
                                    chat.changes.split = true;
                                }
                                cx.notify();
                            })),
                    ),
            );
        }
        if let Some(comparison) = &review.comparison {
            match comparison {
                FileComparison::Text { .. } => {
                    let visible = |line: &pero_contracts::workspace_changes::DiffLine| {
                        line.kind != DiffLineKind::Header
                            || !(line.text.starts_with("diff --git ")
                                || line.text.starts_with("index ")
                                || line.text.starts_with("--- ")
                                || line.text.starts_with("+++ "))
                    };
                    let lines: Vec<_> = comparison.lines().into_iter().filter(visible).collect();
                    let limited = lines.len() > 5000;
                    let cell = |line: Option<&pero_contracts::workspace_changes::DiffLine>,
                                right: bool| {
                        let bg = match line.map(|line| line.kind) {
                            Some(DiffLineKind::Added) => p.success_bg,
                            Some(DiffLineKind::Deleted) => p.error_bg,
                            _ => p.surface,
                        };
                        let number = line
                            .and_then(|line| if right { line.new } else { line.old })
                            .map(|n| n.to_string())
                            .unwrap_or_default();
                        div()
                            .flex_1()
                            .min_w_0()
                            .min_h(px(code * 1.5))
                            .bg(bg)
                            .flex()
                            .gap(px(8.))
                            .px(px(8.))
                            .child(
                                div()
                                    .w(px(code * 3.5))
                                    .flex_shrink_0()
                                    .text_color(p.text_muted)
                                    .child(number),
                            )
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .child(line.map(|line| line.text.clone()).unwrap_or_default()),
                            )
                    };
                    let rows = if review.split {
                        comparison
                            .split_rows()
                            .iter()
                            .filter(|row| row.left.as_ref().is_none_or(&visible))
                            .take(5000)
                            .enumerate()
                            .map(|(index, row)| {
                                let header = row
                                    .left
                                    .as_ref()
                                    .filter(|line| line.kind == DiffLineKind::Header);
                                div()
                                    .id(("diff-line", index))
                                    .flex()
                                    .items_stretch()
                                    .when_some(header, |el, line| {
                                        el.child(
                                            div()
                                                .px(px(12.))
                                                .py(px(4.))
                                                .text_color(p.text_muted)
                                                .child(line.text.clone()),
                                        )
                                    })
                                    .when(header.is_none(), |el| {
                                        el.child(cell(row.left.as_ref(), false))
                                            .child(cell(row.right.as_ref(), true))
                                    })
                                    .into_any_element()
                            })
                            .collect::<Vec<_>>()
                    } else {
                        lines
                            .iter()
                            .take(5000)
                            .enumerate()
                            .map(|(index, line)| {
                                let bg = match line.kind {
                                    DiffLineKind::Added => p.success_bg,
                                    DiffLineKind::Deleted => p.error_bg,
                                    _ => p.surface,
                                };
                                let nums = format!(
                                    "{:>4} {:>4}",
                                    line.old.map(|n| n.to_string()).unwrap_or_default(),
                                    line.new.map(|n| n.to_string()).unwrap_or_default()
                                );
                                div()
                                    .id(("diff-line", index))
                                    .bg(bg)
                                    .flex()
                                    .gap(px(12.))
                                    .px(px(12.))
                                    .min_h(px(code * 1.5))
                                    .child(
                                        div().flex_shrink_0().text_color(p.text_muted).child(nums),
                                    )
                                    .child(div().flex_1().min_w_0().child(line.text.clone()))
                                    .into_any_element()
                            })
                            .collect::<Vec<_>>()
                    };
                    panel = panel
                        .child(
                            div()
                                .id("workspace-diff")
                                .flex_1()
                                .min_h_0()
                                .overflow_y_scroll()
                                .font_family("JetBrains Mono")
                                .text_size(px(code))
                                .py(px(8.))
                                .children(rows),
                        )
                        .when(limited, |el| el.child(self.t("changes.limited")));
                }
                FileComparison::Binary => {
                    panel = panel.child(
                        div()
                            .p(px(12.))
                            .text_color(p.text_muted)
                            .child(self.t("changes.binary")),
                    )
                }
                FileComparison::Oversized => {
                    panel = panel.child(
                        div()
                            .p(px(12.))
                            .text_color(p.text_muted)
                            .child(self.t("changes.oversized")),
                    )
                }
            }
        }
        panel.into_any_element()
    }
    pub(crate) fn changes_snapshot(&self) -> serde_json::Value {
        json!(self.chats.iter().map(|chat|json!({"thread":chat.id,"records":chat.changes.records.iter().map(|record|json!({"summary":record})).collect::<Vec<_>>(),"selected":chat.changes.selected,"loading":chat.changes.pending.is_some(),"error":chat.changes.error,"comparison":chat.changes.comparison})).collect::<Vec<_>>())
    }
}
