//! A repository's pull requests open the existing pull request page.
use crate::{app::Workbench, remote::string};
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
use pero_contracts::pull_request::{
    PullRequestList, PullRequestListState, PullRequestRef, PullRequestStatus, PullRequestSummary,
    RepositoryName, opened_ago, opened_day, present_statuses,
};
use serde_json::json;

#[derive(Default)]
pub(crate) struct PullRequestIndex {
    pub repository: String,
    pub state: PullRequestListState,
    pub items: Vec<PullRequestSummary>,
    pub pending: Option<String>,
    pub error: Option<String>,
}

impl Workbench {
    pub(crate) fn request_pull_request_list(
        &mut self,
        repository: &str,
        state: PullRequestListState,
        cx: &mut Context<Self>,
    ) {
        let Some(repository) = RepositoryName::parse(repository) else {
            return;
        };
        self.next_request += 1;
        let request_id = format!("pr-list-{}", self.next_request);
        self.pull_request_index.repository = repository.slug().to_owned();
        self.pull_request_index.state = state;
        self.pull_request_index.pending = Some(request_id.clone());
        self.pull_request_index.error = None;
        self.command(
            json!({
                "method": "pull_requests",
                "action": "list",
                "request_id": request_id,
                "repository": repository.slug(),
                "state": state,
            }),
            cx,
        );
    }

    pub(crate) fn receive_pull_request_list(&mut self, event: &pero_contracts::HostEvent, cx: &mut Context<Self>) -> bool {
        if event.kind == "pull_request_error"
            && self.pull_request_index.pending.as_deref() == event.request_id.as_deref()
        {
            self.pull_request_index.pending = None;
            self.pull_request_index.error = Some(event.text.clone());
            cx.notify();
            return true;
        }
        if event.kind != "pull_request_listed"
            || self.pull_request_index.pending.as_deref() != event.request_id.as_deref()
        {
            return false;
        }
        match serde_json::from_value::<PullRequestList>(event.data.clone()) {
            Ok(list) => {
                self.pull_request_index.repository = list.repository.slug().to_owned();
                self.pull_request_index.state = list.state;
                self.pull_request_index.items = list.items.clone();
                self.pull_request_index.pending = None;
                self.pull_request_index.error = None;
                for item in list.items {
                    self.chat
                        .update(cx, |chat, _| chat.note_pull_request(item));
                }
            }
            Err(error) => {
                self.pull_request_index.pending = None;
                self.pull_request_index.error = Some(error.to_string());
            }
        }
        cx.notify();
        true
    }

    pub(crate) fn listed_repositories(&self, cx: &App) -> Vec<String> {
        let mut names = Vec::new();
        for repo in &self.workspace_repositories {
            if repo.workspace == self.workspace && repo.repository.host == "github.com" {
                let name = format!("{}/{}", repo.repository.owner, repo.repository.name);
                if let Some(parsed) = RepositoryName::parse(&name) {
                    let slug = parsed.slug().to_owned();
                    if !names.contains(&slug) {
                        names.push(slug);
                    }
                }
            }
        }
        let project = self.current_project(cx);
        for repo in self.remote.repositories() {
            if project
                .as_ref()
                .is_some_and(|project| !project.contains_task(string(repo, "project_id")))
            {
                continue;
            }
            let owner = string(repo, "owner");
            let name = string(repo, "repo");
            if owner.is_empty() || name.is_empty() {
                continue;
            }
            let slug = format!("{owner}/{name}");
            if RepositoryName::parse(&slug).is_some() && !names.contains(&slug) {
                names.push(slug);
            }
        }
        names
    }

