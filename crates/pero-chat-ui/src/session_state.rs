//! Connection readiness is independent of whether a conversation has been submitted.
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SessionState {
    Draft,
    Connecting,
    Idle,
    Running,
    Stopping,
    AuthRequired,
    Closed,
}

impl SessionState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
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
        matches!(self, Self::Draft | Self::Connecting | Self::Idle)
    }

    pub fn can_retarget(self, has_messages: bool, has_queued_prompt: bool) -> bool {
        !has_messages && !has_queued_prompt && !matches!(self, Self::Running | Self::Stopping)
    }
}

#[cfg(test)]
mod tests {
    use super::SessionState::*;

    #[test]
    fn readiness_and_conversation_binding() {
        for (state, messages, queued, submit, retarget) in [
            (Draft, false, false, true, true),
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
