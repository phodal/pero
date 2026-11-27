use super::browser_target;

#[test]
fn local_commands_do_not_wait_for_the_cloud_controller() {
    let (cloud, pending_cloud) = std::sync::mpsc::channel();
    let (host, local) = std::sync::mpsc::channel();
    super::COMMANDS.with(|slot| *slot.borrow_mut() = Some(cloud));
    super::HOST_COMMANDS.with(|slot| *slot.borrow_mut() = Some(host));
    // Leave the Cloud request unconsumed, as during a blocked HTTP call.
    super::session_command(r#"{"action":"remote_refresh"}"#).unwrap();
    for command in [
        r#"{"action":"load_roadmap"}"#,
        r#"{"action":"new_session","thread_id":"local","agent_id":"fixture"}"#,
    ] {
        super::session_command(command).unwrap();
        assert_eq!(local.try_recv().unwrap(), command);
    }
    super::session_command(r#"{"action":"harness_get"}"#).unwrap();
    assert!(local.try_recv().is_err());
    assert_eq!(
        pending_cloud.try_recv().unwrap(),
        r#"{"action":"remote_refresh"}"#
    );
    assert_eq!(
        pending_cloud.try_recv().unwrap(),
        r#"{"action":"harness_get"}"#
    );
    super::COMMANDS.with(|slot| *slot.borrow_mut() = None);
    super::HOST_COMMANDS.with(|slot| *slot.borrow_mut() = None);
}

#[test]
fn the_browser_opens_sign_in_github_and_the_cli_help_page() {
    assert!(browser_target(
        "https://app.openpero.com/connect/desktop?state=abc&code_challenge=def"
    ));
    assert!(browser_target(
        "http://127.0.0.1:8080/connect/desktop?state=abc"
    ));
    assert!(browser_target("https://github.com/phodal/pero/issues/9"));
    assert!(browser_target("https://cli.github.com/"));
    assert!(browser_target(
        "https://tasks.example/connect/desktop?state=abc"
    ));
    assert!(!browser_target("https://cli.github.com/manual"));
    assert!(!browser_target("http://github.com/phodal/pero"));
    assert!(!browser_target("https://evil.example/steal"));
    assert!(!browser_target("https://user@github.com/phodal/pero"));
}

#[cfg(target_os = "macos")]
#[test]
fn the_preview_bundle_uses_the_app_icon_when_one_is_staged() {
    let temp = std::env::temp_dir().join(format!("pero-native-icon-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&temp);
    std::fs::create_dir_all(&temp).unwrap();
    let exe = temp.join("pero-native");
    let icon = temp.join("AppIcon.icns");
    std::fs::write(&exe, b"bin").unwrap();
    std::fs::write(&icon, b"icns").unwrap();
    let app = temp.join("Pero.app");
    super::stage_native_bundle(&exe, &app, Some(icon.as_path())).unwrap();
    let plist = std::fs::read_to_string(app.join("Contents/Info.plist")).unwrap();
    assert!(plist.contains("<key>CFBundleIconFile</key><string>AppIcon.icns</string>"));
    assert_eq!(
        std::fs::read(app.join("Contents/Resources/AppIcon.icns")).unwrap(),
        b"icns"
    );
    assert_eq!(
        std::fs::read(app.join("Contents/MacOS/pero-native")).unwrap(),
        b"bin"
    );
    let bare = temp.join("bare.app");
    super::stage_native_bundle(&exe, &bare, None).unwrap();
    assert!(!std::fs::read_to_string(bare.join("Contents/Info.plist"))
        .unwrap()
        .contains("CFBundleIconFile"));
    std::fs::remove_dir_all(&temp).unwrap();
}