    pub(crate) fn pull_request_index(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = &pero_theme::UiAppearance::global(cx).palette.clone();
        let repositories = self.listed_repositories(cx);
        let selected = if repositories.iter().any(|name| name == &self.pull_request_index.repository)
        {
            self.pull_request_index.repository.clone()
        } else {
            repositories.first().cloned().unwrap_or_default()
        };
        let state = self.pull_request_index.state;
        let mut column = div()
            .mt(px(pero_theme::WorkbenchStyle::SECTION))
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(
                div()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.t("pr.list")),
            );
        if repositories.is_empty() {
            return column
                .child(
                    div()
                        .text_color(p.text_muted)
                        .child(self.t("pr.list_empty")),
                )
                .into_any_element();
        }
        if repositories.len() > 1 {
            column = column.child(div().flex().flex_wrap().gap(px(4.)).children(
                repositories.iter().enumerate().map(|(index, name)| {
                    let name = name.clone();
                    let chosen = name.clone();
                    Button::new(("pr-repo", index))
                        .ghost()
                        .small()
                        .label(name)
                        .selected(chosen == selected)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request_pull_request_list(&chosen, this.pull_request_index.state, cx);
                        }))
                }),
            ));
        }
        column = column.child(div().flex().flex_wrap().gap(px(4.)).children(
            [PullRequestListState::Open, PullRequestListState::Closed, PullRequestListState::All]
                .into_iter()
                .enumerate()
                .map(|(index, filter)| {
                    let repository = selected.clone();
                    Button::new(("pr-filter", index))
                        .ghost()
                        .small()
                        .label(self.t(filter.key()))
                        .selected(state == filter)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request_pull_request_list(&repository, filter, cx);
                        }))
                }),
        ));
        if self.pull_request_index.pending.is_some() {
            column = column.child(div().text_color(p.text_muted).child(self.t("pr.loading")));
        }
        if let Some(error) = &self.pull_request_index.error {
            let _ = error;
            column = column.child(div().text_color(p.error).child(self.t("pr.list_failed")));
        }
        if self.pull_request_index.pending.is_none()
            && self.pull_request_index.error.is_none()
            && self.pull_request_index.items.is_empty()
            && self
                .pull_request_index
                .repository
                .eq_ignore_ascii_case(&selected)
            && !selected.is_empty()
        {
            column = column.child(
                div()
                    .text_color(p.text_muted)
                    .child(self.t("pr.list_empty")),
            );
        }
        let rows: Vec<ListedRow> = self
            .pull_request_index
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.reference.repository().eq_ignore_ascii_case(&selected))
            .map(|(index, item)| ListedRow {
                index,
                reference: item.reference.clone(),
                status: item.status,
                title: item.title.clone(),
                number: item.label(),
                author: item.author.clone(),
                additions: item.additions,
                deletions: item.deletions,
                opened_at: item.opened_at.clone(),
            })
            .collect();
        let groups = present_statuses(rows.iter().map(|row| row.status));
        let headed = groups.len() > 1;
        for status in groups {
            if headed {
                column = column.child(div().text_color(p.text_muted).child(self.t(status.key())));
            }
            for row in rows.iter().filter(|row| row.status == status) {
                let reference = row.reference.clone();
                let status_label = self.t(row.status.key()).to_owned();
                let opened = opened_phrase(&row.opened_at, |key| self.t(key));
                let tooltip = [
                    row.title.clone(),
                    row.number.clone(),
                    status_label,
                    row.author.clone(),
                ]
                .into_iter()
                .chain(opened.clone())
                .collect::<Vec<_>>()
                .join("\n");
                column = column.child(
                    Button::new(("pr-row", row.index))
                        .ghost()
                        .small()
                        .w_full()
                        .justify_start()
                        .tooltip(tooltip)
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.open_pull_request(reference.clone(), window, cx);
                        }))
                        .child(status_mark(row.status, cx))
                        .child(row.number.clone())
                        .child(
                            div()
                                .flex_1()
                                .text_left()
                                .overflow_hidden()
                                .child(row.title.clone()),
                        )
                        .child(format!("+{} −{}", row.additions, row.deletions))
                        .children(opened),
                );
            }
        }
        column.into_any_element()
    }
}

struct ListedRow {
    index: usize,
    reference: PullRequestRef,
    status: PullRequestStatus,
    title: String,
    number: String,
    author: String,
    additions: u64,
    deletions: u64,
    opened_at: String,
}

fn opened_phrase(opened_at: &str, label: impl Fn(&str) -> &'static str) -> Option<String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs() as i64;
    if let Some(age) = opened_ago(opened_at, now) {
        if age.count == 0 {
            return Some(label("pr.just_now").to_owned());
        }
        return Some(format!(
            "{} {} {}",
            label("pr.opened"),
            age.count,
            label(age.unit.key())
        ));
    }
    opened_day(opened_at).map(|day| format!("{} {day}", label("pr.opened")))
}

fn status_mark(status: PullRequestStatus, cx: &App) -> AnyElement {
    let p = &pero_theme::UiAppearance::global(cx).palette;
    let color = match status {
        PullRequestStatus::Merged => p.info,
        PullRequestStatus::Open => p.success,
        PullRequestStatus::Closed => p.error,
        PullRequestStatus::Draft => p.text_muted,
    };
    div()
        .size(px(8.))
        .rounded_full()
        .bg(color)
        .into_any_element()
}
