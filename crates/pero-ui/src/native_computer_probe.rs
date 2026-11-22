//! Opt-in product acceptance using the real Native settings and Chat owners.
use crate::{app::Workbench, settings_section::SettingsSection};
use gpui_kit::*;
use pero_contracts::computer_runtime::ComputerControl;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

const PROMPT: &str = "Use the Computer Use MCP tool only, and tool_search only if needed to discover mcp__pero-app-use__computer_use. This is acceptance on a disposable, owned AppKit window titled exactly Pero Computer Fixture. You may call status and targets to locate it. Do not observe or alter any other target. Observe that exact window (include screenshot; do not request AX-only). Confirm that a screenshot receipt with an ID and pixel dimensions is returned. Use the accessibility element named Increment and click it once with background delivery, a fresh observation ID and a unique request ID. After the click, observe the same window again with screenshot and verify Count: 1 through its accessibility value. If any step fails, report the specific tool error and stop. Do not use the shell, files or other tools. If the screenshot receipts and verified count are present, reply PERO_NATIVE_COMPUTER_OK plus both screenshot IDs and count. Report receipt metadata and accessibility values only.";

pub(crate) async fn verify(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<Value> {
    let workspace = std::env::var("PERO_COMPUTER_PROBE_WORKSPACE")?;
    let mut initial_status = None;
    let started = Instant::now();
    let mut settings_opened = false;
    let mut enabling = false;
    let mut submitted = false;
    let mut stopping = false;
    let mut last_chat = Value::Null;
    while started.elapsed() < Duration::from_secs(190) {
        let result = window.update(cx, |_, window, cx| root.update(cx, |root, cx| {
            let status = root.computer.as_ref().map(|state| (state.status.available, state.enabled, state.error.clone()));
            let chat = root.chat.read(cx);
            if !settings_opened && chat.connected && chat.agents.iter().any(|agent| agent.id == "pero" && agent.available) {
                root.show_settings(SettingsSection::Computer, window, cx);
                settings_opened = true;
            }
            if let (Some(panel), Some((true, false, _))) = (root.settings_panel.clone(), &status) {
                if !enabling {
                    let driver = &root.computer.as_ref().unwrap().status;
                    initial_status = Some(driver.clone());
                    panel.update(cx, |panel, cx| panel.computer_control(ComputerControl::Set { enabled: true }, cx));
                    enabling = true;
                }
            }
            if !submitted && enabling && matches!(status, Some((true, true, _))) {
                root.close_settings(window, cx);
                root.chat.update(cx, |chat, _| chat.workspace = workspace.clone());
                root.new_chat(cx);
                submitted = root.chat.update(cx, |chat, cx| chat.submit_prompt(PROMPT.into(), Vec::new(), cx));
                anyhow::ensure!(submitted, "Native Chat did not accept the Computer Use prompt");
            }
            if submitted {
                let snapshot = root.chat.read(cx).snapshot(cx);
                if let Some(chat) = snapshot["activeChat"].as_u64().and_then(|index| snapshot["chats"].get(index as usize)) {
                    last_chat = chat.clone();
                    anyhow::ensure!(chat["agent"] == "pero", "Wrong Agent: {}", chat["agent"]);
                    let messages = chat["messages"].as_array().map(|messages| messages.iter().filter(|message| message["role"] == "assistant")
                        .filter_map(|message| message["text"].as_str()).collect::<Vec<_>>().join(" "));
                    if chat["state"] == "idle" && messages.as_ref().is_some_and(|text| !text.is_empty()) {
                        if !stopping {
                            root.show_settings(SettingsSection::Computer, window, cx);
                        }
                        if let Some(panel) = root.settings_panel.clone() {
                            if !stopping {
                                panel.update(cx, |panel, cx| panel.computer_control(ComputerControl::Stop {}, cx));
                                stopping = true;
                            }
                        }
                        if stopping && matches!(status, Some((true, false, _))) {
                            return Ok(Some(json!({"agent":chat["agent"],"model":chat["model"],"thread":chat["id"],"mcp":chat["mcp"],
                                "tools":chat["tools"],"reply":messages,"settingsEnabledAndStopped":true,"initialStatus":initial_status})));
                        }
                    }
                    anyhow::ensure!(chat["state"] != "closed", "Native Chat closed: {}", chat["error"]);
                }
            }
            Ok::<_, anyhow::Error>(None)
        }))?;
        if let Some(value) = result? {
            return Ok(value);
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
    }
    let status = cx.update(|cx| root.read(cx).computer.clone());
    anyhow::bail!("Native Computer Use timed out, state: {status:?}, chat: {last_chat}");
}
