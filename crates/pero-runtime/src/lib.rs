pub mod acp;
pub mod context;
pub mod file_documents;
pub mod roadmap;
pub mod apps;
pub mod contribution;
pub mod contribution_git;
pub mod settings;
pub mod workspace_lease;
pub mod local_worker;

use pero_contracts::{EchoRequest, HostEvent, MAX_TEXT_CHARS};

/// Bootstrap transport probe; this does not execute an Agent or create a task.
pub fn echo(request: EchoRequest) -> HostEvent {
    if request.id.is_empty()
        || request.id.len() > 128
        || request.text.trim().is_empty()
        || request.text.chars().count() > MAX_TEXT_CHARS
    {
        return HostEvent::message("error", Some(request.id), "error.input_length");
    }
    HostEvent::new("echo", Some(request.id), request.text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_unicode_and_request_identity() {
        let event = echo(EchoRequest {
            id: "probe-1".into(),
            text: "你好，Pero 🐈".into(),
        });
        assert_eq!(event.kind, "echo");
        assert_eq!(event.text, "你好，Pero 🐈");
        assert_eq!(event.request_id.as_deref(), Some("probe-1"));
    }
    #[test]
    fn rejects_empty_or_oversized_requests() {
        for text in ["  ".into(), "中".repeat(MAX_TEXT_CHARS + 1)] {
            assert_eq!(
                echo(EchoRequest {
                    id: "test".into(),
                    text
                })
                .kind,
                "error"
            );
        }
        assert_eq!(
            echo(EchoRequest {
                id: String::new(),
                text: "你好".into()
            })
            .kind,
            "error"
        );
    }
}
