//! Native developer preview: shared GPUI workbench, the stdio Host, and cloud sign-in.
use crate::native_cloud::CloudSession;
use crate::native_device::NativeDevice;
use crate::{app::Workbench, theme::Palettes};
use gpui_kit::*;
use pero_contracts::HostEvent;
use std::{
    cell::RefCell,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
};

thread_local! {
    static APPS: RefCell<Option<crate::native_apps::NativeApps>> = const { RefCell::new(None) };
    static COMMANDS: RefCell<Option<mpsc::Sender<String>>> = const { RefCell::new(None) };
    static HOST_COMMANDS: RefCell<Option<mpsc::Sender<String>>> = const { RefCell::new(None) };
}

pub(crate) fn session_command(json: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
    let action = value["action"].as_str().unwrap_or_default();
    if action.starts_with("apps_") && action != "apps_install" {
        return APPS.with(|apps| {
            let apps = apps.borrow();
            let apps = apps.as_ref().ok_or("Native Apps are unavailable")?;
            apps.command(value);
            Ok(())
        });
    }
    let controller = action.starts_with("remote_")
        || action.starts_with("local_worker_")
        || action.starts_with("choose_")
        || matches!(action, "apps_install" | "harness_get" | "harness_save");
    let channel = if controller {
        &COMMANDS
    } else {
        &HOST_COMMANDS
    };
    channel.with(|slot| {
        slot.borrow()
            .as_ref()
            .ok_or("Native Host is unavailable")?
            .send(json.to_string())
            .map_err(|error| error.to_string())
    })
}
pub(crate) fn apps() -> crate::native_apps::NativeApps {
    APPS.with(|apps| {
        apps.borrow()
            .as_ref()
            .expect("Native Apps initialized")
            .clone()
    })
}
pub(crate) fn send_probe(json: &str) -> Result<(), String> {
    session_command(json)
}
pub(crate) fn request_locale(locale: &str) -> Result<(), String> {
    session_command(&serde_json::json!({"method":"settings.locale","locale":locale}).to_string())
}

pub(crate) fn native_application() -> Application {
    #[cfg(target_os = "linux")]
    {
        gpui_kit::platform::linux(WindowingModes::X11)
    }
    #[cfg(not(target_os = "linux"))]
    {
        gpui_kit::application()
    }
}

