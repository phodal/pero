use super::*;
fn runtime() -> DoclingRuntime {
    let root = std::env::temp_dir().join(format!("pero-docling-test-{}", uuid::Uuid::new_v4()));
    DoclingRuntime::open(
        root.join("runtime"),
        root.join("data"),
        PathBuf::from("unused-python"),
    )
}
#[test]
fn requests_cannot_select_commands_paths_or_approval_booleans() {
    for value in [
        serde_json::json!({"operation":"install","approved":true}),
        serde_json::json!({"operation":"prepare","component":"custom"}),
        serde_json::json!({"operation":"prepare","component":"software","command":"pip install x"}),
        serde_json::json!({"operation":"status","path":"/tmp"}),
        serde_json::json!({"operation":"prepare","component":"software","profile":"macos-arm64-cp312"}),
    ] {
        assert!(serde_json::from_value::<Request>(value).is_err());
    }
}
#[test]
fn cancellations_and_revocation_invalidate_pending_confirmation() {
    for revoke in [false, true] {
        let runtime = runtime();
        {
            let mut state = runtime.state.lock().unwrap();
            state.pending = Some(("ticket".into(), Component::Software));
            state.status.software = "ready".into();
            state.status.model = "ready".into();
            state.status.software_approved = true;
            state.status.model_approved = true;
        }
        let config = runtime.data.join("docling-runtime.json");
        write_json(&config, &serde_json::json!({"python":"retained"})).unwrap();
        runtime
            .execute(if revoke {
                Request::Revoke {}
            } else {
                Request::Cancel {}
            })
            .unwrap();
        assert!(
            runtime
                .execute(Request::Install {
                    ticket: "ticket".into()
                })
                .is_err()
        );
        let status = runtime.execute(Request::Status {}).unwrap();
        assert_eq!(status["software"], "ready");
        assert_eq!(status["model"], "ready");
        assert_eq!(status["softwareApproved"], !revoke);
        assert_eq!(status["modelApproved"], !revoke);
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
        assert_eq!(
            saved.get("disabled"),
            if revoke {
                Some(&serde_json::Value::Bool(true))
            } else {
                None
            }
        );
        fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
    }
}
#[test]
fn interrupted_installation_never_resumes_or_retains_approval() {
    let runtime = runtime();
    let mut status = runtime.state.lock().unwrap().status.clone();
    status.state = "installing".into();
    runtime.save(&status).unwrap();
    let restored = DoclingRuntime::open(
        runtime.root.clone(),
        runtime.data.clone(),
        runtime.base_python.clone(),
    );
    assert_eq!(
        restored.execute(Request::Status {}).unwrap()["state"],
        "interrupted"
    );
    assert!(
        restored
            .execute(Request::Install {
                ticket: "old".into()
            })
            .is_err()
    );
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}
#[test]
fn wrong_ticket_cannot_start_and_active_revocation_cannot_race_retry() {
    let runtime = runtime();
    {
        let mut state = runtime.state.lock().unwrap();
        state.pending = Some(("real".into(), Component::Model));
    }
    assert!(
        runtime
            .execute(Request::Install {
                ticket: "forged".into()
            })
            .is_err()
    );
    {
        let mut state = runtime.state.lock().unwrap();
        state.running = true;
        state.status.state = "installing".into();
    }
    runtime.execute(Request::Revoke {}).unwrap();
    assert!(
        runtime
            .execute(Request::Prepare {
                component: Component::Model
            })
            .is_err()
    );
    assert!(runtime.state.lock().unwrap().cancel.load(Ordering::SeqCst));
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}
#[test]
fn mismatched_download_is_never_published_and_cancel_never_connects() {
    let runtime = runtime();
    fs::create_dir_all(&runtime.root).unwrap();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = [0u8; 4096];
        let _ = stream.read(&mut request).unwrap();
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nbad")
            .unwrap();
    });
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let path = runtime.root.join("asset.whl");
    let error = runtime
        .download(
            &client,
            &format!("http://{address}"),
            &path,
            &"0".repeat(64),
            10,
            &AtomicBool::new(false),
        )
        .unwrap_err();
    assert!(error.contains("SHA-256 mismatch"));
    assert!(!path.exists());
    server.join().unwrap();
    assert!(
        runtime
            .download(
                &client,
                "http://127.0.0.1:1",
                &path,
                "unused",
                10,
                &AtomicBool::new(true)
            )
            .unwrap_err()
            .contains("Cancelled")
    );
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}

