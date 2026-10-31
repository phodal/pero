//! Search anywhere. A panel under the title bar lists places, sessions,
//! projects, and tasks; the sidebar list itself stays unfiltered.
use crate::{
    app::Workbench,
    remote::string,
    workspace::{ConversationTab, WorkbenchPage},
};
use gpui_kit::{
    component::{
        list::{List, ListDelegate, ListItem, ListState},
        *,
    },
    prelude::*,
    *,
};

gpui_kit::actions!(spotlight, [OpenSpotlight]);

pub(crate) type SpotlightList = ListState<Spotlight>;

#[derive(Clone)]
enum Target {
    NewChat,
    OpenApp { name: &'static str, panel: &'static str },
    Navigate(WorkbenchPage),
    Settings,
    Project(String),
    Session(usize),
    Task(String),
}

struct Hit {
    label: String,
    hint: String,
    icon: &'static str,
    target: Target,
}

pub(crate) struct Spotlight {
    owner: WeakEntity<Workbench>,
    hits: Vec<Hit>,
    filtered: Vec<usize>,
    selected: Option<usize>,
}

impl Spotlight {
    fn collect(workbench: &Workbench, cx: &App) -> Vec<Hit> {
        let place = workbench.t("spotlight.place").to_string();
        let mut hits = Vec::new();
        let panel = workbench.chat.read(cx);
        for (index, chat) in panel.chats.iter().enumerate().rev() {
            let label = chat.title.display().to_string();
            if label.is_empty() {
                continue;
            }
            hits.push(Hit {
                label,
                hint: workbench.t("spotlight.session").to_string(),
                icon: "terminal",
                target: Target::Session(index),
            });
        }
        for (label, icon, target) in [
            (
                workbench.t("chat.new"),
                "plus",
                Target::NewChat,
            ),
            (
                workbench.t("nav.insights"),
                "layout-list",
                Target::OpenApp {
                    name: "insights",
                    panel: "main",
                },
            ),
            (
                workbench.t("nav.data"),
                "database",
                Target::OpenApp {
                    name: "data",
                    panel: "main",
                },
            ),
            (
                workbench.t("nav.connectors"),
                "plug",
                Target::OpenApp {
                    name: "connectors",
                    panel: "main",
                },
            ),
            (
                workbench.t("nav.apps"),
                "file-code",
                Target::Navigate(WorkbenchPage::Apps),
            ),
            (
                workbench.t("nav.projects"),
                "folder",
                Target::Navigate(WorkbenchPage::Projects),
            ),
            (
                workbench.t("settings.title"),
                "settings",
                Target::Settings,
            ),
        ] {
            hits.push(Hit {
                label: label.to_string(),
                hint: place.clone(),
                icon,
                target,
            });
        }
        for project in workbench.project_catalog(cx) {
            hits.push(Hit {
                label: project.name,
                hint: workbench.t("spotlight.project").to_string(),
                icon: "folder",
                target: Target::Project(project.key),
            });
        }
        for task in workbench.remote.tasks() {
            let label = string(task, "title");
            let id = string(task, "id");
            if label.is_empty() || id.is_empty() {
                continue;
            }
            hits.push(Hit {
                label: label.to_string(),
                hint: workbench.t("spotlight.task").to_string(),
                icon: "layout-list",
                target: Target::Task(id.to_string()),
            });
        }
        hits
    }

    fn matching(hits: &[Hit], query: &str) -> Vec<usize> {
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            let mut sessions = Vec::new();
            let mut places = Vec::new();
            for (index, hit) in hits.iter().enumerate() {
                match &hit.target {
                    Target::Session(_) if sessions.len() < 8 => sessions.push(index),
                    Target::NewChat
                    | Target::OpenApp { .. }
                    | Target::Navigate(_)
                    | Target::Settings => places.push(index),
                    _ => {}
                }
            }
            sessions.extend(places);
            return sessions;
        }
        let mut found = hits
            .iter()
            .enumerate()
            .filter(|(_, hit)| hit.label.to_lowercase().contains(&query))
            .map(|(index, _)| index)
            .collect::<Vec<_>>();
        found.sort_by_key(|index| rank(&hits[*index].label, &query));
        found.truncate(24);
        found
    }

    fn finish(&self, target: Option<Target>, window: &mut Window, cx: &mut App) {
        let owner = self.owner.clone();
        window.defer(cx, move |window, cx| {
            let _ = owner.update(cx, |this, cx| {
                this.spotlight = None;
                this.spotlight_query.clear();
                if let Some(target) = target {
                    this.activate_spotlight(target, window, cx);
                }
                cx.notify();
            });
        });
    }
}

