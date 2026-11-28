//! When the Conversation page must own an active chat.
//!
//! Creating a draft only on a visibility edge misses Sessions: the panel can
//! already be visible on Projects, so opening the page does not transition.
//! The shell applies each signal, then asks [`ConversationTarget::ensure`].

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationTarget {
    pub connected: bool,
    pub replayed: bool,
    pub visible: bool,
    pub project_composer: bool,
    pub conversation_page: bool,
    pub active_chat: bool,
}

impl Default for ConversationTarget {
    fn default() -> Self {
        Self {
            connected: false,
            replayed: false,
            visible: true,
            project_composer: false,
            conversation_page: false,
            active_chat: false,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ConversationSignal {
    Connected(bool),
    Replay,
    Visible(bool),
    ConversationPage(bool),
    ProjectComposer(bool),
    Workspace,
    Agents,
}

impl ConversationTarget {
    pub fn missing(&self) -> bool {
        self.connected
            && self.replayed
            && self.visible
            && !self.project_composer
            && self.conversation_page
            && !self.active_chat
    }

    /// Level trigger shared by visibility, replay, workspace, agents, and the
    /// Workbench follow after the project composer changes.
    pub fn ensure(&mut self) {
        if self.missing() {
            self.active_chat = true;
        }
    }

    pub fn apply(&mut self, signal: ConversationSignal) {
        match signal {
            ConversationSignal::Connected(value) => self.connected = value,
            ConversationSignal::Replay => self.replayed = true,
            ConversationSignal::Visible(value) => self.visible = value,
            ConversationSignal::ConversationPage(value) => self.conversation_page = value,
            ConversationSignal::ProjectComposer(value) => self.project_composer = value,
            ConversationSignal::Workspace | ConversationSignal::Agents => {}
        }
        self.ensure();
    }
}

#[cfg(test)]
mod tests {
    use super::{ConversationSignal::*, ConversationTarget};

    #[test]
    fn conversation_page_owns_one_chat_for_every_signal_order() {
        let cases: &[(&str, &[super::ConversationSignal], bool)] = &[
            (
                "replay before the panel is visible",
                &[
                    Visible(false),
                    Connected(true),
                    ConversationPage(true),
                    Replay,
                ],
                false,
            ),
            (
                "showing the page after replay",
                &[
                    Visible(false),
                    Connected(true),
                    ConversationPage(true),
                    Replay,
                    Visible(true),
                ],
                true,
            ),
            (
                "replay after the conversation page is visible",
                &[
                    Connected(true),
                    Visible(true),
                    ConversationPage(true),
                    Replay,
                ],
                true,
            ),
            (
                "visible already true before Navigate(Conversation)",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ConversationPage(true),
                ],
                true,
            ),
            (
                "project composer blocks an ordinary chat",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ProjectComposer(true),
                    ConversationPage(true),
                ],
                false,
            ),
            (
                "leaving the project composer restores a chat",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ProjectComposer(true),
                    ConversationPage(true),
                    ProjectComposer(false),
                ],
                true,
            ),
            (
                "workspace before replay does not invent a chat",
                &[
                    Connected(true),
                    Visible(true),
                    ConversationPage(true),
                    Workspace,
                ],
                false,
            ),
            (
                "workspace after replay keeps the one chat",
                &[
                    Connected(true),
                    Visible(true),
                    ConversationPage(true),
                    Replay,
                    Workspace,
                ],
                true,
            ),
            (
                "agents before replay does not invent a chat",
                &[
                    Connected(true),
                    Visible(true),
                    ConversationPage(true),
                    Agents,
                ],
                false,
            ),
            (
                "agents after replay keeps the one chat",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ConversationPage(true),
                    Agents,
                ],
                true,
            ),
            (
                "projects page stays empty while the panel is already visible",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ConversationPage(false),
                    Workspace,
                    Agents,
                ],
                false,
            ),
            (
                "a hidden conversation page stays empty",
                &[
                    Visible(false),
                    Connected(true),
                    Replay,
                    ConversationPage(true),
                    Workspace,
                    Agents,
                ],
                false,
            ),
            (
                "disconnected replay does not open a chat",
                &[Replay, Visible(true), ConversationPage(true), Workspace],
                false,
            ),
        ];
        for (name, signals, active) in cases {
            let mut target = ConversationTarget::default();
            for signal in *signals {
                target.apply(*signal);
            }
            assert_eq!(target.active_chat, *active, "{name}");
            if *active {
                target.apply(Workspace);
                target.apply(Agents);
                assert!(target.active_chat, "{name} keeps a single chat");
            }
        }
    }
}
