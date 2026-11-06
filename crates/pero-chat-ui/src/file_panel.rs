//! Virtualized file navigation beside the existing scientific content reader.
use crate::{
    assets::UiIcon,
    file_tree::{Notice, TreeRow},
    panel::ChatPanel,
};
use gpui_kit::{
    base::Selectable,
    component::{Icon, Sizable, button::*},
    prelude::*,
    *,
};
use pero_contracts::{workbench::ResourceTab, workspace_files::EntryKind};

impl ChatPanel {
    fn files_probe(&self, thread: &str, key: &str) -> Option<AnyElement> {
        self.files
            .conversations
            .get(thread)?
            .bounds
            .get(key)
            .map(|bounds| bounds.probe().into_any_element())
    }

    pub(crate) fn resource_tabs(&self, thread: &str, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .gap(px(2.))
            .children(
                [
                    (ResourceTab::Files, "files-tab", "files.title"),
                    (ResourceTab::Artifacts, "artifacts-tab", "artifacts.title"),
                ]
                .into_iter()
                .map(|(tab, id, key)| {
                    let thread = thread.to_owned();
                    Button::new(id)
                        .relative()
                        .children(self.files_probe(&thread, id))
                        .ghost()
                        .small()
                        .label(self.t(key))
                        .toggled(self.files.tab == tab)
                        .selected(self.files.tab == tab)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.choose_resource_tab(&thread, tab, cx)
                        }))
                }),
            )
            .into_any_element()
    }

    pub(crate) fn files_toolbar(&self, thread: &str, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let refresh_thread = thread.to_owned();
        let close_thread = thread.to_owned();
        div()
            .h(px(36.))
            .min_h(px(36.))
            .px(px(8.))
            .flex()
            .items_center()
            .gap(px(4.))
            .border_b(px(0.5))
            .border_color(p.border)
            .child(self.resource_tabs(thread, cx))
            .child(div().flex_1())
            .child(
                Button::new("files-refresh")
                    .relative()
                    .children(self.files_probe(thread, "refresh"))
                    .ghost()
                    .small()
                    .icon(Icon::default().path(UiIcon::Refresh.path()))
                    .tooltip(self.t("files.refresh"))
                    .accessibility_label(self.t("files.refresh"))
                    .on_click(
                        cx.listener(move |this, _, _, cx| this.refresh_files(&refresh_thread, cx)),
                    ),
            )
            .child(
                Button::new("files-close")
                    .relative()
                    .children(self.files_probe(thread, "close"))
                    .ghost()
                    .small()
                    .icon(Icon::default().path(UiIcon::named("x").path()))
                    .tooltip(self.t("files.close"))
                    .accessibility_label(self.t("files.close"))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.artifacts
                            .conversations
                            .entry(close_thread.clone())
                            .or_default()
                            .open = false;
                        this.composer.focus_handle(cx).focus(window, cx);
                        cx.notify();
                    })),
            )
            .into_any_element()
    }

    pub(crate) fn file_panel(&self, thread: &str, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let browser = &self.files.conversations[thread];
        let beside = self.artifact_pane_width() >= 620. && !self.artifacts.narrow;
        let preview = browser.preview_open;
        let root = browser
            .tree
            .workspace
            .rsplit('/')
            .next()
            .filter(|s| !s.is_empty())
            .unwrap_or(self.t("files.workspace"))
            .to_owned();
        let focus = browser.focus.clone();
        let key_thread = thread.to_owned();
        let list_thread = thread.to_owned();
        let view = cx.entity().downgrade();
        let tree = div()
            .id("workspace-file-tree")
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .bg(p.surface_muted)
            .role(Role::Tree)
            .aria_label(self.t("files.title"))
            .track_focus(&focus)
            .tab_index(0)
            .on_key_down(cx.listener(move |this, event, window, cx| {
                this.file_key(&key_thread, event, window, cx)
            }))
            .child(
                div()
                    .px(px(12.))
                    .py(px(8.))
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(root),
            )
            .child(
                uniform_list(
                    ElementId::Name(format!("workspace-files:{thread}").into()),
                    browser.tree.rows.len(),
                    move |range, _, cx| {
                        view.update(cx, |this, cx| {
                            let rows = range
                                .filter_map(|index| {
                                    this.files.conversations[&list_thread]
                                        .tree
                                        .rows
                                        .get(index)
                                        .cloned()
                                })
                                .collect::<Vec<_>>();
                            rows.into_iter()
                                .map(|row| this.file_row(&list_thread, row, cx))
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default()
                    },
                )
                .track_scroll(&browser.scroll)
                .flex_1()
                .min_h_0(),
            );
        let body = div()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .flex()
            .when(!preview || beside, |body| {
                body.child(
                    div()
                        .h_full()
                        .min_h_0()
                        .when(preview, |el| {
                            el.w(px(200.))
                                .flex_shrink_0()
                                .border_r(px(0.5))
                                .border_color(p.border)
                        })
                        .when(!preview, |el| el.flex_1().min_w_0())
                        .child(tree),
                )
            })
            .when(preview, |body| {
                body.child(self.workspace_file_preview(thread, !beside, cx))
            });
        div()
            .id("workspace-files-pane")
            .flex()
            .flex_col()
            .size_full()
            .min_w_0()
            .min_h_0()
            .bg(p.surface)
            .child(body)
            .into_any_element()
    }

    fn file_row(&mut self, thread: &str, row: TreeRow, cx: &mut Context<Self>) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let height = pero_theme::UiAppearance::global(cx)
            .typography
            .row_height()
            .max(28.);
        let browser = self.files.conversations.get_mut(thread).unwrap();
        let bounds = browser
            .bounds
            .entry(format!("row:{}", row.path))
            .or_default()
            .clone();
        let focus = browser.focus.clone();
        let expanded = browser.tree.expanded.contains(&row.path);
        let selected = browser.tree.selected.as_deref() == Some(&row.path);
        if let Some(entry) = row.entry {
            let directory = entry.kind == EntryKind::Directory;
            let thread = thread.to_owned();
            let path = row.path.clone();
            let icon = match entry.kind {
                EntryKind::Directory => "folder",
                EntryKind::Symlink => "external-link",
                _ => "file-text",
            };
            pero_theme::interaction_row(
                ElementId::Name(format!("file:{}", row.path).into()),
                selected,
                height,
                pero_theme::Chrome::from_app(cx),
            )
            .relative()
            .child(bounds.probe())
            .pl(px(8. + row.depth as f32 * 16.))
            .pr(px(8.))
            .gap(px(6.))
            .role(Role::TreeItem)
            .aria_label(entry.name.clone())
            .aria_selected(selected)
            .when(directory, |row| row.aria_expanded(expanded))
            .child(div().w(px(12.)).flex_shrink_0().when(directory, |el| {
                el.child(
                    Icon::default()
                        .path(
                            UiIcon::named(if expanded {
                                "chevron-down"
                            } else {
                                "chevron-right"
                            })
                            .path(),
                        )
                        .size(px(12.)),
                )
            }))
            .child(
                Icon::default()
                    .path(UiIcon::named(icon).path())
                    .size(px(15.))
                    .text_color(p.text_muted),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .text_ellipsis()
                    .text_size(px(pero_theme::UiAppearance::global(cx).typography.ui))
                    .child(entry.name),
            )
            .on_click(cx.listener(move |this, _, window, cx| {
                focus.focus(window, cx);
                this.activate_file(&thread, &path, cx);
            }))
            .into_any_element()
        } else {
            let key = match row.notice {
                Some(Notice::Loading) => "files.loading",
                Some(Notice::Empty) => "files.empty",
                Some(Notice::Truncated) => "files.truncated",
                _ => "files.failed",
            };
            let failed = matches!(row.notice, Some(Notice::Failed(_)));
            let thread = thread.to_owned();
            div()
                .h(px(height))
                .pl(px(12. + row.depth as f32 * 16.))
                .pr(px(8.))
                .flex()
                .items_center()
                .gap(px(4.))
                .text_sm()
                .text_color(p.text_muted)
                .child(div().flex_1().min_w_0().text_ellipsis().child(self.t(key)))
                .when(failed, |el| {
                    el.child(
                        Button::new(ElementId::Name(
                            format!("retry-directory:{}", row.path).into(),
                        ))
                        .ghost()
                        .small()
                        .label(self.t("files.retry"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.list_files(&thread, &row.path, cx)
                        })),
                    )
                })
                .into_any_element()
        }
    }

    fn workspace_file_preview(
        &self,
        thread: &str,
        back: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let browser = &self.files.conversations[thread];
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let path = browser
            .pending
            .as_ref()
            .map(|(_, path)| path)
            .or(browser.preview_path.as_ref())
            .cloned()
            .unwrap_or_default();
        let title = path.rsplit('/').next().unwrap_or(&path).to_owned();
        let back_thread = thread.to_owned();
        let reload_thread = thread.to_owned();
        let reload_path = path.clone();
        let header = div()
            .h(px(36.))
            .min_h(px(36.))
            .flex()
            .items_center()
            .px(px(8.))
            .gap(px(4.))
            .when(back, |el| {
                el.child(
                    Button::new("files-back")
                        .relative()
                        .children(self.files_probe(thread, "back"))
                        .ghost()
                        .small()
                        .icon(Icon::default().path(UiIcon::named("arrow-left").path()))
                        .tooltip(self.t("files.back"))
                        .accessibility_label(self.t("files.back"))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            if let Some(browser) = this.files.conversations.get_mut(&back_thread) {
                                browser.preview_open = false;
                                browser.focus.focus(window, cx);
                            }
                            cx.notify();
                        })),
                )
            })
            .child(div().flex_1().min_w_0().text_ellipsis().child(title))
            .child(
                Button::new("files-copy-path")
                    .relative()
                    .children(self.files_probe(thread, "copy"))
                    .ghost()
                    .small()
                    .icon(Icon::default().path(UiIcon::named("copy").path()))
                    .tooltip(self.t("files.copy_path"))
                    .accessibility_label(self.t("files.copy_path"))
                    .on_click(move |_, _, cx| {
                        cx.write_to_clipboard(ClipboardItem::new_string(path.clone()))
                    }),
            )
            .child(
                Button::new("files-reload-preview")
                    .relative()
                    .children(self.files_probe(thread, "preview-refresh"))
                    .ghost()
                    .small()
                    .icon(Icon::default().path(UiIcon::Refresh.path()))
                    .tooltip(self.t("files.reload"))
                    .accessibility_label(self.t("files.reload"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.read_workspace_file(&reload_thread, &reload_path, cx)
                    })),
            );
        div()
            .flex_1()
            .min_w_0()
            .min_h_0()
            .flex()
            .flex_col()
            .child(header)
            .when(browser.pending.is_some(), |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(self.t("files.loading")),
                )
            })
            .when_some(browser.error.clone(), |el, error| {
                el.child(div().p(px(12.)).text_sm().child(error))
            })
            .when_some(browser.reader.clone(), |el, reader| {
                el.child(div().flex_1().min_h_0().min_w_0().child(reader))
            })
            .into_any_element()
    }
}
