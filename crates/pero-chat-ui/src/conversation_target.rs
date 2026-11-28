//! When the Conversation page must own an active chat.
//!
//! [`ConversationTarget::missing`] is the only automatic-draft decision.
//! `ChatPanel::ensure_conversation_target` restores a scope chat exactly when
//! it is true. Replay and visibility do not create a draft on their own.

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ConversationTarget {
    pub connected: bool,
    pub replayed: bool,
    pub visible: bool,
    pub project_composer: bool,
    pub conversation_page: bool,
    pub active_chat: bool,
    /// The user removed the active chat. Opening Sessions again clears this.
    pub hold_empty: bool,
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
            hold_empty: false,
        }
    }
}

impl ConversationTarget {
    /// Entering the Conversation page from another page may own a chat again.
    pub fn set_page(&mut self, conversation_page: bool) {
        if conversation_page && !self.conversation_page {
            self.hold_empty = false;
        }
        self.conversation_page = conversation_page;
    }

    /// The active chat was removed. Do not immediately open a replacement.
    pub fn note_active_removed(&mut self) {
        self.active_chat = false;
        self.hold_empty = true;
    }

    pub fn missing(&self) -> bool {
        !self.hold_empty
            && self.connected
            && self.replayed
            && self.visible
            && !self.project_composer
            && self.conversation_page
            && !self.active_chat
    }
}

#[cfg(test)]
mod tests {
    use super::ConversationTarget;

    #[derive(Clone, Copy)]
    enum Signal {
        Connected(bool),
        Replay,
        Visible(bool),
        ConversationPage(bool),
        ProjectComposer(bool),
        Workspace,
        Agents,
        ReleaseActive,
    }

    fn drive(signals: &[Signal]) -> ConversationTarget {
        let mut target = ConversationTarget::default();
        for signal in signals {
            match signal {
                Signal::Connected(value) => target.connected = *value,
                Signal::Replay => target.replayed = true,
                Signal::Visible(value) => target.visible = *value,
                Signal::ConversationPage(value) => target.set_page(*value),
                Signal::ProjectComposer(value) => target.project_composer = *value,
                Signal::Workspace | Signal::Agents => {}
                Signal::ReleaseActive => target.note_active_removed(),
            }
        }
        target
    }

    #[test]
    fn conversation_page_owns_one_chat_for_every_signal_order() {
        use Signal::*;
        let cases: &[(&str, &[Signal], bool)] = &[
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
            (
                "closing the last chat does not open a replacement",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ConversationPage(true),
                    ReleaseActive,
                ],
                false,
            ),
            (
                "opening Sessions again after that close does",
                &[
                    Connected(true),
                    Replay,
                    Visible(true),
                    ConversationPage(true),
                    ReleaseActive,
                    ConversationPage(false),
                    ConversationPage(true),
                ],
                true,
            ),
        ];
        for (name, signals, restore) in cases {
            assert_eq!(drive(signals).missing(), *restore, "{name}");
        }
    }
}
