//! One pane toolbar for workspace files, artifact deliveries and code changes.
use crate::{
    assets::UiIcon,
    panel::{ChatAction, ChatPanel},
    session_artifacts::ArtifactCollection,
};
use gpui_kit::{
    base::Selectable,
    component::{
        Disableable, Icon, Sizable,
        button::*,
        menu::{DropdownMenu, PopupMenuItem},
        popover::Popover,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    content_document::ContentFormat,
    session_artifact::{
        ArtifactImageType, ArtifactMedia, ArtifactRelationRole, ArtifactSource, SessionArtifact,
        SessionArtifactVersion,
    },
    workbench::{ArtifactView, ResourceTab},
};

impl ChatPanel {
    pub(crate) fn pane_toolbar(
        &self,
        thread: &str,
        state: &ArtifactCollection,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let files = self.files.selection.tab == ResourceTab::Files && !state.show_changes;
        let artifacts = self.files.selection.tab == ResourceTab::Artifacts && !state.show_changes;
        let picker_thread = thread.to_owned();
        let menu_owner = cx.entity().downgrade();
        let file_label = self.t("artifacts.add_file").to_owned();
        let path_label = self.t("artifacts.enter_path").to_owned();
        let refresh_thread = thread.to_owned();
        let close_thread = thread.to_owned();
        let files_thread = thread.to_owned();
        let artifacts_thread = thread.to_owned();
        let changes_thread = thread.to_owned();
        let identity = (artifacts
            && (self.artifacts.view == ArtifactView::Gallery || state.chart.is_some()))
        .then(|| state.selected.as_ref())
        .flatten()
        .and_then(|(id, version)| {
            state
                .items
                .iter()
                .find(|item| &item.id == id)
                .map(|item| (item, *version))
        });
        let destination = |id, label, selected, action: &str| {
            Button::new(id)
                .relative()
                .children(self.files_probe(thread, action))
                .ghost()
                .small()
                .label(self.t(label).to_owned())
                .toggled(selected)
                .selected(selected)
                .flex_shrink_0()
        };
        div()
            .id("artifact-pane-toolbar")
            .h(px(36.))
            .min_h(px(36.))
            .w_full()
            .px(px(8.))
            .flex()
            .items_center()
            .gap(px(4.))
            .border_b(px(0.5))
            .border_color(p.border)
            .child(
                destination("files-tab", "files.title", files, "files-tab").on_click(cx.listener(
                    move |this, _, _, cx| {
                        this.choose_resource_tab(&files_thread, ResourceTab::Files, cx)
                    },
                )),
            )
            .child(
                destination(
                    "artifacts-tab",
                    "artifacts.title",
                    artifacts,
                    "artifacts-tab",
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.choose_resource_tab(&artifacts_thread, ResourceTab::Artifacts, cx)
                })),
            )
            .when(!state.items.is_empty(), |el| {
                el.child(
                    div()
                        .flex_shrink_0()
                        .text_sm()
                        .text_color(p.text_muted)
                        .child(state.items.len().to_string()),
                )
            })
            .child(
                destination(
                    "outputs-changes",
                    "changes.title",
                    state.show_changes,
                    "changes-tab",
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.artifacts
                        .conversations
                        .entry(changes_thread.clone())
                        .or_default()
                        .show_changes = true;
                    let first = this
                        .chats
                        .iter()
                        .find(|chat| chat.id == changes_thread)
                        .filter(|chat| chat.changes.selected.is_none())
                        .and_then(|chat| chat.changes.records.last())
                        .map(|record| record.id.clone());
                    if let Some(id) = first {
                        this.read_changes(&changes_thread, &id, 0, cx);
                    }
                    this.artifacts
                        .conversations
                        .entry(changes_thread.clone())
                        .or_default()
                        .open = true;
                    cx.notify();
                })),
            )
            .when_some(identity, |el, (artifact, version)| {
                el.child(self.artifact_identity(thread, state, artifact, version, cx))
            })
            .when(identity.is_none(), |el| el.child(div().flex_1()))
            .when(artifacts, |el| {
                el.child(
                    div()
                        .id("artifact-view-controls")
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .p(px(2.))
                        .rounded(px(7.))
                        .bg(p.surface_muted)
                        .children(
                            [
                                (ArtifactView::Icons, "layout-grid", "artifacts.view_icons"),
                                (ArtifactView::List, "layout-list", "artifacts.view_list"),
                                (
                                    ArtifactView::Gallery,
                                    "gallery-horizontal",
                                    "artifacts.view_gallery",
                                ),
                            ]
                            .into_iter()
                            .map(|(view, icon, label)| {
                                let active = self.artifacts.view == view;
                                Button::new(SharedString::from(format!("artifact-view-{icon}")))
                                    .ghost()
                                    .small()
                                    .w(px(28.))
                                    .h(px(24.))
                                    .p_0()
                                    .rounded(px(5.))
                                    .icon(
                                        Icon::default()
                                            .path(UiIcon::named(icon).path())
                                            .size(px(14.)),
                                    )
                                    .text_color(if active { p.text } else { p.text_muted })
                                    .when(active, |button| {
                                        button.bg(p.surface).border(px(0.5)).border_color(p.border)
                                    })
                                    .selected(active)
                                    .tooltip(self.t(label).to_owned())
                                    .accessibility_label(self.t(label).to_owned())
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.set_artifact_view(view, cx);
                                        cx.emit(ChatAction::ArtifactView { view });
                                    }))
                            }),
                        ),
                )
                .child(div().w(px(4.)).flex_shrink_0())
                .child(
                    self.artifact_icon_button(
                        thread,
                        "artifact-import",
                        "import",
                        "plus",
                        self.t("artifacts.import"),
                    )
                    .disabled(state.mutation.is_some())
                    .dropdown_caret(false)
                    .dropdown_menu_with_anchor(
                        Anchor::BottomRight,
                        move |menu, _, _| {
                            let file_owner = menu_owner.clone();
                            let file_thread = picker_thread.clone();
                            let path_owner = menu_owner.clone();
                            let path_thread = picker_thread.clone();
                            menu.item(PopupMenuItem::new(file_label.clone()).on_click(
                                move |_, _, cx| {
                                    let _ = file_owner.update(cx, |_, cx| {
                                        cx.emit(ChatAction::ChooseArtifactFile {
                                            thread_id: file_thread.clone(),
                                        })
                                    });
                                },
                            ))
                            .item(
                                PopupMenuItem::new(path_label.clone()).on_click(move |_, _, cx| {
                                    let _ = path_owner.update(cx, |this, cx| {
                                        if let Some(state) =
                                            this.artifacts.conversations.get_mut(&path_thread)
                                        {
                                            state.path_open = true;
                                        }
                                        cx.notify();
                                    });
                                }),
                            )
                        },
                    ),
                )
            })
            .when(files, |el| {
                let refresh_thread = thread.to_owned();
                el.child(
                    Button::new("files-refresh")
                        .relative()
                        .children(self.files_probe(thread, "refresh"))
                        .ghost()
                        .small()
                        .icon(Icon::default().path(UiIcon::Refresh.path()))
                        .tooltip(self.t("files.refresh"))
                        .accessibility_label(self.t("files.refresh"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.refresh_files(&refresh_thread, cx)
                        })),
                )
            })
            .when(artifacts, |el| {
                el.child(
                    self.artifact_icon_button(
                        thread,
                        "artifact-refresh",
                        "refresh",
                        "refresh",
                        self.t("artifacts.refresh"),
                    )
                    .disabled(state.loading)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.refresh_artifacts(&refresh_thread, cx)
                    })),
                )
            })
            .when(artifacts && !self.artifacts.narrow, |el| {
                let toggle_thread = thread.to_owned();
                let (icon, label) = if state.maximized {
                    ("columns-2", "artifacts.restore_split")
                } else {
                    ("maximize", "artifacts.expand")
                };
                el.child(
                    self.artifact_icon_button(
                        thread,
                        "artifact-expand",
                        "expand",
                        icon,
                        self.t(label),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(state) = this.artifacts.conversations.get_mut(&toggle_thread) {
                            state.maximized = !state.maximized;
                            cx.notify();
                        }
                    })),
                )
            })
            .when(files, |el| {
                let close_thread = thread.to_owned();
                el.child(
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
            })
            .when(!files, |el| {
                el.child(
                    self.artifact_icon_button(
                        thread,
                        "artifact-close",
                        "close",
                        "x",
                        self.t("artifacts.close"),
                    )
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(state) = this.artifacts.conversations.get_mut(&close_thread) {
                            state.open = false;
                            state.maximized = false;
                        }
                        this.composer.focus_handle(cx).focus(window, cx);
                        cx.notify();
                    })),
                )
            })
            .into_any_element()
    }

    fn artifact_identity(
        &self,
        thread: &str,
        state: &ArtifactCollection,
        artifact: &SessionArtifact,
        version: u64,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let p = pero_theme::UiAppearance::global(cx).palette.clone();
        let source = artifact
            .versions
            .iter()
            .find(|item| item.version == version)
            .unwrap_or_else(|| artifact.latest());
        let filename = match &source.source {
            ArtifactSource::File { path } => {
                path.rsplit(['/', '\\']).next().unwrap_or(path).to_owned()
            }
            ArtifactSource::Text | ArtifactSource::Research { .. } => artifact.title.clone(),
        };
        let previous_thread = thread.to_owned();
        let previous_id = artifact.id.clone();
        let next_thread = thread.to_owned();
        let next_id = artifact.id.clone();
        let saved = if source.created_at == 0 {
            self.t("artifacts.unknown_time").to_owned()
        } else {
            utc_stamp(source.created_at)
        };
        let origin = match &source.source {
            ArtifactSource::File { path } => path.clone(),
            ArtifactSource::Research { provenance } => {
                format!(
                    "{} · {}",
                    self.t("artifacts.origin_research"),
                    provenance.slot
                )
            }
            ArtifactSource::Text => self.t("artifacts.origin_conversation").to_owned(),
        };
        let snapshot = format!(
            "v{version} · {} · {} B",
            artifact_kind_label(source),
            source.bytes
        );
        let sha = source.sha256.clone();
        let checkpoint = match &source.source {
            ArtifactSource::Research { provenance } => Some(provenance.checkpoint_id.clone()),
            _ => None,
        };
        let linked = source.related.iter().map(|link| {
            let item = state.items.iter().find(|item| item.id == link.artifact_id);
            let name = item
                .and_then(|item| {
                    item.versions
                        .iter()
                        .find(|snapshot| snapshot.version == link.version)
                        .map(|snapshot| {
                            snapshot
                                .filename
                                .clone()
                                .unwrap_or_else(|| item.title.clone())
                        })
                })
                .unwrap_or_else(|| self.t("artifacts.file_unavailable").to_owned());
            (
                link.artifact_id.clone(),
                link.version,
                format!(
                    "{} · {name} · v{}",
                    self.t(relation_key(link.role)),
                    link.version
                ),
                item.is_some(),
            )
        });
        let companions = match &source.source {
            ArtifactSource::Research { provenance } => state
                .items
                .iter()
                .filter(|item| item.id != artifact.id)
                .flat_map(|item| {
                    item.versions.iter().filter_map(|snapshot| {
                        matches!(&snapshot.source, ArtifactSource::Research { provenance: other }
                            if other.program_id == provenance.program_id && other.checkpoint_id == provenance.checkpoint_id)
                        .then(|| {
                            (
                                item.id.clone(),
                                snapshot.version,
                                format!(
                                    "{} · v{}",
                                    snapshot.filename.clone().unwrap_or_else(|| item.title.clone()),
                                    snapshot.version
                                ),
                            )
                        })
                    })
                })
                .collect::<Vec<_>>(),
            _ => Vec::new(),
        };
        let open_thread = thread.to_owned();
        let detail = |label: String, value: String| {
            div()
                .flex()
                .gap(px(8.))
                .child(div().flex_shrink_0().text_color(p.text_muted).child(label))
                .child(div().min_w_0().child(value))
        };
        div()
            .flex_1()
            .min_w_0()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(
                div()
                    .text_sm()
                    .text_color(p.text_muted)
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .child(filename),
            )
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-previous-version",
                    "previous",
                    "chevron-left",
                    self.t("artifacts.previous_version"),
                )
                .disabled(version <= 1)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.read_artifact(
                        &previous_thread,
                        &previous_id,
                        version.saturating_sub(1),
                        false,
                        cx,
                    )
                })),
            )
            .child(
                div()
                    .flex_shrink_0()
                    .text_sm()
                    .text_color(p.text_muted)
                    .child(format!("v{version} / {}", artifact.latest().version)),
            )
            .child(
                self.artifact_icon_button(
                    thread,
                    "artifact-next-version",
                    "next",
                    "chevron-right",
                    self.t("artifacts.next_version"),
                )
                .disabled(version >= artifact.latest().version)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.read_artifact(&next_thread, &next_id, version + 1, false, cx)
                })),
            )
            .child(
                Popover::new("artifact-version-details")
                    .anchor(Anchor::BottomRight)
                    .trigger(self.artifact_icon_button(
                        thread,
                        "artifact-version-details",
                        "version-details",
                        "info",
                        self.t("artifacts.version_details"),
                    ))
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .max_w(px(320.))
                    .p(px(8.))
                    .text_sm()
                    .child(detail(self.t("artifacts.snapshot").to_owned(), snapshot))
                    .child(detail(self.t("artifacts.saved_at").to_owned(), saved))
                    .child(detail(self.t("artifacts.origin").to_owned(), origin))
                    .when_some(checkpoint, |el, checkpoint| {
                        el.child(detail(
                            self.t("artifacts.checkpoint").to_owned(),
                            checkpoint,
                        ))
                    })
                    .child(detail("SHA-256".to_owned(), sha))
                    .when(!source.related.is_empty(), |el| {
                        el.child(
                            div()
                                .text_color(p.text_muted)
                                .child(self.t("artifacts.linked_files").to_owned()),
                        )
                    })
                    .children(linked.map(|(id, link_version, label, available)| {
                        let thread = open_thread.clone();
                        Button::new(SharedString::from(format!(
                            "artifact-related-{id}-{link_version}"
                        )))
                        .ghost()
                        .small()
                        .label(label)
                        .disabled(!available)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.read_artifact(&thread, &id, link_version, false, cx)
                        }))
                        .into_any_element()
                    }))
                    .when(!companions.is_empty(), |el| {
                        el.child(
                            div()
                                .text_color(p.text_muted)
                                .child(self.t("artifacts.checkpoint_exports").to_owned()),
                        )
                    })
                    .children(companions.into_iter().map(|(id, link_version, label)| {
                        let thread = open_thread.clone();
                        Button::new(SharedString::from(format!(
                            "artifact-companion-{id}-{link_version}"
                        )))
                        .ghost()
                        .small()
                        .label(label)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.read_artifact(&thread, &id, link_version, false, cx)
                        }))
                        .into_any_element()
                    })),
            )
            .into_any_element()
    }
}