pub fn run() -> anyhow::Result<()> {
    #[cfg(target_os = "windows")]
    unsafe {
        std::env::set_var("GPUI_DISABLE_DIRECT_COMPOSITION", "true");
    }
    if std::env::args().nth(1).as_deref() == Some("--verify-webview") {
        #[cfg(feature = "native-probe")]
        {
            return crate::native_web_probe::run();
        }
        #[cfg(not(feature = "native-probe"))]
        {
            anyhow::bail!("Build with native-probe to run Web view acceptance");
        }
    }
    let app_probe = std::env::args().nth(1).as_deref() == Some("--verify-apps");
    #[cfg(not(feature = "native-probe"))]
    if app_probe {
        anyhow::bail!("Build with native-probe to run App acceptance");
    }
    #[cfg(target_os = "macos")]
    if !app_probe {
        relaunch_in_bundle();
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let data = std::env::var_os("PERO_NATIVE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".pero/native-preview")
        });
    std::fs::create_dir_all(&data)?;
    // dev:native sets this. The preview is ad-hoc signed on every rebuild, so a
    // login-keychain read prompts on every launch. Local preview keeps secrets
    // in this process instead.
    let ephemeral_secrets = std::env::var_os("PERO_NATIVE_EPHEMERAL_SECRETS").is_some();
    let executable = std::env::var_os("PERO_NATIVE_HOST")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join("target/release/pero-host"));
    let locale = std::env::var("PERO_LOCALE").unwrap_or_else(|_| "zh-CN".into());
    let home = PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
    let mut paths = vec![
        root.join("node_modules/.bin"),
        PathBuf::from("/opt/homebrew/bin"),
        home.join(".local/bin"),
        home.join(".opencode/bin"),
    ];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    let settings_path = data.join("settings.json");
    let harness =
        crate::native_harness::NativeHarness::open(&data, &settings_path, ephemeral_secrets);
    let (provider_endpoint, provider_model, provider_key) = harness.process_env();
    #[derive(serde::Deserialize)]
    struct NativeProduct {
        apps: Vec<String>,
        #[serde(default)]
        required: Vec<String>,
    }
    let product: NativeProduct =
        serde_json::from_slice(&std::fs::read(root.join("products/pero.json"))?)?;
    let mut host = Command::new(executable)
        .arg("--stdio")
        .current_dir(&root)
        .env("PERO_AGENT_ROOT", &root)
        .env("PATH", std::env::join_paths(paths)?)
        .env("PERO_LOCALE", &locale)
        .env("PERO_SETTINGS_PATH", &settings_path)
        .env(
            "PERO_BUILTIN_APPS_ROOT",
            std::env::var_os("PERO_BUILTIN_APPS_ROOT")
                .map(PathBuf::from)
                .unwrap_or_else(|| root.join("apps")),
        )
        .env(
            "PERO_BUILTIN_APPS",
            std::env::var("PERO_BUILTIN_APPS").unwrap_or_else(|_| product.apps.join(",")),
        )
        .env(
            "PERO_REQUIRED_APPS",
            std::env::var("PERO_REQUIRED_APPS").unwrap_or_else(|_| product.required.join(",")),
        )
        .env("DEEPSEEK_BASE_URL", &provider_endpoint)
        .env("DEEPSEEK_MODEL", &provider_model)
        .env("DEEPSEEK_API_KEY", &provider_key)
        .env("PERO_HISTORY_PATH", data.join("sessions.jsonl"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()?;
    let mut stdin = host.stdin.take().expect("piped stdin");
    let stdout = host.stdout.take().expect("piped stdout");
    let (commands, incoming) = mpsc::channel::<String>();
    COMMANDS.with(|slot| *slot.borrow_mut() = Some(commands.clone()));
    let (events, received) = async_channel::unbounded::<HostEvent>();
    // Cloud HTTP may block its controller. Local ACP and file reads have their
    // own writer so they never wait for a remote response.
    let (host_commands, host_incoming) = mpsc::channel::<String>();
    HOST_COMMANDS.with(|slot| *slot.borrow_mut() = Some(host_commands.clone()));
    let app_client = crate::native_apps::NativeApps::new(host_commands.clone(), events.clone());
    APPS.with(|slot| *slot.borrow_mut() = Some(app_client.clone()));
    let writer_events = events.clone();
    std::thread::spawn(move || {
        for json in host_incoming {
            if writeln!(stdin, "{json}")
                .and_then(|_| stdin.flush())
                .is_err()
            {
                let _ = writer_events.send_blocking(HostEvent::message(
                    "disconnected",
                    None,
                    "error.host_stopped",
                ));
                break;
            }
        }
    });
    let reader_events = events.clone();
    let worker_states = commands.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            match serde_json::from_str::<HostEvent>(&line) {
                Ok(event) if event.version == pero_contracts::PROTOCOL_VERSION => {
                    if app_client.accept(&event) {
                        continue;
                    }
                    if matches!(
                        event.kind.as_str(),
                        "harness_settings_saved" | "harness_settings_error"
                    ) {
                        let _ = worker_states.send(
                            serde_json::json!({
                                "action": "native_harness_result",
                                "ok": event.kind == "harness_settings_saved",
                            })
                            .to_string(),
                        );
                        continue;
                    }
                    if event.kind == "local_worker_state"
                        && matches!(
                            event.data["status"].as_str(),
                            Some("needs_attention" | "unavailable")
                        )
                    {
                        let _ = worker_states.send(
                            serde_json::json!({"action":"native_local_worker_attention"})
                                .to_string(),
                        );
                    }
                    if reader_events.send_blocking(event).is_err() {
                        break;
                    }
                }
                _ => eprintln!("Invalid native Host event"),
            }
        }
        let _ = worker_states
            .send(serde_json::json!({"action":"native_host_disconnected"}).to_string());
        let _ = reader_events.send_blocking(HostEvent::message(
            "disconnected",
            None,
            "error.host_stopped",
        ));
    });
    let reply = commands.clone();
    std::thread::spawn(move || {
        let mut harness = harness;
        let mut cloud = CloudSession::with_store(&data, ephemeral_secrets);
        let mut device = NativeDevice::new(&data, cloud.has_connection(), ephemeral_secrets);
        loop {
            let json = match incoming.recv_timeout(std::time::Duration::from_secs(5)) {
                Ok(json) => json,
                Err(mpsc::RecvTimeoutError::Timeout) if cloud.has_connection() => {
                    serde_json::json!({"action":"remote_refresh"}).to_string()
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) else {
                continue;
            };
            let action = value["action"].as_str().unwrap_or_default();
            if action == "native_host_disconnected" {
                let _ = events.send_blocking(device.command_failed(&cloud));
                if let Some(event) = harness.abandon() {
                    let _ = events.send_blocking(event);
                }
            } else if matches!(
                action,
                "harness_get" | "harness_save" | "native_harness_result"
            ) {
                let outcome = harness.handle(&value);
                if let Some(command) = outcome.host {
                    if host_commands.send(command).is_err() {
                        if let Some(event) = harness.abandon() {
                            let _ = events.send_blocking(event);
                        }
                        break;
                    }
                }
                if let Some(event) = outcome.event {
                    let _ = events.send_blocking(event);
                }
            } else if action == "native_local_worker_attention" {
                let _ = events.send_blocking(device.needs_attention(&cloud));
            } else if action.starts_with("local_worker_") {
                let mut outcome = device.command(&value, &cloud);
                if let Some(command) = outcome.command {
                    if host_commands.send(command.to_string()).is_err() {
                        outcome.event = device.command_failed(&cloud);
                    }
                }
                let _ = events.send_blocking(outcome.event);
            } else if action == "remote_login" {
                let url = value["url"].as_str().unwrap_or("");
                match cloud.start_login(url) {
                    Ok(outcome) => {
                        let _ = events.send_blocking(outcome.event);
                        if let Some(url) = outcome.open_url {
                            if let Err(message) = open_browser(&url) {
                                let _ = events.send_blocking(cloud.note_error(&message));
                            } else if let Some(id) = outcome.expire_id {
                                let reply = reply.clone();
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_secs(10 * 60));
                                    let _ = reply.send(serde_json::json!({"action":"native_login_expired","id":id}).to_string());
                                });
                            }
                        }
                    }
                    Err(message) => {
                        let _ = events.send_blocking(cloud.note_error(message));
                    }
                }
            } else if let Some(mut outcome) = cloud.command(&value) {
                if let Some(url) = outcome.open_url.clone() {
                    if let Err(message) = open_browser(&url) {
                        outcome.event.data["error"] = serde_json::Value::String(message);
                        let _ = events.send_blocking(outcome.event);
                        continue;
                    }
                }
                let _ = events.send_blocking(outcome.event);
                let mut outcome = device.synchronize(&cloud, action == "remote_disconnect");
                if let Some(command) = outcome.command {
                    if host_commands.send(command.to_string()).is_err() {
                        outcome.event = device.command_failed(&cloud);
                    }
                }
                let _ = events.send_blocking(outcome.event);
            } else if matches!(
                action,
                "choose_workspace"
                    | "choose_context"
                    | "choose_worker_workspace"
                    | "choose_document"
                    | "choose_document_save"
                    | "choose_icon_theme"
                    | "apps_install"
            ) {
                let mut event = HostEvent::new(&format!("native_{action}"), None, String::new());
                event.data = value;
                let _ = events.send_blocking(event);
            } else if host_commands.send(json).is_err() {
                let _ = events.send_blocking(device.command_failed(&cloud));
                break;
            }
        }
        drop(host_commands);
        let _ = host.wait();
    });
    let palettes: Palettes =
        serde_json::from_str(include_str!("../../../web/src/theme.generated.json"))?;
    let urls = commands.clone();
    let app = native_application();
    let app = app.with_assets(crate::assets::UiAssets);
    app.on_open_urls(move |opened| {
        for url in opened {
            let _ = urls
                .send(serde_json::json!({"action":"native_login_callback","url":url}).to_string());
        }
    });
    app.run(move |cx| {
        let registration = if app_probe { None } else { Some(cx.register_url_scheme("pero")) };
        cx.spawn(async move |_cx| {
            if let Some(registration) = registration { if let Err(error) = registration.await {
                eprintln!("pero:// handler was not registered: {error:#}");
            }}
        })
        .detach();
        cx.text_system()
            .add_fonts(vec![
                std::borrow::Cow::Borrowed(
                    include_bytes!("../../../web/public/fonts/Workbench-regular.ttf").as_slice(),
                ),
                std::borrow::Cow::Borrowed(
                    include_bytes!("../../../web/public/fonts/Workbench-bold.ttf").as_slice(),
                ),
                std::borrow::Cow::Borrowed(
                    include_bytes!("../../../web/public/fonts/JetBrainsMono-Regular.ttf")
                        .as_slice(),
                ),
            ])
            .expect("native catalog fonts");
        gpui_kit::init(cx);
        gpui_kit::component::set_locale(&locale);
        let system_dark = matches!(cx.window_appearance(), WindowAppearance::Dark | WindowAppearance::VibrantDark);
        pero_theme::ResolvedAppearance::resolve(&Default::default(), system_dark, &palettes).install(cx);
        let mut options = gpui_kit::component::TitleBar::window_options();
        options.show = !app_probe;
        options.focus = !app_probe;
        options.window_bounds = Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(px(1440.), px(960.)),
            cx,
        )));
        options.window_min_size = Some(size(px(1000.), px(680.)));
        if let Some(titlebar) = options.titlebar.as_mut() {
            titlebar.traffic_light_position = Some(point(px(12.), px(13.)));
        }
        let (window, view) = gpui_kit::open_window(options, cx, move |window, cx| {
            window.set_window_title("Pero Native Preview — local sessions");
            cx.new(|cx| {
                let mut view = Workbench::new(palettes, system_dark, locale, window, cx);
                view._subscriptions.push(cx.observe_window_appearance(window, |view, window, cx| {
                    view.system_dark = matches!(window.appearance(), WindowAppearance::Dark | WindowAppearance::VibrantDark);
                    view.install_appearance(cx);
                }));
                view
            })
        })
        .expect("native workbench window");
        #[cfg(feature="native-probe")]
        if app_probe {
            let receipt = PathBuf::from(std::env::args().nth(2).expect("App acceptance receipt path"));
            crate::native_app_probe::attach(view.clone(),window,receipt,cx);
        }
        let close_view=view.downgrade();
        let _=window.update(cx,|_,window,cx| {
            window.on_window_should_close(cx,move|window,cx| {
                close_view.update(cx,|view,cx| {
                    view.request_workspace_window_close(window,cx);
                    false
                }).unwrap_or(true)
            });
        });
        let view = view.downgrade();
        cx.spawn(async move |cx| {
            while let Ok(event) = received.recv().await {
                if event.kind=="native_choose_document_save" {
                    let suggested=std::path::Path::new(event.data["suggested"].as_str().unwrap_or("untitled.txt"));
                    let directory=suggested.parent().filter(|path|!path.as_os_str().is_empty()).map(std::path::Path::to_path_buf).unwrap_or_else(||std::path::PathBuf::from("."));
                    let name=suggested.file_name().map(|name|name.to_string_lossy().into_owned());
                    let picker=cx.update(|cx|cx.prompt_for_new_path(&directory,name.as_deref()));
                    let mut selected=HostEvent::new("document_save_cancelled",event.data["request_id"].as_str().map(str::to_owned),String::new());
                    match picker.await {
                        Ok(Ok(Some(path)))=>{selected.kind="document_save_path".into();selected.data=serde_json::json!({"path":path});}
                        Ok(Ok(None))=>{}
                        _=>{selected.kind="document_error".into();selected.data=serde_json::json!({"source":"","reason":"read_write"});}
                    }
                    let _=window.update(cx,|_,window,cx|view.update(cx,|view,cx|view.receive(selected,window,cx))).and_then(|result|result);
                    continue;
                }
                if matches!(
                    event.kind.as_str(),
                    "native_apps_install" | "native_choose_workspace" | "native_choose_context" | "native_choose_worker_workspace" | "native_choose_document" | "native_choose_icon_theme"
                ) {
                    let app_install=event.kind=="native_apps_install";
                    let icon_theme=event.kind=="native_choose_icon_theme";
                    let file_document=event.kind=="native_choose_document";
                    let worker_workspace=event.kind=="native_choose_worker_workspace";
                    let workspace = event.kind == "native_choose_workspace" || worker_workspace;
                    let typed_context = !workspace && event.data["request_id"].is_string();
                    let context_kind = event.data["kind"].as_str().unwrap_or("file");
                    let directory = app_install || workspace || typed_context && context_kind == "directory";
                    let paths = cx.update(|cx| {
                        cx.prompt_for_paths(PathPromptOptions {
                            files: !directory,
                            directories: directory,
                            multiple: !directory && !typed_context && !file_document && !icon_theme,
                            prompt: if icon_theme {Some("Icon theme JSON".into())}else{(typed_context && context_kind == "image").then(|| "Image (PNG, JPEG, GIF, WebP)".into())},
                        })
                    });
                    let paths = match paths.await {
                        Ok(Ok(paths)) => paths,
                        _ => {
                            if icon_theme {let _=session_command(r#"{"method":"icons","action":"get","request_id":"icons"}"#);}
                            if typed_context {
                                let failure = HostEvent::new("context_error", event.data["request_id"].as_str().map(str::to_string), "Could not open the file picker. Retry or use context search.".into());
                                let _ = window.update(cx, |_, window, cx| {
                                    view.update(cx, |view, cx| view.receive(failure, window, cx))
                                }).and_then(|result| result);
                            }
                            continue;
                        }
                    };
                    if icon_theme && paths.is_none(){let _=session_command(r#"{"method":"icons","action":"get","request_id":"icons"}"#);}
                    if let Some(paths) = paths {
                        if let Some(path) = paths.first() {
                            if worker_workspace {
                                let mut selected=HostEvent::new("local_worker_workspace",None,String::new());selected.data=serde_json::json!({"path":path});
                                let _ = window.update(cx, |_, window, cx| {
                                    view.update(cx, |view, cx| view.receive(selected, window, cx))
                                }).and_then(|result| result);
                                continue;
                            }
                            if app_install {
                                apps().command(serde_json::json!({"action":"apps_install","path":path}));
                                continue;
                            }
                            let command = if icon_theme {
                                serde_json::json!({"method":"icons","action":"install","request_id":"icons","path":path})
                            } else if file_document {
                                serde_json::json!({"method":"documents","action":"open","request_id":"open-file","path":path})
                            } else if workspace {
                                serde_json::json!({"action":"workspace","path":path})
                            } else if typed_context {
                                serde_json::json!({"action":"resolve_context","request_id":event.data["request_id"],"kind":context_kind,"source":path})
                            } else {
                                serde_json::json!({"action":"attach_files","paths":paths})
                            };
                            let _ = session_command(&command.to_string());
                        }
                    }
                } else if let Err(error) = window.update(cx, |_, window, cx| {
                    view.update(cx, |view, cx| view.receive(event, window, cx))
                }).and_then(|result| result) {
                    eprintln!("Native UI delivery: {error}");
                    break;
                }
            }
        })
        .detach();
        apps().command(serde_json::json!({"action":"apps_list"}));
        let _ = commands.send(serde_json::json!({"action":"local_worker_init"}).to_string());
        let _ = commands.send(serde_json::json!({"method":"settings.workbench.get"}).to_string());
        let _ = commands.send(serde_json::json!({"action":"list_agents"}).to_string());
        cx.on_window_closed(move |cx, closed| {
            if closed == window.window_id() {
                cx.quit();
            }
        })
        .detach();
        if !app_probe { cx.activate(true); }
    });
    Ok(())
}

const BROWSER: &str = "Could not open the browser. Retry GitHub sign-in.";

fn open_browser(url: &str) -> Result<(), String> {
    if !browser_target(url) {
        return Err(browser_error(url));
    }
    let status = Command::new(if cfg!(target_os = "macos") {
        "/usr/bin/open"
    } else {
        "xdg-open"
    })
    .arg(url)
    .status()
    .map_err(|_| browser_error(url))?;
    if status.success() {
        Ok(())
    } else {
        Err(browser_error(url))
    }
}

fn browser_error(url: &str) -> String {
    if url.contains("/connect/desktop") {
        BROWSER.into()
    } else {
        "Could not open the browser.".into()
    }
}

fn browser_target(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or("");
    let login = parsed.path().starts_with("/connect/desktop");
    let local = matches!(host, "127.0.0.1" | "localhost" | "::1");
    let help = host == "cli.github.com"
        && parsed.path() == "/"
        && parsed.query().is_none()
        && parsed.fragment().is_none();
    let secure = parsed.scheme() == "https" || (parsed.scheme() == "http" && local && login);
    secure
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && (login || host == "github.com" || help)
}

#[cfg(test)]
mod tests {
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
        let app = temp.join("Pero Native.app");
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
        assert!(
            !std::fs::read_to_string(bare.join("Contents/Info.plist"))
                .unwrap()
                .contains("CFBundleIconFile")
        );
        std::fs::remove_dir_all(&temp).unwrap();
    }
}

