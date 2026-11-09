use super::*;

#[test]
fn market_version_choices() {
    let entry: SkillCatalogEntry = serde_json::from_str(r#"{"id":"source/read","name":"read","kind":"research_skill","source":{"repository":"example/read","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"SKILL.md","sha256":"abc"},"license":{"spdx":"MIT","status":"declared_in_skill","evidence_url":"https://example.invalid/LICENSE"}}"#).unwrap();
    let version = |revision: &str| {
        let mut e = entry.clone();
        e.source.commit = revision.into();
        SkillVersion {
            revision: revision.into(),
            sha256: revision.into(),
            invocation: "market:read".into(),
            directory: PathBuf::from(revision),
            adapter_version: 1,
            entry: e,
        }
    };
    let first = SkillMarketState::default().publish(version("old"));
    assert!(first.selections().unwrap().is_empty());
    assert_eq!(first.installed_versions().unwrap()[0].revision, "old");
    let selected = first.enable(&entry.id, true).unwrap();
    let mut rebuilt = version("old");
    rebuilt.directory = PathBuf::from("old-rebuilt");
    rebuilt.adapter_version = 2;
    let refreshed = selected.publish(rebuilt);
    assert_eq!(
        refreshed.selections().unwrap()[0].directory,
        PathBuf::from("old-rebuilt")
    );
    assert_eq!(refreshed.items[&entry.id].versions.len(), 1);
    assert!(refreshed.items[&entry.id].previous_revision.is_none());
    assert_eq!(
        selected.selections().unwrap()[0].directory,
        PathBuf::from("old")
    );
    let updated = selected.publish(version("new"));
    let restored = updated.rollback(&entry.id, None).unwrap();
    for (state, expected) in [(&selected, "old"), (&updated, "new"), (&restored, "old")] {
        assert_eq!(state.selections().unwrap()[0].revision, expected);
        assert_eq!(state.items[&entry.id].entry.source.commit, expected);
        assert_eq!(
            serde_json::from_str::<SkillMarketState>(&serde_json::to_string(state).unwrap())
                .unwrap()
                .selections()
                .unwrap()[0]
                .revision,
            expected
        );
    }
    assert!(updated.rollback(&entry.id, Some("unknown")).is_err());
    assert!(restored
        .enable(&entry.id, false)
        .unwrap()
        .selections()
        .unwrap()
        .is_empty());
    assert!(restored.remove(&entry.id).unwrap().items.is_empty());
    assert_eq!(restored.items[&entry.id].versions.len(), 2);
    assert!(restored
        .remove(&entry.id)
        .unwrap()
        .installed_versions()
        .unwrap()
        .is_empty());
    assert_eq!(updated.installed_versions().unwrap()[0].revision, "new");
    assert_eq!(restored.installed_versions().unwrap()[0].revision, "old");
    let mut unsupported = entry;
    unsupported.license.spdx = None;
    assert!(unsupported.installable().is_err());
}

#[test]
fn installation_license_evidence() {
    let entry:SkillCatalogEntry=serde_json::from_str(r#"{"id":"source/read","name":"read","kind":"research_skill","source":{"repository":"example/read","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","path":"SKILL.md","sha256":"abc"},"license":{"spdx":"MIT","status":"declared_in_skill","evidence_url":"https://example.invalid/LICENSE"}}"#).unwrap();
    for (kind, status, evidence, accepted) in [
        ("research_skill", "declared_in_skill", true, true),
        ("research_support", "directory_license", true, true),
        ("research_skill", "repository_only", true, false),
        ("research_skill", "unknown", true, false),
        ("research_skill", "declared_in_skill", false, false),
        ("internal_dependency", "declared_in_skill", true, false),
    ] {
        let mut candidate = entry.clone();
        candidate.kind = kind.into();
        candidate.license.status = status.into();
        if !evidence {
            candidate.license.evidence_url = None;
        }
        assert_eq!(
            candidate.installable().is_ok(),
            accepted,
            "{kind}/{status}/{evidence}"
        );
    }
}

#[test]
fn acquisition_cancel_and_shutdown_preserve_installed_version() {
    use std::{
        fs,
        process::Command,
        time::{Duration, Instant},
    };
    for shutdown in [false, true] {
        let directory =
            std::env::temp_dir().join(format!("pero-market-cancel-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let ready = directory.join("ready");
        let installed = directory.join("installed.json");
        fs::write(&installed, "previous-version").unwrap();
        let control = AcquisitionControl::default();
        control.begin("selected").unwrap();
        let worker_control = control.clone();
        let marker = ready.clone();
        let worker = std::thread::spawn(move || {
            let mut command =
                Command::new(std::env::var_os("PERO_APP_NODE").unwrap_or_else(|| "node".into()));
            command.args(["-e","require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)"]).arg(marker);
            worker_control.run("selected", command)
        });
        let deadline = Instant::now() + Duration::from_secs(10);
        while !ready.exists() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        if !ready.exists() {
            control.shutdown();
            let result = worker.join().unwrap();
            panic!("Fixture process did not publish readiness: {result:?}");
        }
        assert!(control.cancel("different-selection").is_err());
        if shutdown {
            control.shutdown();
        } else {
            control.cancel("selected").unwrap();
        }
        assert!(worker.join().unwrap().unwrap_err().contains("cancelled"));
        assert!(control
            .publish("selected", || fs::write(&installed, "new-version")
                .map_err(|e| e.to_string()))
            .is_err());
        assert_eq!(fs::read_to_string(&installed).unwrap(), "previous-version");
        control.finish("selected");
        assert_eq!(control.begin("next").is_ok(), !shutdown);
        fs::remove_dir_all(directory).unwrap();
    }
}
