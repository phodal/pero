//! A new chat waits for the Host to acknowledge its selected workspace.
use pero_contracts::{HostEvent, workspace_path::WorkspacePath};

#[derive(Default)]
pub(crate) struct PendingSessionWorkspace(Option<String>);

impl PendingSessionWorkspace {
    pub fn request(&mut self, workspace: String) {
        self.0 = Some(workspace);
    }
    pub fn clear(&mut self) {
        self.0 = None;
    }

    /// A matching receipt consumes the intent once. Other workspace receipts
    /// cancel it, preserving the existing newer-navigation behavior.
    pub fn receive(&mut self, event: &HostEvent) -> bool {
        match event.kind.as_str() {
            "error" | "disconnected" => {
                self.clear();
                false
            }
            "workspace" => self
                .0
                .take()
                .is_some_and(|expected| WorkspacePath(&expected).matches(&event.text)),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_chat_requires_one_matching_workspace_receipt() {
        for (events, chats) in [
            (
                vec![
                    ("workspace", r"C:\work\pero"),
                    ("workspace", r"C:\work\pero"),
                ],
                1,
            ),
            (vec![("agents", ""), ("workspace", r"C:\work\pero")], 1),
            (
                vec![("workspace", r"D:\other"), ("workspace", r"C:\work\pero")],
                0,
            ),
            (
                vec![("error", "unavailable"), ("workspace", r"C:\work\pero")],
                0,
            ),
            (
                vec![("disconnected", ""), ("workspace", r"C:\work\pero")],
                0,
            ),
        ] {
            let mut pending = PendingSessionWorkspace::default();
            pending.request(r"\\?\C:\work\pero".into());
            let created = events
                .into_iter()
                .filter(|(kind, text)| pending.receive(&HostEvent::new(kind, None, (*text).into())))
                .count();
            assert_eq!(created, chats);
        }
        let mut pending = PendingSessionWorkspace::default();
        pending.request(r"\\?\C:\old".into());
        pending.request(r"\\?\C:\new".into());
        assert!(pending.receive(&HostEvent::new("workspace", None, r"C:\new".into())));
        pending.request(r"\\?\C:\new".into());
        pending.clear();
        assert!(!pending.receive(&HostEvent::new("workspace", None, r"C:\new".into())));
    }
}