fn rank(label: &str, query: &str) -> (u8, usize) {
    let label = label.to_lowercase();
    let band = if label == query {
        0
    } else if label.starts_with(query) {
        1
    } else {
        2
    };
    (band, label.len())
}

impl ListDelegate for Spotlight {
    type Item = ListItem;

    fn items_count(&self, _: usize, _: &App) -> usize {
        self.filtered.len()
    }

    fn render_item(
        &mut self,
        ix: IndexPath,
        _: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Option<Self::Item> {
        let hit = self.filtered.get(ix.row).map(|index| &self.hits[*index])?;
        let appearance = pero_theme::UiAppearance::global(cx);
        let text = appearance.palette.text;
        let muted = appearance.palette.text_muted;
        Some(ListItem::new(ix.row).child(
            div()
                .w_full()
                .flex()
                .items_center()
                .gap(px(8.))
                .text_size(appearance.text(pero_theme::TextRole::Body))
                .child(
                    svg()
                        .path(SharedString::from(format!("icons/{}.svg", hit.icon)))
                        .size(px(16.))
                        .flex_shrink_0()
                        .text_color(text),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .overflow_hidden()
                        .text_ellipsis()
                        .text_color(text)
                        .child(hit.label.clone()),
                )
                .child(
                    div()
                        .flex_shrink_0()
                        .text_size(appearance.text(pero_theme::TextRole::Caption))
                        .text_color(muted)
                        .child(hit.hint.clone()),
                ),
        ))
    }

    fn render_empty(&mut self, _: &mut Window, cx: &mut Context<ListState<Self>>) -> impl IntoElement {
        let appearance = pero_theme::UiAppearance::global(cx);
        let label = self
            .owner
            .upgrade()
            .map(|owner| owner.read(cx).t("spotlight.empty").to_string())
            .unwrap_or_default();
        div()
            .px(px(16.))
            .py(px(12.))
            .text_size(appearance.text(pero_theme::TextRole::Body))
            .text_color(appearance.palette.text_muted)
            .child(label)
    }

    fn perform_search(
        &mut self,
        query: &str,
        _: &mut Window,
        cx: &mut Context<ListState<Self>>,
    ) -> Task<()> {
        self.filtered = Self::matching(&self.hits, query);
        let owner = self.owner.clone();
        let recorded = query.trim().to_string();
        let _ = owner.update(cx, |this, cx| {
            this.spotlight_query = recorded;
            cx.notify();
        });
        cx.notify();
        Task::ready(())
    }

    fn set_selected_index(
        &mut self,
        ix: Option<IndexPath>,
        _: &mut Window,
        _: &mut Context<ListState<Self>>,
    ) {
        self.selected = ix.and_then(|ix| self.filtered.get(ix.row).copied());
    }

    fn confirm(&mut self, _: bool, window: &mut Window, cx: &mut Context<ListState<Self>>) {
        let target = self
            .selected
            .and_then(|index| self.hits.get(index))
            .map(|hit| hit.target.clone());
        if target.is_some() {
            self.finish(target, window, cx);
        }
    }

    fn cancel(&mut self, window: &mut Window, cx: &mut Context<ListState<Self>>) {
        self.finish(None, window, cx);
    }
}

impl Workbench {
    pub(crate) fn toggle_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.spotlight.is_some() {
            self.spotlight = None;
            self.spotlight_query.clear();
            cx.notify();
            return;
        }
        self.open_spotlight(window, cx);
    }

