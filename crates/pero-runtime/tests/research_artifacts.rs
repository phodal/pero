use pero_contracts::{
    content_document::ContentFormat,
    session_artifact::{ArtifactMethod, ArtifactRequest, ResearchArtifactSource},
};
use pero_runtime::session_artifacts::SessionArtifacts;
use sha2::{Digest, Sha256};

#[test]
fn research_deliveries_retain_versions_and_deduplicate_across_restart() {
    let root =
        std::env::temp_dir().join(format!("pero-research-artifacts-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let settings = root.join("settings.json");
    let request = |thread: &str, text: &str| ArtifactRequest::RegisterText {
        method: ArtifactMethod::Artifacts,
        request_id: uuid::Uuid::new_v4().to_string(),
        thread_id: thread.into(),
        artifact_id: None,
        title: "Research report".into(),
        text: text.into(),
        format: Some(ContentFormat::Markdown),
        source_message_id: None,
        source_tool_call_id: None,
    };
    let source = |checkpoint: &str, text: &str| ResearchArtifactSource {
        program_id: "program-1".into(),
        checkpoint_id: checkpoint.into(),
        slot: "report".into(),
        export_digest: format!("{:x}", Sha256::digest(text.as_bytes())),
    };
    let first = SessionArtifacts::new(&settings)
        .register_research(
            request("chat", "first\n"),
            source("checkpoint-1", "first\n"),
            10,
        )
        .unwrap();
    assert_eq!(first.latest().version, 1);

    // A retry may have a new request ID and arrival time, including after restart.
    let restored = SessionArtifacts::new(&settings);
    let retry = restored
        .register_research(
            request("chat", "first\n"),
            source("checkpoint-1", "first\n"),
            20,
        )
        .unwrap();
    assert_eq!(retry.id, first.id);
    assert_eq!(restored.list("chat").unwrap(), vec![first.clone()]);

    // A new checkpoint is a new version even when its exported bytes are unchanged.
    let second = restored
        .register_research(
            request("chat", "first\n"),
            source("checkpoint-2", "first\n"),
            30,
        )
        .unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.latest().version, 2);
    let third = restored
        .register_research(
            request("chat", "revised\n"),
            source("checkpoint-3", "revised\n"),
            40,
        )
        .unwrap();
    assert_eq!(third.id, first.id);
    assert_eq!(third.latest().version, 3);

    // Replaying an older checkpoint cannot overwrite the latest export or add a version.
    let restarted = SessionArtifacts::new(&settings);
    let old_retry = restarted
        .register_research(
            request("chat", "first\n"),
            source("checkpoint-1", "first\n"),
            50,
        )
        .unwrap();
    assert_eq!(old_retry.id, first.id);
    assert_eq!(restarted.list("chat").unwrap(), vec![third]);
    assert_eq!(
        restarted.read("chat", &first.id, Some(1)).unwrap().source(),
        "first\n"
    );
    assert_eq!(
        restarted.read("chat", &first.id, Some(2)).unwrap().source(),
        "first\n"
    );
    assert_eq!(
        restarted.read("chat", &first.id, None).unwrap().source(),
        "revised\n"
    );

    let other = restarted
        .register_research(
            request("other-chat", "first\n"),
            source("checkpoint-1", "first\n"),
            60,
        )
        .unwrap();
    assert_ne!(other.id, first.id);
    assert_eq!(other.thread_id, "other-chat");
    assert_eq!(other.latest().version, 1);
    assert_eq!(restarted.list("other-chat").unwrap(), vec![other]);
    assert!(restarted.read("other-chat", &first.id, Some(1)).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn research_deliveries_reject_file_inputs_and_caller_selected_artifacts() {
    let root =
        std::env::temp_dir().join(format!("pero-research-artifacts-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let store = SessionArtifacts::new(&root.join("settings.json"));
    let ordinary = store
        .register(
            ArtifactRequest::RegisterText {
                method: ArtifactMethod::Artifacts,
                request_id: "ordinary".into(),
                thread_id: "chat".into(),
                artifact_id: None,
                title: "User report".into(),
                text: "original\n".into(),
                format: Some(ContentFormat::Markdown),
                source_message_id: None,
                source_tool_call_id: None,
            },
            None,
            1,
        )
        .unwrap();
    let file = root.join("report.md");
    std::fs::write(&file, "research\n").unwrap();
    let cases = [
        (
            "caller-selected existing artifact",
            ArtifactRequest::RegisterText {
                method: ArtifactMethod::Artifacts,
                request_id: "research-text".into(),
                thread_id: "chat".into(),
                artifact_id: Some(ordinary.id.clone()),
                title: "Research report".into(),
                text: "research\n".into(),
                format: Some(ContentFormat::Markdown),
                source_message_id: None,
                source_tool_call_id: None,
            },
        ),
        (
            "file input",
            ArtifactRequest::RegisterFile {
                method: ArtifactMethod::Artifacts,
                request_id: "research-file".into(),
                thread_id: "chat".into(),
                artifact_id: None,
                title: Some("Research report".into()),
                path: file.to_string_lossy().into_owned(),
                presentation: None,
                related: Vec::new(),
                source_message_id: None,
                source_tool_call_id: None,
            },
        ),
    ];
    for (name, request) in cases {
        let source = ResearchArtifactSource {
            program_id: "program-1".into(),
            checkpoint_id: "checkpoint-1".into(),
            slot: "report".into(),
            export_digest: format!("{:x}", Sha256::digest(b"research\n")),
        };
        assert!(
            store.register_research(request, source, 2).is_err(),
            "{name}"
        );
        assert_eq!(
            store.list("chat").unwrap(),
            vec![ordinary.clone()],
            "{name}"
        );
    }
    assert_eq!(
        store.read("chat", &ordinary.id, None).unwrap().source(),
        "original\n"
    );
    std::fs::remove_dir_all(root).unwrap();
}
