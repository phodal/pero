//! The panel borrows a specific selected Host conversation and incarnation.
#[cfg(any(target_family = "wasm", feature = "native"))]
use crate::{panel::ChatPanel, theme::WorkbenchStyle as W};
#[cfg(any(target_family = "wasm", feature = "native"))]
use gpui_kit::{
    component::{button::*, *},
    prelude::*,
    *,
};
#[cfg(any(target_family = "wasm", feature = "native"))]
use pero_contracts::team_board::TeamTaskStatus;
use pero_contracts::{HostEvent, team_board::TeamBoard};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Clone, Default)]
pub(crate) struct TeamPanel {
    pub incarnation: Option<u64>,
    pub open: bool,
    pending: Option<String>,
    snapshot: Option<TeamBoard>,
    failed: bool,
}

impl TeamPanel {
    pub fn connect(&mut self, incarnation: Option<u64>) {
        if self.incarnation != incarnation {
            *self = Self {
                incarnation,
                ..Self::default()
            };
        }
    }

    pub fn dismiss(&mut self) {
        self.open = false;
        self.pending = None;
    }

    pub fn changed(&mut self) {
        self.dismiss();
        self.snapshot = None;
        self.failed = false;
    }

    fn begin(&mut self) -> Option<(u64, String)> {
        let incarnation = self.incarnation?;
        if !self.open || self.pending.is_some() {
            return None;
        }
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let id = format!("team-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        self.pending = Some(id.clone());
        self.failed = false;
        Some((incarnation, id))
    }

    pub fn receive(&mut self, event: &HostEvent) {
        if !self.open
            || self.pending.is_none()
            || event.request_id != self.pending
            || event.data["incarnation"].as_u64() != self.incarnation
        {
            return;
        }
        self.pending = None;
        if event.kind == "team_board"
            && let Ok(next) = serde_json::from_value::<TeamBoard>(event.data["board"].clone())
        {
            self.snapshot = Some(next);
        } else {
            self.failed = true;
        }
    }
}

#[cfg(any(target_family = "wasm", feature = "native"))]
impl ChatPanel {
    fn refresh_team(&mut self, cx: &mut Context<Self>) {
        let Some(chat) = self.active_chat.and_then(|i| self.chats.get_mut(i)) else {
            return;
        };
        if let Some((incarnation, request_id)) = chat.team.begin() {
            let thread_id = chat.id.clone();
            self.command(json!({"action":"read_team_board","thread_id":thread_id,"incarnation":incarnation,"request_id":request_id}), cx);
        }
    }

    pub(crate) fn team_button(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let chat = self.active_chat.and_then(|i| self.chats.get(i))?;
        if !self.connected || chat.team.incarnation.is_none() {
            return None;
        }
        Some(
            W::composer_control(Button::new("team-board-toggle").ghost(), cx)
                .label(self.t("chat.team_board"))
                .on_click(cx.listener(|this, _, _, cx| {
                    if let Some(chat) = this.active_chat.and_then(|i| this.chats.get_mut(i)) {
                        if chat.team.open {
                            chat.team.dismiss();
                        } else {
                            chat.team.open = true;
                            this.refresh_team(cx);
                        }
                        cx.notify();
                    }
                }))
                .into_any_element(),
        )
    }

