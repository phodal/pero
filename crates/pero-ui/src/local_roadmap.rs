use crate::app::Workbench;
use crate::workspace::{ConversationTab, WorkbenchPage};
use gpui_kit::{
    component::{
        button::*,
        input::Input,
        menu::{DropdownMenu, PopupMenuItem},
        *,
    },
    prelude::*,
    *,
};
use pero_contracts::{
    HostEvent,
    roadmap::{LocalRoadmap, RoadmapError, RoadmapItem},
};
use serde::Serialize;
use serde_json::json;

#[derive(Default, Serialize)]
pub(crate) struct RoadmapState {
    pub data: Option<LocalRoadmap>,
    pub selected_line: Option<usize>,
    pub show_cloud: bool,
    pub show_completed: bool,
    pub loading: bool,
    #[serde(skip)]
    sessions: Vec<RoadmapSession>,
    #[serde(skip)]
    expanded_sections: std::collections::BTreeMap<(String, Vec<String>), bool>,
}

struct RoadmapSession {
    workspace: String,
    path: String,
    goal: String,
    thread_id: String,
}

impl Workbench {
    pub(crate) fn receive_roadmap(&mut self, event: &HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind != "local_roadmap" {
            return false;
        }
        if let Ok(data) = serde_json::from_value::<LocalRoadmap>(event.data.clone()) {
            self.local_roadmap.data = Some(data);
            self.local_roadmap.loading = false;
            self.local_roadmap.selected_line = None;
        }
        cx.notify();
        true
    }

