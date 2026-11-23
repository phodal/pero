//! Converts frozen context into the content types advertised by an ACP Agent.
use agent_client_protocol::schema::v1::*;
use pero_contracts::context::{ContextContent, ContextKind, ContextReference};
use pero_contracts::project_agent::prompt::ProjectAgentPrompt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub(super) const TURN_RECEIPT_CAPABILITY: &str = "pero.turnReceipt";
pub(super) const APP_USE_CONTEXT_CAPABILITY: &str = "pero.appUseContext";
const APP_USE_REFERENCE: &str = "pero-skill:app-use";

#[derive(Default)]
pub(super) struct PromptLayers<'a> {
    pub app_use: bool,
    pub tag_app_use: bool,
    pub app_plugin: &'a str,
    pub project: Option<&'a [ContentBlock; 2]>,
    pub memory: &'a str,
}

pub(super) struct PromptAssembly {
    entries: Vec<(&'static str, ContentBlock)>,
    suppressed_sources: Vec<&'static str>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ReceiptMode {
    Disabled,
    Record,
    Correlate,
}

impl PromptAssembly {
    pub fn into_request(
        self,
        session_id: SessionId,
        mode: ReceiptMode,
    ) -> agent_client_protocol::Result<(PromptRequest, Option<Value>)> {
        if mode == ReceiptMode::Disabled {
            let blocks = self.entries.into_iter().map(|(_, block)| block).collect();
            return Ok((PromptRequest::new(session_id, blocks), None));
        }
        let prompt_id = uuid::Uuid::new_v4().to_string();
        let mut blocks = Vec::with_capacity(self.entries.len());
        let mut descriptions = Vec::with_capacity(self.entries.len());
        for (source, block) in self.entries {
            let kind = match &block {
                ContentBlock::Text(_) => "text",
                ContentBlock::Image(_) => "image",
                ContentBlock::Resource(_) => "resource",
                _ => return Err(agent_client_protocol::Error::internal_error()),
            };
            let serialized = serde_json::to_vec(&block)
                .map_err(agent_client_protocol::Error::into_internal_error)?;
            descriptions.push(json!({
                "source": source, "kind": kind, "bytes": serialized.len(),
                "sha256": format!("{:x}", Sha256::digest(&serialized)),
            }));
            blocks.push(block);
        }
        let receipt = json!({
            "promptId": prompt_id, "acpSessionId": session_id, "stage": "prepared",
            "blocks": descriptions, "suppressedSources": self.suppressed_sources,
        });
        let mut request = PromptRequest::new(session_id, blocks);
        if mode == ReceiptMode::Correlate {
            request.meta = Some(Meta::from_iter([(
                TURN_RECEIPT_CAPABILITY.into(),
                json!({"id": prompt_id}),
            )]));
        }
        Ok((request, Some(receipt)))
    }
}

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

fn app_use_workflow_block(source: &str, tag: bool) -> ContentBlock {
    let mut content = TextContent::new(format!(
        "\n\nHost-provided App Use workflow:\n{}",
        super::APP_USE_SKILL,
    ));
    if tag {
        content.meta = Some(Meta::from_iter([(
            APP_USE_CONTEXT_CAPABILITY.into(),
            json!(source),
        )]));
    }
    ContentBlock::Text(content)
}

pub(super) fn prompt_blocks(
    text: String,
    context: Vec<ContextReference>,
    capabilities: &PromptCapabilities,
    layers: PromptLayers<'_>,
) -> agent_client_protocol::Result<PromptAssembly> {
    let mut entries = vec![("user", ContentBlock::Text(TextContent::new(text)))];
    let mut app_use_selected = false;
    for reference in context {
        let block = match reference.content {
            ContextContent::Image { data, mime_type } => {
                if !capabilities.image {
                    return Err(agent_client_protocol::Error::new(
                        -32602,
                        "This Agent does not support image context",
                    ));
                }
                ContentBlock::Image(ImageContent::new(data, mime_type))
            }
            ContextContent::Text { text } => {
                if layers.app_use
                    && reference.kind == ContextKind::Skill
                    && reference.id == APP_USE_REFERENCE
                    && reference.source == APP_USE_REFERENCE
                    && text == super::APP_USE_SKILL
                {
                    // Keep the selected position, but preserve the mounted workflow's
                    // instruction text and format when it is the sole copy.
                    if !app_use_selected {
                        entries.push((
                            "user_selected",
                            app_use_workflow_block("selected", layers.tag_app_use),
                        ));
                        app_use_selected = true;
                    }
                    continue;
                }
                // Every ACP Agent accepts text. Keep snapshots intact even when
                // embedded resources are unavailable; a live file link would
                // silently substitute later file contents for the chosen data.
                let text = format!(
                    "\n\nUser-selected context (data)\n{}\nSource: {}\n\n{}",
                    reference.label, reference.source, text
                );
                if capabilities.embedded_context {
                    let uri = format!("pero-context:{}", reference.id);
                    ContentBlock::Resource(EmbeddedResource::new(
                        EmbeddedResourceResource::TextResourceContents(
                            TextResourceContents::new(text, uri)
                                .mime_type("text/plain".to_string()),
                        ),
                    ))
                } else {
                    ContentBlock::Text(TextContent::new(text))
                }
            }
        };
        entries.push(("user_selected", block));
    }
    let mut suppressed_sources = Vec::new();
    if layers.app_use {
        if app_use_selected {
            suppressed_sources.push("app_use");
        } else {
            entries.push((
                "app_use",
                app_use_workflow_block("automatic", layers.tag_app_use),
            ));
        }
    }
    if !layers.app_plugin.is_empty() {
        entries.push((
            "app_plugin",
            ContentBlock::Text(TextContent::new(format!(
                "\n\nHost-mounted App Agent Plugin instructions:\n{}",
                layers.app_plugin,
            ))),
        ));
    }
    if let Some([instructions, context]) = layers.project {
        entries.push(("project_instructions", instructions.clone()));
        entries.push(("project_context", context.clone()));
    }
    if !layers.memory.is_empty() {
        entries.push((
            "memory",
            ContentBlock::Text(TextContent::new(format!("\n\n{}", layers.memory))),
        ));
    }
    Ok(PromptAssembly {
        entries,
        suppressed_sources,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use pero_contracts::{
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
            assert!(
                instructions
                    .text
                    .starts_with("\n\nHost Project Agent instructions\n")
            );
            assert_eq!(instructions.text.contains("project_work"), coordinator);
            assert!(!instructions.text.contains("Reproduce the figure"));
            let data = data
                .text
                .strip_prefix("\n\nProject context (data)\n")
                .unwrap();
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
                PromptLayers::default(),
            );
            assert_eq!(result.is_ok(), accepted);
            if let Ok(assembly) = result {
                let (request, _) = assembly
                    .into_request("session".into(), ReceiptMode::Disabled)
                    .unwrap();
                let blocks = request.prompt;
                assert_eq!(blocks.len(), 2);
                assert_eq!(
                    blocks[0],
                    ContentBlock::Text(TextContent::new("Review this"))
                );
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
                        assert!(content.text.starts_with("\n\nUser-selected context (data)"));
                        assert!(content.text.ends_with("frozen text"));
                    }
                    (ContentBlock::Text(content), _) => {
                        assert!(content.text.starts_with("\n\nUser-selected context (data)"));
                        assert!(content.text.ends_with("frozen text"))
                    }
                    _ => panic!("wrong context format"),
                }
            }
        }
    }

    #[test]
    fn only_the_mounted_builtin_app_use_reference_suppresses_the_workflow_copy() {
        let builtin = super::super::APP_USE_SKILL;
        for (mounted, kind, id, source, body, suppressed, extra_block) in [
            (
                true,
                ContextKind::Skill,
                APP_USE_REFERENCE,
                APP_USE_REFERENCE,
                builtin,
                true,
                false,
            ),
            (
                false,
                ContextKind::Skill,
                APP_USE_REFERENCE,
                APP_USE_REFERENCE,
                builtin,
                false,
                false,
            ),
            (
                true,
                ContextKind::File,
                APP_USE_REFERENCE,
                APP_USE_REFERENCE,
                builtin,
                false,
                true,
            ),
            (
                true,
                ContextKind::Skill,
                "other",
                APP_USE_REFERENCE,
                builtin,
                false,
                true,
            ),
            (
                true,
                ContextKind::Skill,
                APP_USE_REFERENCE,
                "other",
                builtin,
                false,
                true,
            ),
            (
                true,
                ContextKind::Skill,
                APP_USE_REFERENCE,
                APP_USE_REFERENCE,
                "other",
                false,
                true,
            ),
        ] {
            let reference = ContextReference {
                id: id.into(),
                kind,
                label: "Do not include this label in the receipt".into(),
                source: source.into(),
                content: ContextContent::Text { text: body.into() },
            };
            let references = if suppressed {
                vec![reference.clone(), reference]
            } else {
                vec![reference]
            };
            for tag_app_use in [false, true] {
                let (request, receipt) = prompt_blocks(
                    "Use the linked App".into(),
                    references.clone(),
                    &PromptCapabilities::new().embedded_context(true),
                    PromptLayers {
                        app_use: mounted,
                        tag_app_use,
                        app_plugin: "app instructions",
                        memory: "local memory",
                        ..PromptLayers::default()
                    },
                )
                .unwrap()
                .into_request("session".into(), ReceiptMode::Correlate)
                .unwrap();
                let receipt = receipt.unwrap();
                let wire_meta = request.meta.as_ref().unwrap();
                assert_eq!(
                    wire_meta[TURN_RECEIPT_CAPABILITY]["id"],
                    receipt["promptId"]
                );
                let layer_index = 2 + usize::from(extra_block);
                assert_eq!(request.prompt.len(), layer_index + 2);
                assert_eq!(
                    receipt["suppressedSources"],
                    if suppressed {
                        json!(["app_use"])
                    } else {
                        json!([])
                    }
                );
                assert_eq!(receipt["blocks"][1]["source"], "user_selected");
                assert!(!receipt.to_string().contains("Do not include this label"));
                if suppressed {
                    assert_eq!(
                        request.prompt[1],
                        app_use_workflow_block("selected", tag_app_use)
                    );
                } else {
                    assert!(matches!(request.prompt[1], ContentBlock::Resource(_)));
                }
                if extra_block {
                    assert_eq!(
                        request.prompt[2],
                        app_use_workflow_block("automatic", tag_app_use)
                    );
                }
                assert_eq!(
                    request.prompt[layer_index],
                    ContentBlock::Text(TextContent::new(
                        "\n\nHost-mounted App Agent Plugin instructions:\napp instructions",
                    ))
                );
                assert_eq!(
                    request.prompt[layer_index + 1],
                    ContentBlock::Text(TextContent::new("\n\nlocal memory"))
                );
                for (index, block) in request.prompt.iter().enumerate() {
                    let serialized = serde_json::to_vec(block).unwrap();
                    assert_eq!(receipt["blocks"][index]["bytes"], serialized.len());
                    assert_eq!(
                        receipt["blocks"][index]["sha256"],
                        format!("{:x}", Sha256::digest(&serialized))
                    );
                    let wire_block: Value = serde_json::from_slice(&serialized).unwrap();
                    let tag = &wire_block["_meta"][APP_USE_CONTEXT_CAPABILITY];
                    if tag_app_use && suppressed && index == 1 {
                        assert_eq!(tag, "selected");
                    } else if tag_app_use && extra_block && index == 2 {
                        assert_eq!(tag, "automatic");
                    } else {
                        assert!(wire_block.get("_meta").is_none());
                    }
                }
            }
        }
    }
}