    pub(crate) fn open_spotlight(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if window.has_active_dialog(cx) {
            return;
        }
        let hits = Spotlight::collect(self, cx);
        let filtered = Spotlight::matching(&hits, "");
        let delegate = Spotlight {
            owner: cx.entity().downgrade(),
            hits,
            filtered,
            selected: None,
        };
        let list = cx.new(|cx| ListState::new(delegate, window, cx).searchable(true));
        self.spotlight = Some(list.clone());
        self.spotlight_query.clear();
        window.defer(cx, move |window, cx| {
            list.update(cx, |list, cx| {
                if list.delegate().items_count(0, cx) > 0 {
                    list.set_selected_index(Some(IndexPath::default()), window, cx);
                }
                list.focus(window, cx);
            });
        });
        cx.notify();
    }

    pub(crate) fn spotlight_overlay(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(list) = self.spotlight.clone() else {
            return div().into_any_element();
        };
        let appearance = pero_theme::UiAppearance::global(cx);
        let p = appearance.palette.clone();
        let placeholder = self.t("spotlight.placeholder").to_string();
        div()
            .id("spotlight")
            .absolute()
            .inset_0()
            .flex()
            .justify_center()
            .pt(px(64.))
            .px(px(16.))
            .bg(cx.theme().overlay)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    this.spotlight = None;
                    this.spotlight_query.clear();
                    cx.notify();
                }),
            )
            .child(
                div()
                    .w(px(560.))
                    .max_w_full()
                    .h(px(420.))
                    .flex_shrink_0()
                    .rounded(px(pero_theme::RADIUS_PANEL))
                    .border_1()
                    .border_color(p.border)
                    .bg(p.surface)
                    .overflow_hidden()
                    .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                    .child(
                        List::new(&list)
                            .size_full()
                            .search_placeholder(placeholder),
                    ),
            )
            .into_any_element()
    }

    fn activate_spotlight(&mut self, target: Target, window: &mut Window, cx: &mut Context<Self>) {
        self.chat
            .update(cx, |panel, _| panel.deleting_chat = None);
        match target {
            Target::NewChat => {
                self.new_chat(cx);
                let composer = self.chat.read(cx).composer.clone();
                composer.update(cx, |input, cx| input.focus(window, cx));
            }
            Target::OpenApp { name, panel } => {
                self.pending_app = Some((name.to_string(), panel.to_string()));
                self.refresh_apps(cx);
                self.open_app(name.to_string(), panel.to_string(), cx);
            }
            Target::Navigate(page) => {
                self.navigate(page, cx);
                self.sync_follow(cx);
                if page == WorkbenchPage::Apps {
                    self.refresh_apps(cx);
                }
            }
            Target::Settings => self.open_settings(window, cx),
            Target::Project(key) => self.open_project(key, window, cx),
            Target::Session(index) => self.focus_chat(Some(index), ConversationTab::Chat, cx),
            Target::Task(id) => self.open_task(id, cx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Hit, Spotlight, Target, rank};

    fn hit(label: &str, target: Target) -> Hit {
        Hit {
            label: label.into(),
            hint: String::new(),
            icon: "folder",
            target,
        }
    }

    #[test]
    fn empty_query_lists_recent_sessions_before_places() {
        let hits = vec![
            hit("older", Target::Session(0)),
            hit("newer", Target::Session(1)),
            hit("New chat", Target::NewChat),
            hit("point", Target::Project("shared:point".into())),
        ];
        let shown = Spotlight::matching(&hits, "")
            .into_iter()
            .map(|index| hits[index].label.as_str())
            .collect::<Vec<_>>();
        assert_eq!(shown, ["older", "newer", "New chat"]);
    }

    #[test]
    fn query_prefers_the_exact_name() {
        let hits = vec![
            hit("point release", Target::Session(0)),
            hit("point", Target::Project("shared:point".into())),
            hit("appointment", Target::Task("task".into())),
        ];
        let shown = Spotlight::matching(&hits, "point")
            .into_iter()
            .map(|index| hits[index].label.as_str())
            .collect::<Vec<_>>();
        assert_eq!(shown, ["point", "point release", "appointment"]);
        assert_eq!(rank("point", "point").0, 0);
    }
}