    pub(crate) fn project_tasks(&self, narrow: bool, cx: &mut Context<Self>) -> impl IntoElement {
        if self.current_project(cx).is_some_and(|project| {
            project.research_id().is_some()
                && project.workspace.is_none()
                && project.shared_id.is_none()
        }) {
            return div()
                .flex_1()
                .p(px(12.))
                .flex()
                .flex_col()
                .gap(px(12.))
                .child(self.t("research.directory_needed"))
                .child(
                    Button::new("research-add-directory")
                        .outline()
                        .label(self.t("research.edit"))
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.select_project_view(crate::projects::ProjectTab::Overview, cx);
                            this.edit_research_project(
                                crate::research_projects::ProjectEdit::Details,
                                window,
                                cx,
                            );
                        })),
                );
        }
        let local = self
            .current_project(cx)
            .is_some_and(|project| project.workspace.is_some());
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .when(local, |el| {
                let sources = [self.t("roadmap.local"), self.t("roadmap.cloud")];
                let cloud = self.local_roadmap.show_cloud;
                let owner = cx.weak_entity();
                el.child(
                    div()
                        .px(px(12.))
                        .py(px(6.))
                        .flex()
                        .items_center()
                        .gap(px(4.))
                        .when(!cloud && self.local_roadmap.selected_line.is_some(), |el| {
                            el.child(
                                pero_theme::ghost_icon_button(
                                    "local-roadmap-back",
                                    pero_theme::Chrome::from_app(cx),
                                    cx,
                                )
                                .icon(Icon::default().path("icons/arrow-left.svg"))
                                .accessibility_label(self.t("project.back_tasks"))
                                .tooltip(self.t("project.back_tasks"))
                                .on_click(cx.listener(
                                    |this, _, _, cx| {
                                        this.local_roadmap.selected_line = None;
                                        cx.notify();
                                    },
                                )),
                            )
                        })
                        .child(
                            Button::new("task-location")
                                .ghost()
                                .small()
                                .label(sources[usize::from(cloud)])
                                .dropdown_caret(true)
                                .dropdown_menu_with_anchor(
                                    Anchor::BottomLeft,
                                    move |menu, _, _| {
                                        sources.into_iter().enumerate().fold(
                                            menu,
                                            |menu, (index, label)| {
                                                let owner = owner.clone();
                                                menu.item(
                                                    PopupMenuItem::new(label)
                                                        .checked((index == 1) == cloud)
                                                        .on_click(move |_, _, cx| {
                                                            let _ = owner.update(cx, |this, cx| {
                                                                this.local_roadmap.show_cloud =
                                                                    index == 1;
                                                                cx.notify();
                                                            });
                                                        }),
                                                )
                                            },
                                        )
                                    },
                                ),
                        )
                        .child(div().flex_1())
                        .when(!cloud, |el| {
                            el.child(
                                Button::new("local-roadmap-refresh")
                                    .ghost()
                                    .small()
                                    .icon(Icon::default().path("icons/refresh.svg"))
                                    .tooltip(self.t("remote.refresh"))
                                    .accessibility_label(self.t("remote.refresh"))
                                    .disabled(self.local_roadmap.loading || !self.connected)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.local_roadmap.loading = true;
                                        this.command(json!({"action":"load_roadmap"}), cx);
                                    })),
                            )
                        }),
                )
            })
            .when(local && !self.local_roadmap.show_cloud, |el| {
                el.child(self.local_roadmap_view(cx))
            })
            .when(!local || self.local_roadmap.show_cloud, |el| {
                el.child(self.remote_view(narrow, cx))
            })
    }

    fn start_roadmap_item(&mut self, cx: &mut Context<Self>) {
        let Some(data) = &self.local_roadmap.data else {
            return;
        };
        let Some(item) = data
            .items
            .iter()
            .find(|item| Some(item.line) == self.local_roadmap.selected_line)
        else {
            return;
        };
        if item.checked
            || self.workspace != data.workspace
            || !self.connected
            || self.local_roadmap.loading
        {
            return;
        }
        if let Some(index) = self
            .local_roadmap
            .sessions
            .iter()
            .find(|session| {
                session.workspace == data.workspace
                    && session.path == data.path
                    && session.goal == item.text
            })
            .and_then(|session| {
                self.chat
                    .read(cx)
                    .chats
                    .iter()
                    .position(|chat| chat.id == session.thread_id)
            })
        {
            self.navigate(WorkbenchPage::Conversation, cx);
            self.focus_chat(Some(index), ConversationTab::Chat, cx);
            return;
        }
        if !self
            .chat
            .read(cx)
            .agents
            .get(self.chat.read(cx).agent_index)
            .is_some_and(|agent| agent.available)
        {
            return;
        }
        let prompt = item.prompt(&data.path);
        let workspace = data.workspace.clone();
        let path = data.path.clone();
        let goal = item.text.clone();
        self.new_chat(cx);
        let thread_id = self.chat.update(cx, |panel, cx| {
            panel.submit_prompt(prompt, vec![], cx);
            panel.chats[panel.active_chat.expect("new roadmap chat")]
                .id
                .clone()
        });
        self.local_roadmap.sessions.push(RoadmapSession {
            workspace,
            path,
            goal,
            thread_id,
        });
    }

    fn local_roadmap_view(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let agents = self.chat.read(cx).agents.clone();
        let agent_index = self.chat.read(cx).agent_index;
        let workspace = self
            .current_project(cx)
            .and_then(|project| project.workspace)
            .unwrap_or_default();
        let data = self
            .local_roadmap
            .data
            .as_ref()
            .filter(|data| data.workspace == workspace);
        let loading = self.local_roadmap.loading || data.is_none();
        let selected = data.and_then(|data| {
            data.items
                .iter()
                .find(|item| Some(item.line) == self.local_roadmap.selected_line)
        });
        let query = self.remote.search.read(cx).value().to_lowercase();
        let items = data.map(|data| data.items.as_slice()).unwrap_or(&[]);
        let visible = items
            .iter()
            .filter(|item| {
                (self.local_roadmap.show_completed || !item.checked)
                    && (query.is_empty()
                        || format!("{} {}", item.text, item.headings.join(" "))
                            .to_lowercase()
                            .contains(&query))
            })
            .collect::<Vec<_>>();
        // Omit a shared document title, while retaining all section levels below it.
        let skip_title = items.first().is_some_and(|first| {
            first.headings.first().is_some_and(|title| title.eq_ignore_ascii_case("roadmap"))
                && items.iter().all(|item| item.headings.len() > 1
                && item.headings.first() == first.headings.first())
        });
        div()
            .flex_1()
            .min_h_0()
            .flex()
            .flex_col()
            .when(loading, |el| {
                el.child(
                    div()
                        .px(px(12.))
                        .text_color(p.text_muted)
                        .child(self.t("roadmap.loading")),
                )
            })
            .when(data.and_then(|data| data.error.as_ref()).is_some(), |el| {
                el.child(
                    div()
                        .id("local-roadmap-error")
                        .px(px(12.))
                        .py(px(16.))
                        .role(Role::Alert)
                        .whitespace_normal()
                        .child(self.t(match data.unwrap().error.as_ref().unwrap() {
                            RoadmapError::NotFound => "roadmap.not_found",
                            RoadmapError::Read => "roadmap.read_error",
                            RoadmapError::Invalid => "roadmap.invalid",
                        })),
                )
            })
            .when(
                selected.is_none() && data.is_some_and(|data| data.error.is_none()),
                |el| {
                    el.child(
                        div()
                            .px(px(12.))
                            .pb(px(12.))
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .child(
                                div().flex_1().min_w_0().child(
                                    pero_theme::search_field(
                                        Input::new(&self.remote.search),
                                        pero_theme::Chrome::from_app(cx),
                                    )
                                    .prefix(self.icon("search"))
                                    .w_full(),
                                ),
                            )
                            .child(
                                Button::new("local-roadmap-completed")
                                    .ghost()
                                    .small()
                                    .label(self.t("roadmap.show_completed"))
                                    .selected(self.local_roadmap.show_completed)
                                    .toggled(self.local_roadmap.show_completed)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.local_roadmap.show_completed =
                                            !this.local_roadmap.show_completed;
                                        cx.notify();
                                    })),
                            ),
                    )
                    .child(
                        div()
                            .id("local-roadmap-list")
                            .flex_1()
                            .min_h_0()
                            .overflow_y_scroll()
                            .px(px(12.))
                            .when(visible.is_empty(), |el| {
                                el.child(
                                    div()
                                        .py(px(20.))
                                        .text_color(p.text_muted)
                                        .child(self.t("roadmap.empty")),
                                )
                            })
                            .children(self.roadmap_rows(&visible, &workspace, !query.is_empty(), usize::from(skip_title), 0, true, p, cx)),
                    )
                },
            )
            .when_some(selected, |el, item| {
                let session = data
                    .and_then(|data| {
                        self.local_roadmap.sessions.iter().find(|session| {
                            session.workspace == data.workspace
                                && session.path == data.path
                                && session.goal == item.text
                        })
                    })
                    .and_then(|session| {
                        self.chat
                            .read(cx)
                            .chats
                            .iter()
                            .find(|chat| chat.id == session.thread_id)
                            .map(|chat| chat.state.as_str().to_owned())
                    });
                let chrome = pero_theme::Chrome::from_app(cx);
                let (description, acceptance) = item.detail_text();
                let agent_label = agents.get(agent_index).map(|agent| agent.name.clone())
                    .unwrap_or_else(|| self.t("field.agent").to_owned());
                el.child(
                    div().id("local-roadmap-detail").flex_1().min_h_0().overflow_y_scroll()
                        .p(chrome.geo(pero_theme::SPACE_16))
                        .child(div().text_size(chrome.text(pero_theme::TYPE_HEADING))
                            .font_weight(FontWeight::SEMIBOLD).whitespace_normal().child(item.title.clone()))
                        .when(!description.is_empty(), |el| el.child(div().mt(px(8.))
                            .whitespace_normal().child(description.to_owned())))
                        .when_some(acceptance, |el, criterion| el.child(div().mt(px(16.))
                            .child(div().text_size(chrome.text(pero_theme::TYPE_CAPTION)).text_color(p.text_muted)
                                .child(self.t("remote.acceptance")))
                            .child(div().mt(px(4.)).whitespace_normal().child(criterion.to_owned()))))
                        .child(div().mt(px(12.)).text_size(chrome.text(pero_theme::TYPE_CAPTION))
                            .text_color(p.text_muted).whitespace_normal()
                            .child(format!("{}:{}  ·  {}", data.unwrap().path, item.line, item.headings.join(" / "))))
                        .when(item.checked, |el| {
                            el.child(
                                div()
                                    .mt(px(16.))
                                    .text_color(p.text_muted)
                                    .child(self.t("roadmap.source_completed")),
                            )
                        })
                        .when(!item.checked, |el| {
                            el.child(
                                div()
                                    .mt(px(20.))
                                    .flex()
                                    .flex_wrap()
                                    .gap(px(8.))
                                    .items_center()
                                    .when(session.is_none(), |el| {
                                        let owner = cx.weak_entity();
                                        let options = agents.iter().map(|agent| (agent.name.clone(), agent.available)).collect::<Vec<_>>();
                                        el.child(div().text_size(chrome.text(pero_theme::TYPE_CAPTION)).text_color(p.text_muted)
                                            .child(self.t("field.agent")))
                                            .child(Button::new("roadmap-agent").ghost().small().label(agent_label)
                                                .dropdown_caret(true)
                                                .dropdown_menu_with_anchor(Anchor::BottomLeft, move |menu, _, _| {
                                                    options.iter().enumerate().fold(menu, |menu, (index, (name, available))| {
                                                        let owner = owner.clone();
                                                        menu.item(PopupMenuItem::new(name.clone()).checked(index == agent_index)
                                                            .disabled(!available).on_click(move |_, _, cx| {
                                                                let _ = owner.update(cx, |this, cx| {
                                                                    this.chat.update(cx, |chat, _| chat.agent_index = index);
                                                                    cx.notify();
                                                                });
                                                            }))
                                                    })
                                                }))
                                    })
                                    .child(div().flex_1())
                                    .child(
                                        Button::new("local-roadmap-start")
                                            .primary()
                                            .label(self.t(if session.is_some() {
                                                "roadmap.open_chat"
                                            } else {
                                                "roadmap.execute"
                                            }))
                                            .disabled(
                                                loading
                                                    || !self.connected
                                                    || self.workspace != workspace
                                                    || session.is_none()
                                                        && !agents
                                                            .get(agent_index)
                                                            .is_some_and(|agent| agent.available),
                                            )
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                this.start_roadmap_item(cx)
                                            })),
                                    ),
                            )
                            .when(
                                session.is_none() && !agents.iter().any(|agent| agent.available),
                                |el| {
                                    el.child(
                                        div()
                                            .mt(px(12.))
                                            .whitespace_normal()
                                            .child(self.t("roadmap.no_agent")),
                                    )
                                },
                            )
                            .when_some(session, |el, chat| {
                                el.child(div().mt(px(12.)).text_color(p.text_muted).child(self.t(
                                    match chat.as_str() {
                                        "running" | "connecting" => "roadmap.running",
                                        "idle" => "roadmap.finished",
                                        "auth_required" => "roadmap.auth_required",
                                        _ => "roadmap.attention",
                                    },
                                )))
                            })
                        }),
                )
            })
    }

    fn roadmap_rows(
        &self,
        items: &[&RoadmapItem],
        workspace: &str,
        searching: bool,
        depth: usize,
        indent: usize,
        first_branch: bool,
        p: &pero_theme::Palette,
        cx: &mut Context<Self>,
    ) -> Vec<AnyElement> {
        let caption = pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption);
        let mut rows = Vec::new();
        for (index, group) in items
            .chunk_by(|left, right| left.headings.get(depth) == right.headings.get(depth))
            .enumerate()
        {
            let first = group[0];
            if let Some(section) = first.headings.get(depth) {
                let key = (workspace.to_owned(), first.headings[..=depth].to_vec());
                let expanded = searching
                    || self
                        .local_roadmap
                        .expanded_sections
                        .get(&key)
                        .copied()
                        .unwrap_or(first_branch && index == 0);
                let header = div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .text_size(caption)
                    .text_color(p.text_muted)
                    .child(
                        Icon::default().path(if expanded {
                            "icons/chevron-down.svg"
                        } else {
                            "icons/chevron-right.svg"
                        })
                        .size(px(12.)),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(section.clone()),
                    )
                    .child(group.len().to_string());
                rows.push(
                    div()
                        .pl(px(indent as f32 * 12.))
                        .pt(px(if indent == 0 { 4. } else { 0. }))
                        .child(if searching {
                            div()
                                .px(px(8.))
                                .py(px(4.))
                                .flex()
                                .child(header)
                                .into_any_element()
                        } else {
                            Button::new(SharedString::from(format!("roadmap-section-{}-{depth}", first.line)))
                                .ghost()
                                .small()
                                .w_full()
                                .accessibility_label(format!("{section} ({})", group.len()))
                                .tooltip(first.headings[..=depth].join(" / "))
                                .child(header)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.local_roadmap
                                        .expanded_sections
                                        .insert(key.clone(), !expanded);
                                    cx.notify();
                                }))
                                .into_any_element()
                        })
                        .into_any_element(),
                );
                if expanded {
                    rows.extend(self.roadmap_rows(group, workspace, searching, depth + 1, indent + 1,
                        first_branch && index == 0, p, cx));
                }
                continue;
            }
            for item in group {
                let line = item.line;
                let title = format!("{}{}", if item.checked { "✓  " } else { "○  " }, item.title);
                rows.push(
                    div()
                        .child(
                            Button::new(("local-roadmap-item", line))
                                .ghost()
                                .w_full()
                                .h_auto()
                                .min_h(px(30.))
                                .justify_start()
                                .tooltip(format!("{} · L{line}", item.title))
                                .accessibility_label(item.title.clone())
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w_0()
                                        .flex()
                                        .items_center()
                                        .gap(px(8.))
                                        .pl(px(indent as f32 * 12. + if item.parent_line.is_some() { 12. } else { 0. }))
                                        .child(
                                            div()
                                                .flex_1()
                                                .min_w_0()
                                                .whitespace_normal()
                                                .when(item.checked, |el| {
                                                    el.text_color(p.text_muted)
                                                })
                                                .child(title),
                                        ),
                                )
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.local_roadmap.selected_line = Some(line);
                                    cx.notify();
                                })),
                        )
                        .into_any_element(),
                );
            }
        }
        rows
    }
}