/// Explicit opt-in: downloads the fixed official runtime and model, never run
/// by the normal test suite. This exercises trusted Host protocol approval,
/// not a real native dialog. All files stay under the supplied scratch root.
#[test]
#[ignore = "requires explicit approval for official software/model downloads"]
fn official_optional_runtime_end_to_end() {
    let root = PathBuf::from(
        std::env::var_os("PERO_DOCLING_INSTALL_SMOKE_ROOT").expect("Explicit smoke root required"),
    );
    let python = PathBuf::from(
        std::env::var_os("PERO_DOCLING_INSTALL_SMOKE_PYTHON")
            .expect("Explicit CPython 3.12 required"),
    );
    assert!(root.is_absolute() && python.is_absolute());
    let runtime = DoclingRuntime::open(
        root.join("runtime"),
        root.join("paper-data/research-v1"),
        python,
    );
    fn approved_install(runtime: &DoclingRuntime, component: Component) {
        let prompt = runtime.execute(Request::Prepare { component }).unwrap();
        let ticket = prompt["ticket"].as_str().unwrap().to_owned();
        runtime.execute(Request::Install { ticket }).unwrap();
        let deadline = Instant::now() + Duration::from_secs(7200);
        let mut last = String::new();
        loop {
            let status = runtime.execute(Request::Status {}).unwrap();
            let message = status["message"].as_str().unwrap();
            if message != last {
                eprintln!("{component:?}: {message}");
                last = message.to_owned();
            }
            if status["state"] != "installing" {
                assert!(
                    status["state"] == "idle" || status["state"] == "ready",
                    "{status}"
                );
                break;
            }
            assert!(Instant::now() < deadline, "{status}");
            std::thread::sleep(Duration::from_millis(250));
        }
    }
    runtime.execute(Request::Revoke {}).unwrap();
    let pending = runtime
        .execute(Request::Prepare {
            component: Component::Software,
        })
        .unwrap();
    runtime.execute(Request::Cancel {}).unwrap();
    assert!(
        runtime
            .execute(Request::Install {
                ticket: pending["ticket"].as_str().unwrap().into()
            })
            .is_err()
    );
    approved_install(&runtime, Component::Software);
    let config = runtime.data.join("docling-runtime.json");
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(&config).unwrap()).unwrap()["disabled"],
        true
    );
    approved_install(&runtime, Component::Model);
    assert_eq!(
        runtime.execute(Request::Status {}).unwrap()["state"],
        "ready"
    );
    let active: serde_json::Value = serde_json::from_slice(&fs::read(&config).unwrap()).unwrap();
    assert_eq!(active["python"], runtime.python().to_str().unwrap());
    assert_eq!(
        active["profile"],
        serde_json::to_value(runtime.profile).unwrap()
    );
    runtime.verify_model().unwrap();
    runtime.verify_software(&AtomicBool::new(false)).unwrap();
    // Mimic an interrupted install that left matching dist-info but lost code.
    // A retry must restore wheel contents, not skip "already installed" pins.
    fs::remove_file(
        runtime
            .root
            .join(runtime.profile.unwrap().venv_name())
            .join("lib/python3.12/site-packages/pypdfium2/__init__.py"),
    )
    .unwrap();
    assert!(runtime.verify_software(&AtomicBool::new(false)).is_err());
    runtime.execute(Request::Revoke {}).unwrap();
    let revoked = runtime.execute(Request::Status {}).unwrap();
    assert_eq!(revoked["software"], "ready");
    assert_eq!(revoked["model"], "ready");
    assert_eq!(revoked["softwareApproved"], false);
    assert_eq!(revoked["modelApproved"], false);
    approved_install(&runtime, Component::Software);
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&fs::read(&config).unwrap()).unwrap()["disabled"],
        true
    );
    approved_install(&runtime, Component::Model);
    assert_eq!(
        runtime.execute(Request::Status {}).unwrap()["state"],
        "ready"
    );
    eprintln!("Verified Host activation: {}", config.display());
}

