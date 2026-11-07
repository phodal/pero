use super::*;

#[test]
fn key_sequence_identity_and_admission() {
    for (source, expected) in [
        ("CMD-SHIFT-P", Some("shift-cmd-p")),
        ("shift-cmd-p", Some("shift-cmd-p")),
        ("cmd-k v", Some("cmd-k v")),
        ("ctrl--", Some("ctrl--")),
        ("", None),
        ("a", None),
        ("shift-a", None),
        ("cmd-c", None),
        ("cmd-c n", None),
        ("ctrl-v", None),
        ("cmd-cmd-p", None),
        ("cmd-k v x", None),
        ("cmd-invalid", None),
        ("alt-f4", None),
    ] {
        assert_eq!(
            source
                .parse::<KeySequence>()
                .ok()
                .map(|key| key.to_string())
                .as_deref(),
            expected,
            "{source}"
        );
    }
}

#[test]
fn keymap_edits_preserve_disable_reset_platform_and_conflict_semantics() {
    let platform = ShortcutPlatform::Macos;
    let base = ShortcutOverrides::default();
    for os in [platform, ShortcutPlatform::Other] {
        assert!(base.conflicts(os).is_empty(), "{:?}", base.conflicts(os));
    }
    let cases = [
        (CommandId::NewChat, "cmd-p", false, false),
        (CommandId::NewChat, "cmd-k n", false, false),
        (CommandId::ToggleSidebar, "cmd-k b", false, true),
        (CommandId::NewChat, "cmd-p", true, true),
        (CommandId::NewChat, "cmd-k", false, false), // chord prefix
        (CommandId::NewChat, "cmd-k", true, true),
        (CommandId::SettingsSearch, "cmd-n", false, true), // separate scope
    ];
    for (command, key, reassign, accepted) in cases {
        let result = base.apply(
            platform,
            ShortcutEdit::Replace {
                command,
                bindings: vec![key.parse().unwrap()],
                reassign,
            },
        );
        assert_eq!(result.is_ok(), accepted, "{command:?} {key}");
        if let Ok(changed) = result {
            assert_eq!(
                changed.bindings(command, platform),
                vec![key.parse::<KeySequence>().unwrap()]
            );
            assert_eq!(
                changed.bindings(command, ShortcutPlatform::Other),
                base.bindings(command, ShortcutPlatform::Other)
            );
            let wire = serde_json::to_string(&changed).unwrap();
            assert_eq!(
                serde_json::from_str::<ShortcutOverrides>(&wire).unwrap(),
                changed
            );
            assert_eq!(
                changed.apply(platform, ShortcutEdit::ResetAll).unwrap(),
                base
            );
        }
    }
    let disabled = base
        .apply(
            platform,
            ShortcutEdit::Replace {
                command: CommandId::NewChat,
                bindings: vec![],
                reassign: false,
            },
        )
        .unwrap();
    assert!(disabled.bindings(CommandId::NewChat, platform).is_empty());
    assert_eq!(
        disabled
            .apply(platform, ShortcutEdit::Reset(CommandId::NewChat))
            .unwrap(),
        base
    );
    let reassigned = base
        .apply(
            platform,
            ShortcutEdit::Replace {
                command: CommandId::NewChat,
                bindings: vec!["cmd-p".parse().unwrap()],
                reassign: true,
            },
        )
        .unwrap();
    assert!(
        reassigned
            .bindings(CommandId::OpenRecent, platform)
            .is_empty()
    );
    assert!(
        reassigned
            .apply(platform, ShortcutEdit::Reset(CommandId::OpenRecent))
            .is_err()
    );
    for invalid in [
        r#"{"macos":{"unknown":[]}}"#,
        r#"{"macos":{"new_chat":["cmd-p"]}}"#,
        r#"{"macos":{"new_chat":["cmd-k","cmd-k v"]}}"#,
    ] {
        assert!(
            serde_json::from_str::<ShortcutOverrides>(invalid).is_err(),
            "{invalid}"
        );
    }
}
