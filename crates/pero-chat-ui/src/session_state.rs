//! Connection readiness is independent of whether a conversation has been submitted.
use serde::Serialize;

/// Presentation priority derived from the existing execution owners.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionListStatus {
    Quiet,
    Preparing,
    Running,
    NeedsInput,
    Failed,
    Authentication,
}
impl SessionListStatus {
    pub fn of(state: SessionState, pending_input: bool, error: bool) -> Self {
        if pending_input {
            Self::NeedsInput
        } else if state == SessionState::AuthRequired {
            Self::Authentication
        } else if error {
            Self::Failed
        } else if state == SessionState::AwaitingApp {
            Self::Preparing
        } else if state.busy() {
            Self::Running
        } else {
            Self::Quiet
        }
    }
}

/// Window-local unread activity, independent of unresolved domain state.
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct SessionNotice {
    pub unread: bool,
}
impl SessionNotice {
    pub fn read(&mut self) {
        self.unread = false;
    }
    pub fn observe(&mut self, kind: &str, visible: bool) {
        if matches!(
            kind,
            "turn_finished"
                | "permission"
                | "user_questions"
                | "session_error"
                | "session_auth_required"
                | "session_auth_error"
        ) {
            self.unread = !visible;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Draft,
    AwaitingApp,
    Connecting,
    Idle,
    Running,
    Stopping,
    AuthRequired,
    Closed,
}

impl SessionState {
    pub fn app_available(self) -> Self {
        if self == Self::AwaitingApp {
            Self::Draft
        } else {
            self
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::AwaitingApp => "awaiting_app",
            Self::Connecting => "connecting",
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Stopping => "stopping",
            Self::AuthRequired => "auth_required",
            Self::Closed => "closed",
        }
    }

    pub fn busy(self) -> bool {
        matches!(self, Self::Connecting | Self::Running | Self::Stopping)
    }

    pub fn can_submit(self) -> bool {
        matches!(
            self,
            Self::Draft | Self::AwaitingApp | Self::Connecting | Self::Idle
        )
    }

    pub fn can_retarget(self, has_messages: bool, has_queued_prompt: bool) -> bool {
        !has_messages && !has_queued_prompt && !matches!(self, Self::Running | Self::Stopping)
    }
}

#[cfg(test)]
mod tests {
    use super::SessionState::*;

    #[test]
    fn reading_activity_does_not_resolve_pending_work() {
        use super::{SessionListStatus as S, SessionNotice};
        for (state, pending, error, status) in [
            (Running, true, false, S::NeedsInput),
            (Running, false, false, S::Running),
            (AuthRequired, false, true, S::Authentication),
            (Idle, false, true, S::Failed),
            (Closed, false, false, S::Quiet),
        ] {
            let mut notice = SessionNotice::default();
            notice.observe("permission", false);
            assert!(notice.unread);
            notice.read();
            assert!(!notice.unread);
            assert_eq!(S::of(state, pending, error), status);
            notice.observe("turn_finished", false);
            assert!(notice.unread, "new activity after reading is unread");
            notice.observe("turn_finished", true);
            assert!(!notice.unread, "visible activity is already seen");
            notice.observe("session_usage", false);
            assert!(!notice.unread, "routine metadata does not notify");
        }
    }

    #[test]
    fn app_completion_only_resumes_preparation() {
        for (state, next) in [
            (AwaitingApp, Draft),
            (Running, Running),
            (Closed, Closed),
            (AuthRequired, AuthRequired),
        ] {
            assert_eq!(state.app_available(), next);
        }
        assert!(
            !AwaitingApp.busy(),
            "waiting for installation is not running a task"
        );
        assert_eq!(
            super::SessionListStatus::of(AwaitingApp, false, false),
            super::SessionListStatus::Preparing
        );
    }

    #[test]
    fn readiness_and_conversation_binding() {
        for (state, messages, queued, submit, retarget) in [
            (Draft, false, false, true, true),
            (AwaitingApp, false, false, true, true),
            (AwaitingApp, false, true, true, false),
            (Connecting, false, false, true, true),
            (Connecting, false, true, true, false),
            (Idle, false, false, true, true),
            (Idle, true, false, true, false),
            (Running, false, false, false, false),
            (Stopping, false, false, false, false),
            (AuthRequired, false, false, false, true),
            (Closed, false, false, false, true),
            (Closed, true, false, false, false),
        ] {
            assert_eq!(state.can_submit(), submit, "{state:?}");
            assert_eq!(state.can_retarget(messages, queued), retarget, "{state:?}");
        }
    }
}