#[test]
fn pinned_wheels_are_official_and_cannot_escape_cache() {
    for profile in [Profile::LinuxX86, Profile::MacArm] {
        let wheels: Vec<Wheel> = serde_json::from_str(profile.wheels()).unwrap();
        let requirements: Vec<_> = profile
            .requirements()
            .lines()
            .filter(|s| !s.is_empty() && !s.starts_with('#'))
            .collect();
        assert_eq!(wheels.len(), requirements.len());
        for wheel in wheels {
            let url = url::Url::parse(&wheel.url).unwrap();
            assert_eq!(url.scheme(), "https");
            assert!(matches!(
                url.host_str(),
                Some("files.pythonhosted.org" | "download.pytorch.org" | "download-r2.pytorch.org")
            ));
            assert!(wheel.filename.ends_with(".whl"));
            assert!(!wheel.filename.contains(['/', '\\']));
            assert_eq!(wheel.sha256.len(), 64);
            assert!(wheel.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
            if profile == Profile::MacArm {
                assert!(wheel.size > 0);
                assert!(!wheel.filename.contains("manylinux"));
                assert!(
                    !wheel.filename.contains("x86_64") || wheel.filename.contains("universal2")
                );
            }
        }
    }
}

#[cfg(unix)]
#[test]
fn installer_parent_helper() {
    let Some(root) = std::env::var_os("PERO_DOCLING_PARENT_DEATH_TEST") else {
        return;
    };
    let root = PathBuf::from(root);
    let mut runtime = DoclingRuntime::open(root.clone(), root.join("data"), "unused".into());
    let lease = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("installer.lock"))
        .unwrap();
    lease.try_lock_exclusive().unwrap();
    runtime.lease = Some(Arc::new(lease));
    runtime
        .run(
            Command::new("/bin/sh")
                .arg("-c")
                .arg("echo $$ > \"$1\"; exec sleep 60")
                .arg("test")
                .arg(root.join("child.pid")),
            &AtomicBool::new(false),
        )
        .unwrap();
}