#[cfg(target_os = "macos")]
fn relaunch_in_bundle() {
    use std::os::unix::process::CommandExt;
    if std::env::var_os("PERO_NATIVE_BUNDLED").is_some() {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    if exe
        .components()
        .any(|part| part.as_os_str().to_string_lossy().ends_with(".app"))
    {
        return;
    }
    let Some(dir) = exe.parent() else { return };
    let app = dir.join("Pero Native.app");
    let bundled = app.join("Contents/MacOS/pero-native");
    let icon = std::env::var_os("PERO_NATIVE_ICON")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
        .or_else(|| {
            let sibling = dir.join("AppIcon.icns");
            sibling.is_file().then_some(sibling)
        });
    let staged = stage_native_bundle(&exe, &app, icon.as_deref());
    if let Err(error) = staged {
        eprintln!("Native preview cannot receive the GitHub return link: {error}");
        return;
    }
    let _ = Command::new("/usr/bin/codesign")
        .args(["--force", "--sign", "-", app.to_string_lossy().as_ref()])
        .status();
    let register = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
    let _ = Command::new(register)
        .args(["-f", app.to_string_lossy().as_ref()])
        .status();
    let error = Command::new(&bundled)
        .env("PERO_NATIVE_BUNDLED", "1")
        .exec();
    eprintln!("Could not switch to the native app bundle: {error}");
}

#[cfg(target_os = "macos")]
fn stage_native_bundle(
    exe: &std::path::Path,
    app: &std::path::Path,
    icon: Option<&std::path::Path>,
) -> std::io::Result<()> {
    let macos = app.join("Contents/MacOS");
    std::fs::create_dir_all(&macos)?;
    let mut plist = BUNDLE_PLIST.to_string();
    if let Some(icon) = icon.filter(|path| path.is_file()) {
        let resources = app.join("Contents/Resources");
        std::fs::create_dir_all(&resources)?;
        std::fs::copy(icon, resources.join("AppIcon.icns"))?;
        plist = plist.replacen(
            "<key>CFBundlePackageType</key>",
            "<key>CFBundleIconFile</key><string>AppIcon.icns</string>\n<key>CFBundlePackageType</key>",
            1,
        );
    }
    std::fs::write(app.join("Contents/Info.plist"), plist)?;
    std::fs::copy(exe, macos.join("pero-native"))?;
    Ok(())
}

#[cfg(target_os = "macos")]
const BUNDLE_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.openpero.native-preview</string>
<key>CFBundleName</key><string>Pero Native</string>
<key>CFBundleDisplayName</key><string>Pero Native Preview</string>
<key>CFBundleExecutable</key><string>pero-native</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleShortVersionString</key><string>0.1.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>Pero Desktop</string>
<key>CFBundleURLSchemes</key><array><string>pero</string></array>
</dict></array>
</dict></plist>
"#;
