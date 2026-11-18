//! Conversation recovery with a catalog and Host-ordered body responses.
use crate::{panel::ChatPanel, session_state::SessionState};
use gpui_kit::*;
use pero_contracts::{HostCommand, HostEvent, session_history::ThreadHistory};

#[derive(Clone, Default)]
pub(crate) enum HistoryLoad {
    #[default]
    Complete,
    Deferred,
    Pending(String),
    Failed,
}

impl HistoryLoad {
    pub(crate) fn complete(&self) -> bool {
        matches!(self, Self::Complete)
    }
}

impl ChatPanel {
    pub(crate) fn load_thread_history(&mut self, index: usize, cx: &mut Context<Self>) {
        if !self.connected || !matches!(self.chats[index].history, HistoryLoad::Deferred) {
            return;
        }
        self.next_request += 1;
        let request_id = format!("thread-history-{}", self.next_request);
        let thread_id = self.chats[index].id.clone();
        self.chats[index].history = HistoryLoad::Pending(request_id.clone());
        cx.emit(crate::ChatAction::Command(HostCommand::LoadThreadHistory { thread_id, request_id }));
    }

    pub(crate) fn retry_thread_history(&mut self, cx: &mut Context<Self>) {
        if let Some(index) = self.active_chat {
            self.chats[index].history = HistoryLoad::Deferred;
            self.load_thread_history(index, cx);
            cx.notify();
        }
    }

    pub(crate) fn receive_thread_history(&mut self, event: &HostEvent, cx: &mut Context<Self>) {
        let Some(index) = self.chats.iter().position(|chat| {
            Some(&chat.id) == event.thread_id.as_ref()
                && matches!(&chat.history, HistoryLoad::Pending(id) if Some(id) == event.request_id.as_ref())
        }) else { return; };
        let body = match serde_json::from_value::<ThreadHistory>(event.data.clone()) {
            Ok(body) if !body.events.is_empty() => body,
            _ => {
                self.chats[index].history = HistoryLoad::Failed;
                cx.notify();
                return;
            }
        };
        let previous_notice = self.chats[index].notice;
        self.chats[index].history = HistoryLoad::Complete;
        for replayed in body.events {
            self.receive_chat(&replayed, cx);
        }
        let chat = &mut self.chats[index];
        chat.notice = previous_notice;
        if !body.active {
            chat.state = SessionState::Closed;
            chat.permission = None;
            chat.user_questions.clear();
            chat.pending_model = None;
            chat.pending_setting = None;
            chat.flush(cx);
        }
        self.sync_follow(cx);
        cx.notify();
    }
}
