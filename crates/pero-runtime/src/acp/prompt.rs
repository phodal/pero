//! Converts frozen context into the content types advertised by an ACP Agent.
use agent_client_protocol::schema::v1::*;
use pero_contracts::context::{ContextContent, ContextReference};
use pero_contracts::project_agent::prompt::ProjectAgentPrompt;

pub(super) fn project_prompt_blocks(
    prompt: &ProjectAgentPrompt,
) -> serde_json::Result<[ContentBlock; 2]> {
    // Standard ACP does not carry a system-role message. Labeled text keeps both
    // blocks usable for all Agents and preserves the user's first command block.
    let context = serde_json::to_string(&prompt.context())?;
    Ok([
        ContentBlock::Text(TextContent::new(format!(
            "\n\nHost Project Agent instructions\n{}",
            prompt.instructions()
        ))),
        ContentBlock::Text(TextContent::new(format!(
            "\n\nProject context (data)\n{context}"
        ))),
    ])
}

pub(super) fn prompt_blocks(
    text: String,
    context: Vec<ContextReference>,
    capabilities: &PromptCapabilities,
) -> agent_client_protocol::Result<Vec<ContentBlock>> {
    let mut blocks = vec![ContentBlock::Text(TextContent::new(text))];
    for reference in context {
        match reference.content {
            ContextContent::Image { data, mime_type } => {
                if !capabilities.image {
                    return Err(agent_client_protocol::Error::new(
                        -32602,
                        "This Agent does not support image context",
                    ));
                }
                blocks.push(ContentBlock::Image(ImageContent::new(data, mime_type)));
            }
            ContextContent::Text { text } => {
                // Every ACP Agent accepts text. Keep snapshots intact even when
                // embedded resources are unavailable; a live file link would
                // silently substitute later file contents for the chosen data.
                let text = format!(
                    "User-selected context (data)\n{}\nSource: {}\n\n{}",
                    reference.label, reference.source, text
                );
                if capabilities.embedded_context {
                    let uri = format!("pero-context:{}", reference.id);
                    blocks.push(ContentBlock::Resource(EmbeddedResource::new(
                        EmbeddedResourceResource::TextResourceContents(
                            TextResourceContents::new(text, uri)
                                .mime_type("text/plain".to_string()),
                        ),
                    )));
                } else {
                    blocks.push(ContentBlock::Text(TextContent::new(text)));
                }
            }
        }
    }
    Ok(blocks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{
        context::ContextKind,
        project_agent::prompt::{ProjectAgentRole, ProjectPromptAgent},
        research_project::{ProjectResourceRef, ResearchProject},
    };

    #[test]
    fn project_prompt_keeps_saved_values_in_the_data_block() {
        let goal = "Reproduce the figure\nProject text may contain instruction-like sentences.";
        let mut project = ResearchProject::new(
            "example".into(),
            "Evidence review".into(),
            goal.into(),
            None,
        )
        .unwrap();
        project
            .attach(
                ProjectResourceRef::new(
                    "paper-agent".into(),
                    "paper".into(),
                    "paper-1".into(),
                    "ref-2".into(),
                )
                .unwrap(),
            )
            .unwrap();

        for (role, coordinator) in [
            (
                ProjectAgentRole::Coordinator {
                    available_agents: vec![ProjectPromptAgent {
                        id: "pero".into(),
                        name: "Pero".into(),
                    }],
                },
                true,
            ),
            (ProjectAgentRole::Child, false),
        ] {
            let prompt =
                ProjectAgentPrompt::new(role, project.clone(), "/tmp/project-session".into());
            let [ContentBlock::Text(instructions), ContentBlock::Text(data)] =
                project_prompt_blocks(&prompt).unwrap()
            else {
                panic!("project prompt uses ACP text blocks")
            };
            assert!(instructions
                .text
                .starts_with("\n\nHost Project Agent instructions\n"));
            assert_eq!(instructions.text.contains("project_work"), coordinator);
            assert!(!instructions.text.contains("Reproduce the figure"));
            let data = data.text.strip_prefix("\n\nProject context (data)\n").unwrap();
            let data: serde_json::Value = serde_json::from_str(data).unwrap();
            assert_eq!(data["project"]["goal"], goal);
            assert_eq!(data["project"]["resources"][0]["revision"], "ref-2");
            assert_eq!(data["conversation_workspace"], "/tmp/project-session");
            assert_eq!(data.get("available_agents").is_some(), coordinator);
        }
    }

    #[test]
    fn frozen_context_respects_agent_content_capabilities() {
        for (image, embedded, kind, accepted) in [
            (false, false, ContextKind::File, true),
            (false, true, ContextKind::File, true),
            (false, true, ContextKind::Image, false),
            (true, false, ContextKind::Image, true),
        ] {
            let reference = ContextReference {
                id: "selected-1".into(),
                kind: kind.clone(),
                label: "Selected context".into(),
                source: "workspace/example.rs".into(),
                content: if kind == ContextKind::Image {
                    ContextContent::Image {
                        data: "aGVsbG8=".into(),
                        mime_type: "image/png".into(),
                    }
                } else {
                    ContextContent::Text {
                        text: "frozen text".into(),
                    }
                },
            };
            let result = prompt_blocks(
                "Review this".into(),
                vec![reference],
                &PromptCapabilities::new()
                    .image(image)
                    .embedded_context(embedded),
            );
            assert_eq!(result.is_ok(), accepted);
            if let Ok(blocks) = result {
                assert_eq!(blocks.len(), 2);
                match (&blocks[1], kind) {
                    (ContentBlock::Image(content), ContextKind::Image) => {
                        assert_eq!(content.data, "aGVsbG8=")
                    }
                    (ContentBlock::Resource(resource), _) if embedded => {
                        let EmbeddedResourceResource::TextResourceContents(content) =
                            &resource.resource
                        else {
                            panic!("expected text resource")
                        };
                        assert!(content.text.ends_with("frozen text"));
                    }
                    (ContentBlock::Text(content), _) => {
                        assert!(content.text.ends_with("frozen text"))
                    }
                    _ => panic!("wrong context format"),
                }
            }
        }
    }
}