#[cfg(target_os = "linux")]
#[test]
fn host_death_stops_installer_and_releases_its_lease() {
    let runtime = runtime();
    fs::create_dir_all(&runtime.root).unwrap();
    let mut parent = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "apps::docling_runtime::tests::installer_parent_helper",
            "--nocapture",
        ])
        .env("PERO_DOCLING_PARENT_DEATH_TEST", &runtime.root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let pidfile = runtime.root.join("child.pid");
    let deadline = Instant::now() + Duration::from_secs(10);
    while !pidfile.exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    let pid: u32 = fs::read_to_string(pidfile).unwrap().trim().parse().unwrap();
    let lease = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(runtime.root.join("installer.lock"))
        .unwrap();
    assert!(lease.try_lock_exclusive().is_err());
    parent.kill().unwrap();
    parent.wait().unwrap();
    loop {
        if lease.try_lock_exclusive().is_ok() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "Installer retained lease after Host death"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    let stat = fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
    assert!(
        stat.is_empty() || stat.split(") ").nth(1).is_some_and(|s| s.starts_with('Z')),
        "Installer still running: {stat}"
    );
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn normal_shutdown_waits_for_active_installer_to_exit() {
    let runtime = runtime();
    fs::create_dir_all(&runtime.root).unwrap();
    let pidfile = runtime.root.join("child.pid");
    let this = runtime.clone();
    let child_pidfile = pidfile.clone();
    {
        let mut state = runtime.state.lock().unwrap();
        state.running = true;
        state.status.state = "installing".into();
        let cancel = state.cancel.clone();
        state.worker = Some(std::thread::spawn(move || {
            let result = this.run(
                Command::new("/bin/sh")
                    .arg("-c")
                    .arg("echo $$ > \"$1\"; exec sleep 60")
                    .arg("test")
                    .arg(child_pidfile),
                &cancel,
            );
            assert!(result.is_err());
            this.state.lock().unwrap().running = false;
        }));
    }
    let deadline = Instant::now() + Duration::from_secs(5);
    while !pidfile.exists() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    let pid: i32 = fs::read_to_string(pidfile).unwrap().trim().parse().unwrap();
    runtime.shutdown();
    assert!(!runtime.state.lock().unwrap().running);
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
    assert!(
        runtime
            .execute(Request::Prepare {
                component: Component::Software
            })
            .is_err()
    );
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}

#[test]
fn platform_profile_selection_rejects_unsupported_and_translated_hosts() {
    for (os, arch, translated, macos_major, expected) in [
        ("linux", "x86_64", false, None, Some(Profile::LinuxX86)),
        ("linux", "aarch64", false, None, None),
        ("macos", "aarch64", false, Some(14), Some(Profile::MacArm)),
        ("macos", "aarch64", false, Some(15), Some(Profile::MacArm)),
        ("macos", "aarch64", false, Some(13), None),
        ("macos", "aarch64", false, None, None),
        ("macos", "x86_64", false, Some(14), None),
        ("macos", "x86_64", true, Some(14), None),
        ("windows", "x86_64", false, None, None),
    ] {
        assert_eq!(
            Profile::for_host(&HostPlatform {
                os,
                arch,
                translated,
                macos_major
            })
            .ok(),
            expected,
            "{os} / {arch} / translated={translated} / macOS={macos_major:?}"
        );
    }
}

#[test]
fn python_identity_must_match_the_selected_platform_and_wheel_abi() {
    for profile in [Profile::LinuxX86, Profile::MacArm] {
        let (platform, machine, abi) = match profile {
            Profile::LinuxX86 => ("linux", "x86_64", "cpython-312-x86_64-linux-gnu"),
            Profile::MacArm => ("darwin", "arm64", "cpython-312-darwin"),
        };
        let valid = serde_json::json!({
            "platform":platform, "machine":machine, "implementation":"cpython",
            "version":[3,12], "abi":abi, "pointer_width":64, "debug":false,
            "free_threaded":false
        });
        assert!(
            profile
                .validate_python(&serde_json::from_value(valid.clone()).unwrap())
                .is_ok()
        );
        for (key, wrong) in [
            ("platform", serde_json::json!("win32")),
            (
                "machine",
                serde_json::json!(if profile == Profile::MacArm {
                    "x86_64"
                } else {
                    "arm64"
                }),
            ),
            ("implementation", serde_json::json!("pypy")),
            ("version", serde_json::json!([3, 13])),
            ("abi", serde_json::json!("cpython-312-x86_64-linux-musl")),
            ("pointer_width", serde_json::json!(32)),
            ("debug", serde_json::json!(true)),
            ("free_threaded", serde_json::json!(true)),
        ] {
            let mut changed = valid.clone();
            changed[key] = wrong;
            assert!(
                profile
                    .validate_python(&serde_json::from_value(changed).unwrap())
                    .is_err(),
                "{profile:?} {key}"
            );
        }
    }
}

#[test]
fn foreign_profile_cannot_inherit_previous_software_or_component_consent() {
    let runtime = runtime();
    let current = runtime.profile;
    let foreign = if current == Some(Profile::MacArm) {
        Profile::LinuxX86
    } else {
        Profile::MacArm
    };
    let mut saved = Status::default();
    saved.profile = Some(foreign);
    saved.state = "ready".into();
    saved.software = "ready".into();
    saved.model = "ready".into();
    saved.software_approved = true;
    saved.model_approved = true;
    runtime.save(&saved).unwrap();
    let restored = DoclingRuntime::open(
        runtime.root.clone(),
        runtime.data.clone(),
        runtime.base_python.clone(),
    );
    let status = restored.execute(Request::Status {}).unwrap();
    assert_eq!(status["profile"], serde_json::to_value(current).unwrap());
    assert_eq!(status["software"], "missing");
    assert_eq!(status["model"], "ready");
    assert_eq!(status["softwareApproved"], false);
    assert_eq!(status["modelApproved"], false);
    assert_ne!(status["state"], "ready");
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn installer_inherited_lease_helper() {
    let Ok(raw) = std::env::var("PERO_DOCLING_TEST_LEASE_FD") else {
        return;
    };
    let fd: i32 = raw.parse().unwrap();
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
    assert!(flags >= 0, "Installer lost its lease during exec");
    assert_eq!(flags & libc::FD_CLOEXEC, 0);
}

#[cfg(unix)]
#[test]
fn installer_preserves_its_directory_lease_across_exec() {
    use std::os::fd::AsRawFd;
    let mut runtime = runtime();
    fs::create_dir_all(&runtime.root).unwrap();
    let lease = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(runtime.root.join("installer.lock"))
        .unwrap();
    lease.try_lock_exclusive().unwrap();
    let fd = lease.as_raw_fd();
    assert_ne!(
        unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC,
        0
    );
    runtime.lease = Some(Arc::new(lease));
    runtime
        .run(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "apps::docling_runtime::tests::installer_inherited_lease_helper",
                    "--nocapture",
                ])
                .env("PERO_DOCLING_TEST_LEASE_FD", fd.to_string()),
            &AtomicBool::new(false),
        )
        .unwrap();
    // Clearing CLOEXEC was child-local, not a mutation of the Host descriptor.
    assert_ne!(
        unsafe { libc::fcntl(fd, libc::F_GETFD) } & libc::FD_CLOEXEC,
        0
    );
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}

#[cfg(target_os = "macos")]
#[test]
fn macos_host_crash_keeps_lease_until_in_flight_installer_exits() {
    let runtime = runtime();
    fs::create_dir_all(&runtime.root).unwrap();
    let mut parent = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "apps::docling_runtime::tests::installer_parent_helper",
            "--nocapture",
        ])
        .env("PERO_DOCLING_PARENT_DEATH_TEST", &runtime.root)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let pidfile = runtime.root.join("child.pid");
    let deadline = Instant::now() + Duration::from_secs(10);
    let pid: i32 = loop {
        if let Some(pid) = fs::read_to_string(&pidfile)
            .ok()
            .and_then(|s| s.trim().parse().ok())
        {
            break pid;
        }
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    };
    let lease = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(runtime.root.join("installer.lock"))
        .unwrap();
    parent.kill().unwrap();
    parent.wait().unwrap();
    assert_eq!(unsafe { libc::kill(pid, 0) }, 0);
    let blocked = lease.try_lock_exclusive().is_err();
    unsafe {
        libc::kill(pid, libc::SIGKILL);
    }
    assert!(
        blocked,
        "A Host crash released the still-running installer's lease"
    );
    while lease.try_lock_exclusive().is_err() {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(20));
    }
    fs::remove_dir_all(runtime.root.parent().unwrap()).unwrap();
}

#[test]
fn software_confirmation_describes_only_the_selected_fixed_profile() {
    for (profile, bytes, source, prerequisite) in [
        (
            Profile::LinuxX86,
            "326669963",
            "download.pytorch.org/whl/cpu",
            "Tesseract with English data must already be installed",
        ),
        (
            Profile::MacArm,
            "194887510",
            "https://pypi.org",
            "Apple's built-in Vision",
        ),
    ] {
        let mut runtime = runtime();
        runtime.profile = Some(profile);
        runtime.state.lock().unwrap().status.installer_supported = true;
        let prepared = runtime
            .execute(Request::Prepare {
                component: Component::Software,
            })
            .unwrap();
        let summary = prepared["summary"].as_str().unwrap();
        for detail in [profile.label(), bytes, source, prerequisite] {
            assert!(summary.contains(detail), "{detail} missing from {summary}");
        }
        if profile == Profile::MacArm {
            assert!(summary.contains("hosted macOS 26 arm64 runner"));
            assert!(summary.contains("Desktop confirmation and interaction remain unverified"));
            assert!(!summary.contains("download.pytorch.org"));
        }
    }
}