fn relation_key(role: ArtifactRelationRole) -> &'static str {
    match role {
        ArtifactRelationRole::Input => "artifacts.relation_input",
        ArtifactRelationRole::Code => "artifacts.relation_code",
        ArtifactRelationRole::ExecutionLog => "artifacts.relation_execution_log",
        ArtifactRelationRole::Environment => "artifacts.relation_environment",
        ArtifactRelationRole::Review => "artifacts.relation_review",
    }
}

fn artifact_kind_label(version: &SessionArtifactVersion) -> String {
    match version.resolved_media() {
        ArtifactMedia::Image { mime_type } => match mime_type {
            ArtifactImageType::Png => "PNG",
            ArtifactImageType::Jpeg => "JPEG",
            ArtifactImageType::Gif => "GIF",
            ArtifactImageType::Webp => "WEBP",
            ArtifactImageType::Svg => "SVG",
        }
        .to_owned(),
        ArtifactMedia::Csv => "CSV".to_owned(),
        ArtifactMedia::Tsv => "TSV".to_owned(),
        ArtifactMedia::Pdf => "PDF".to_owned(),
        ArtifactMedia::Html => "HTML".to_owned(),
        ArtifactMedia::Notebook => "Notebook".to_owned(),
        ArtifactMedia::Document { format } => match format {
            ContentFormat::Markdown => "Markdown".to_owned(),
            ContentFormat::Json => "JSON".to_owned(),
            ContentFormat::JsonLines => "JSONL".to_owned(),
            ContentFormat::Code(language) => language,
            ContentFormat::Text => "Text".to_owned(),
        },
    }
}

fn utc_stamp(secs: u64) -> String {
    let z = secs as i64 / 86_400 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    let hour = (secs % 86_400) / 3_600;
    let minute = (secs % 3_600) / 60;
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02} UTC")
}
