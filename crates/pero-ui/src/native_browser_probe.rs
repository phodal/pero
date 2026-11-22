//! Drives Browser Use through real Native Chat and the ACP session's MCP connection.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::*;
use pero_contracts::context::{ContextContent, ContextKind, ContextReference};
use serde_json::{Value, json};
use std::time::{Duration, Instant};

pub(crate) async fn verify(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<Value> {
    let url = std::env::var("PERO_NATIVE_BROWSER_PROBE_URL")?;
    let commands = std::env::var("PERO_NATIVE_BROWSER_PROBE_COMMANDS")?;
    let workspace = std::env::var("PERO_NATIVE_BROWSER_PROBE_WORKSPACE")?;
    let started = Instant::now();
    let mut step = 0;
    let mut replies = Vec::new();
    let mut last = Value::Null;
    let mut surface = String::new();
    while started.elapsed() < Duration::from_secs(50) {
        let complete = window.update(cx, |_, window, cx| root.update(cx, |root, cx| {
            let chat = root.chat.read(cx);
            if step == 0 && chat.connected && chat.agents.iter().any(|agent| agent.id == "browser-use-fixture" && agent.available) {
                root.chat.update(cx, |chat, _| chat.workspace = workspace.clone());
                root.new_chat(cx);
                step = 1;
            }
            let snapshot = root.chat.read(cx).snapshot(cx);
            let Some(chat) = snapshot["activeChat"].as_u64().and_then(|index| snapshot["chats"].get(index as usize)) else {
                return Ok(None);
            };
            last = chat.clone();
            anyhow::ensure!(chat["state"] != "closed", "Native Chat closed: {}", chat["error"]);
            if step == 1 && chat["state"] == "idle"
                && !matches!(root.navigation.current(), Some(WorkspaceItem::Web(id)) if id == &url) {
                root.web_command(json!({"action":"web_open","url":url}), window, cx);
            }
            surface = format!("{:?} at {:?}; {:?}", root.navigation.current(), root.layout.embedded_surface_visible,
                root.web_documents.iter().map(|page| &page.observation.load).collect::<Vec<_>>());
            let Some(WorkspaceItem::Web(tab)) = root.navigation.current().cloned() else { return Ok(None) };
            let page = root.native_web_pages.get(&tab).map(|page| page.view.read(cx));
            let ready = page.is_some_and(|page| page.browser_view(cx).is_ok()
                || step >= 3 && matches!(page.document.observation.load, pero_contracts::web_document::WebLoad::Failed(_)));
            if !ready || chat["state"] != "idle" { return Ok(None); }
            let results: Vec<_> = chat["messages"].as_array().into_iter().flatten().filter_map(|message| {
                (message["role"] == "assistant").then(|| message["text"].as_str())??
                    .strip_prefix("BROWSER_RESULT:").and_then(|text| serde_json::from_str::<Value>(text).ok())
            }).collect();
            let status = r#"[{"action":"status"}]"#;
            let (text, files) = match step {
                1 => (status, Vec::new()),
                2 if results.len() == 1 => {
                    replies.push(results[0].clone());
                    // Supply the consent decision at the product's grant boundary.
                    anyhow::ensure!(root.native_browser_allow(&tab, cx), "Native could not approve visible Web tab");
                    let files = [("alfa.txt", "First file"), ("beta.txt", "Second file")].into_iter()
                        .map(|(name, text)| ContextReference {
                            id: format!("file:{name}"), kind: ContextKind::File, label: name.into(),
                            source: name.into(), content: ContextContent::Text { text: text.into() },
                        }).collect();
                    (commands.as_str(), files)
                }
                3 if results.len() == 2 => {
                    replies.push(results[1].clone());
                    if root.native_browser_granted(&tab, cx) {
                        root.native_browser_toggle(&tab, window, cx);
                    }
                    (status, Vec::new())
                }
                4 if results.len() == 3 => {
                    replies.push(results[2].clone());
                    return Ok(Some(json!({"passed":true,"thread":chat["id"],"mcp":chat["mcp"],"replies":replies})));
                }
                _ => return Ok(None),
            };
            anyhow::ensure!(root.chat.update(cx, |chat, cx| chat.submit_prompt(text.into(), files, cx)),
                "Native Chat could not submit the Browser Use prompt");
            step += 1;
            Ok::<_, anyhow::Error>(None)
        }))??;
        if let Some(result) = complete {
            return Ok(result);
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
    }
    anyhow::bail!("Native Browser Use timed out at step {step}: {surface}; {last}");
}
