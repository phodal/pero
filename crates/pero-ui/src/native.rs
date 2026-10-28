//! Native developer preview: shared GPUI workbench and the existing stdio Host.
//! Cloud/OAuth remain in the Electron shell and are explicitly unavailable here.
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
    static COMMANDS: RefCell<Option<mpsc::Sender<String>>> = const { RefCell::new(None) };
}

pub(crate) fn session_command(json: &str) -> Result<(), String> {
    COMMANDS.with(|slot| {
        slot.borrow()
            .as_ref()
            .ok_or("Native Host is unavailable")?
            .send(json.to_string())
            .map_err(|error| error.to_string())
    })
}
pub(crate) fn send_probe(json: &str) -> Result<(), String> {
    session_command(json)
}
pub(crate) fn request_locale(locale: &str) -> Result<(), String> {
    session_command(&serde_json::json!({"method":"settings.locale","locale":locale}).to_string())
}

pub fn run() -> anyhow::Result<()> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let data = std::env::var_os("PERO_NATIVE_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".pero/native-preview")
        });
    std::fs::create_dir_all(&data)?;
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
    let mut host = Command::new(executable)
        .arg("--stdio")
        .current_dir(&root)
        .env("PERO_AGENT_ROOT", &root)
        .env("PATH", std::env::join_paths(paths)?)
        .env("PERO_LOCALE", &locale)
        .env("PERO_SETTINGS_PATH", data.join("settings.json"))
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
    let reader_events = events.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            match serde_json::from_str::<HostEvent>(&line) {
                Ok(event) if event.version == pero_contracts::PROTOCOL_VERSION => {
                    if reader_events.send_blocking(event).is_err() {
                        break;
                    }
                }
                _ => eprintln!("Invalid native Host event"),
            }
        }
        let _ = reader_events.send_blocking(HostEvent::message(
            "disconnected",
            None,
            "error.host_stopped",
        ));
    });
    std::thread::spawn(move || {
        for json in incoming {
            let Ok(value) = serde_json::from_str::<serde_json::Value>(&json) else {
                continue;
            };
            let action = value["action"].as_str().unwrap_or_default();
            if action.starts_with("remote_") {
                let mut event = HostEvent::new("remote_state", None, String::new());
                event.data = serde_json::json!({"configured":false,"loading":false,"tasks":[],"workers":[],
                    "error":"Native preview: cloud connection and GitHub login are not connected yet."});
                let _ = events.send_blocking(event);
            } else if matches!(action, "choose_workspace" | "choose_context") {
                let _ = events.send_blocking(HostEvent::new(
                    &format!("native_{action}"),
                    None,
                    String::new(),
                ));
            } else if writeln!(stdin, "{json}")
                .and_then(|_| stdin.flush())
                .is_err()
            {
                break;
            }
        }
        drop(stdin);
        let _ = host.wait();
    });
    let palettes: Palettes =
        serde_json::from_str(include_str!("../../../web/src/theme.generated.json"))?;
    gpui_kit::application()
        .with_assets(crate::assets::UiAssets)
        .run(move |cx| {
            cx.text_system()
                .add_fonts(vec![
                    std::borrow::Cow::Borrowed(
                        include_bytes!("../../../web/public/fonts/Workbench-regular.ttf")
                            .as_slice(),
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
            palettes.apply(false, cx);
            let options = WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1440.), px(960.)),
                    cx,
                ))),
                window_min_size: Some(size(px(1000.), px(680.))),
                ..Default::default()
            };
            let (_, view) = gpui_kit::open_window(options, cx, move |window, cx| {
                window.set_window_title("Pero Native Preview — local sessions");
                cx.new(|cx| {
                    let mut view = Workbench::new(palettes, false, locale, window, cx);
                    view.navigation = 0;
                    view
                })
            })
            .expect("native workbench window");
            let view = view.downgrade();
            cx.spawn(async move |cx| {
                while let Ok(event) = received.recv().await {
                    if matches!(
                        event.kind.as_str(),
                        "native_choose_workspace" | "native_choose_context"
                    ) {
                        let directory = event.kind == "native_choose_workspace";
                        let paths = cx.update(|cx| {
                            cx.prompt_for_paths(PathPromptOptions {
                                files: !directory,
                                directories: directory,
                                multiple: !directory,
                                prompt: None,
                            })
                        });
                        if let Ok(Ok(Some(paths))) = paths.await {
                            let command = if directory {
                                serde_json::json!({"action":"workspace","path":paths[0]})
                            } else {
                                serde_json::json!({"action":"attach_files","paths":paths})
                            };
                            let _ = session_command(&command.to_string());
                        }
                    } else if let Err(error) = view.update(cx, |view, cx| view.receive(event, cx)) {
                        eprintln!("Native UI delivery: {error}");
                        break;
                    }
                }
            })
            .detach();
            let _ = commands.send(serde_json::json!({"action":"list_agents"}).to_string());
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
        });
    Ok(())
}