    pub(crate) fn team_panel(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let team = &self.active_chat.and_then(|i| self.chats.get(i))?.team;
        if !self.connected || !team.open || team.incarnation.is_none() {
            return None;
        }
        let p = pero_theme::Chrome::from_app(cx);
        let caption = pero_theme::UiAppearance::global(cx).text(pero_theme::TextRole::Caption);
        let status = if team.failed {
            Some("chat.team_unavailable")
        } else if team.pending.is_some() {
            Some("chat.panel_loading")
        } else if team.snapshot.as_ref().is_some_and(|board| !board.enabled) {
            Some("chat.team_off")
        } else if team
            .snapshot
            .as_ref()
            .is_some_and(|board| board.tasks.is_empty())
        {
            Some("chat.team_empty")
        } else {
            None
        };
        Some(
            div()
                .id("team-board")
                .w_full()
                .max_w(px(pero_theme::COMPOSER_MAX))
                .mx_auto()
                .p(px(pero_theme::SPACE_8))
                .rounded(px(6.))
                .border_1()
                .border_color(p.palette.border)
                .flex()
                .flex_col()
                .gap(px(pero_theme::SPACE_4))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .font_weight(FontWeight::MEDIUM)
                                .child(self.t("chat.team_board")),
                        )
                        .child(
                            W::composer_control(Button::new("team-board-refresh").ghost(), cx)
                                .label(self.t("chat.team_refresh"))
                                .disabled(team.pending.is_some())
                                .on_click(cx.listener(|this, _, _, cx| this.refresh_team(cx))),
                        ),
                )
                .when_some(status, |panel, key| {
                    panel.child(
                        div()
                            .text_size(caption)
                            .text_color(p.palette.text_muted)
                            .child(self.t(key)),
                    )
                })
                .children(
                    team.snapshot
                        .as_ref()
                        .filter(|board| board.enabled && !board.tasks.is_empty())
                        .map(|board| {
                            div()
                                .id("team-board-tasks")
                                .max_h(px(170.))
                                .overflow_y_scroll()
                                .children(board.tasks.iter().map(|task| {
                                    let label = match task.status {
                                        TeamTaskStatus::Pending if task.ready => "chat.team_ready",
                                        TeamTaskStatus::Pending => "chat.team_pending",
                                        TeamTaskStatus::InProgress => "chat.team_running",
                                        TeamTaskStatus::Completed => "chat.team_completed",
                                    };
                                    div()
                                        .flex()
                                        .items_start()
                                        .justify_between()
                                        .gap(px(pero_theme::SPACE_8))
                                        .border_b_1()
                                        .border_color(p.palette.border)
                                        .py(px(pero_theme::SPACE_4))
                                        .child(
                                            div()
                                                .min_w_0()
                                                .child(format!("#{} {}", task.id, task.subject)),
                                        )
                                        .child(
                                            div()
                                                .flex_shrink_0()
                                                .text_size(caption)
                                                .text_color(p.palette.text_muted)
                                                .child(self.t(label)),
                                        )
                                }))
                        }),
                )
                .into_any_element(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_requests_cannot_show_after_switch_or_reconnect() {
        let mut panel = TeamPanel::default();
        panel.connect(Some(3));
        panel.open = true;
        let (_, old) = panel.begin().unwrap();
        panel.dismiss();
        panel.open = true;
        let (_, after_switch) = panel.begin().unwrap();
        let mut other = TeamPanel::default();
        other.connect(Some(5));
        other.open = true;
        let (_, other_request) = other.begin().unwrap();
        let reply = |request_id, incarnation, subject: &str| {
            let mut event = HostEvent::new("team_board", Some(request_id), String::new());
            event.data = json!({
                "incarnation": incarnation,
                "board": {"revision": 1, "enabled": true, "tasks": [
                    {"id": "1", "subject": subject, "revision": 1, "status": "pending", "ready": true}
                ]}
            });
            event
        };
        let delayed = reply(old, 3, "Original");
        other.receive(&delayed);
        assert!(other.snapshot.is_none());
        other.receive(&reply(other_request, 5, "Other conversation"));
        assert_eq!(
            other.snapshot.as_ref().unwrap().tasks[0].subject,
            "Other conversation"
        );
        panel.receive(&delayed);
        assert!(panel.snapshot.is_none());
        panel.connect(Some(4));
        panel.open = true;
        let (_, current) = panel.begin().unwrap();
        panel.receive(&reply(after_switch, 3, "Original"));
        panel.receive(&reply(current.clone(), 3, "Original"));
        assert!(panel.snapshot.is_none());
        panel.receive(&reply(current, 4, "Refreshed original"));
        assert_eq!(
            panel.snapshot.as_ref().unwrap().tasks[0].subject,
            "Refreshed original"
        );
        panel.changed();
        assert!(!panel.open);
        assert!(panel.snapshot.is_none());
    }
}
