//! Drives Browser Use through real Native Chat and the ACP session's MCP connection.
use crate::{app::Workbench, workspace::WorkspaceItem};
use gpui_kit::*;
use pero_contracts::{
    context::{ContextContent, ContextKind, ContextReference},
    web_document::WebLoad,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Turn {
    commands: Vec<Value>,
    #[serde(default)]
    permission: Option<Permission>,
    #[serde(default)]
    attachments: bool,
    #[serde(default)]
    check_catalog: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Permission {
    Allow,
    Revoke,
}

pub(crate) async fn verify(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<Value> {
    let url = std::env::var("PERO_NATIVE_BROWSER_PROBE_URL")?;
    if let Ok(prompt) = std::env::var("PERO_NATIVE_REPL_PROBE_PROMPT") {
        return verify_repl_agent(root, window, cx, &url, prompt).await;
    }
    let turns: Vec<Turn> =
        serde_json::from_str(&std::env::var("PERO_NATIVE_BROWSER_PROBE_TURNS")?)?;
    let workspace = std::env::var("PERO_NATIVE_BROWSER_PROBE_WORKSPACE")?;
    let started = Instant::now();
    let mut chat_created = false;
    let mut sent = 0;
    let mut duplicate = None;
    let mut checking_catalog = false;
    let mut last = Value::Null;
    let mut surface = String::new();
    while started.elapsed() < Duration::from_secs(60) {
        let complete = window.update(cx, |_, window, cx| root.update(cx, |root, cx| {
            let chat = root.chat.read(cx);
            if !chat_created && chat.connected && chat.agents.iter().any(|agent| agent.id == "browser-use-fixture" && agent.available) {
                root.chat.update(cx, |chat, _| chat.workspace = workspace.clone());
                root.new_chat(cx);
                chat_created = true;
            }
            let snapshot = root.chat.read(cx).snapshot(cx);
            let Some(chat) = snapshot["activeChat"].as_u64().and_then(|index| snapshot["chats"].get(index as usize)) else {
                return Ok(None);
            };
            last = json!({"state":chat["state"],"error":chat["error"],"messageCount":chat["messages"].as_array().map(Vec::len)});
            anyhow::ensure!(chat["state"] != "closed", "Native Chat closed: {}", chat["error"]);
            if sent == 0 && chat["state"] == "idle"
                && !matches!(root.navigation.current(), Some(WorkspaceItem::Web(id)) if id == &url) {
                root.web_command(json!({"action":"web_open","url":url}), window, cx);
            }
            let replies: Vec<_> = chat["messages"].as_array().into_iter().flatten().filter_map(|message| {
                (message["role"] == "assistant").then(|| message["text"].as_str())??
                    .strip_prefix("BROWSER_RESULT:").and_then(|text| serde_json::from_str::<Value>(text).ok())
            }).collect();
            if chat["state"] != "idle" || replies.len() != sent { return Ok(None); }
            if let Some(error) = replies.last().and_then(|result| result["error"].as_str()) {
                anyhow::bail!("Fixture failed on turn {sent}: {error}");
            }
            let Some(turn) = turns.get(sent) else {
                return Ok(Some(json!({"passed":true,"thread":chat["id"],"mcp":chat["mcp"],"replies":replies})));
            };
            surface = format!("{:?}; {:?}", root.navigation.current(),
                root.web_documents.iter().map(|page| (&page.id, &page.observation.load)).collect::<Vec<_>>());
            let Some(WorkspaceItem::Web(tab)) = root.navigation.current().cloned() else { return Ok(None) };
            let page = root.native_web_pages.get(&tab).map(|page| page.view.read(cx));
            surface += &format!("; layout visible={}, raw view={:?}, modal={}",
                root.layout.embedded_surface_visible,
                page.map(|page| (page.visible(cx), page.browser_engine(cx).is_ok_and(|(engine, _)| crate::native_browser::window_visible(engine)))),
                root.native_window_modal(cx).is_some());
            let ready = page.is_some_and(|page| page.browser_view(cx).is_ok() || matches!(
                (&turn.permission, &page.document.observation.load), (Some(Permission::Revoke), WebLoad::Failed(_))));
            if !ready { return Ok(None); }
            if tab.starts_with("web-tab:") { duplicate = Some(tab.clone()); }
            if checking_catalog {
                let picker = &snapshot["completion"];
                last["picker"] = picker.clone();
                if picker["open"] != true || picker["loading"] == true { return Ok(None); }
                let targets = picker["items"].as_array().ok_or_else(|| anyhow::anyhow!("Missing native composer items"))?;
                anyhow::ensure!(targets.iter().filter_map(Value::as_str).any(|item| item.starts_with("Browser Use · ")),
                    "The native composer did not discover the authorized tab: {picker}");
                let input = root.chat.read(cx).composer.clone();
                input.update(cx, |editor, cx| editor.set_value("", window, cx));
                checking_catalog = false;
            } else {
                match turn.permission {
                    Some(Permission::Allow) => {
                        // Supply the consent decision at the product's grant boundary.
                        anyhow::ensure!(root.native_browser_allow(&tab, cx), "Native could not approve a visible Web tab");
                        if turn.check_catalog {
                            let input = root.chat.read(cx).composer.clone();
                            input.update(cx, |editor, cx| { editor.focus(window, cx); editor.insert("@browser", window, cx); });
                            checking_catalog = true;
                            return Ok(None);
                        }
                    }
                    Some(Permission::Revoke) => {
                        anyhow::ensure!(root.native_browser_granted(&tab, cx), "Expected a live grant before revoke");
                        root.native_browser_toggle(&tab, window, cx);
                    }
                    None => {}
                }
            }
            let mut commands = turn.commands.clone();
            for command in &mut commands {
                match command["tabId"].as_str() {
                    Some("$first") => command["tabId"] = json!(url),
                    Some("$duplicate") => command["tabId"] = json!(duplicate.as_ref().ok_or_else(|| anyhow::anyhow!("Independent Web tab did not open: {:?}", replies.last()))?),
                    _ => {}
                }
            }
            let attachments = if turn.attachments {
                [("alfa.txt", "First file"), ("beta.txt", "Second file")].into_iter()
                    .map(|(name, text)| ContextReference {
                        id: format!("file:{name}"), kind: ContextKind::File, label: name.into(),
                        source: name.into(), content: ContextContent::Text { text: text.into() },
                    }).collect()
            } else { Vec::new() };
            let text = serde_json::to_string(&commands)?;
            anyhow::ensure!(root.chat.update(cx, |chat, cx| chat.submit_prompt(text, attachments, cx)),
                "Native Chat could not submit the Browser Use prompt");
            sent += 1;
            Ok::<_, anyhow::Error>(None)
        }))??;
        if let Some(result) = complete {
            return Ok(result);
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
    }
    anyhow::bail!("Native Browser Use timed out after {sent} turns: {surface}; {last}");
}

async fn verify_repl_agent(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
    url: &str,
    prompt: String,
) -> anyhow::Result<Value> {
    let agent = std::env::var("PERO_NATIVE_REPL_PROBE_AGENT")?;
    let workspace = std::env::var("PERO_NATIVE_BROWSER_PROBE_WORKSPACE")?;
    let pairing_path = std::env::var_os("PERO_NATIVE_REPL_CHROME_PAIRING_PATH")
        .map(std::path::PathBuf::from);
    let mut pair_requested = false;
    let started = Instant::now();
    let mut chat_created = false;
    let mut sent = false;
    let mut last = Value::Null;
    while started.elapsed() < Duration::from_secs(180) {
        let mut pair_thread = None;
        let complete = window.update(cx, |_, window, cx| root.update(cx, |root, cx| {
            let chat = root.chat.read(cx);
            if !chat_created && chat.connected && chat.agents.iter().any(|entry| entry.id == agent && entry.available) {
                root.chat.update(cx, |chat, _| chat.workspace = workspace.clone());
                root.new_chat(cx);
                chat_created = true;
            }
            let snapshot = root.chat.read(cx).snapshot(cx);
            let Some(chat) = snapshot["activeChat"].as_u64().and_then(|index| snapshot["chats"].get(index as usize)) else {
                return Ok(None);
            };
            last = json!({"agent":chat["agent"], "state":chat["state"], "error":chat["error"],
                "tools":chat["tools"].as_array().into_iter().flatten().map(|tool| (&tool["title"], &tool["status"])).collect::<Vec<_>>()});
            anyhow::ensure!(chat["agent"] == agent, "Native REPL selected a different Agent: {last}");
            anyhow::ensure!(chat["state"] != "closed", "Native Chat closed: {last}");
            if chat["state"] != "idle" { return Ok(None); }
            if sent {
                let reply = chat["messages"].as_array().into_iter().flatten()
                    .filter(|message| message["role"] == "assistant")
                    .filter_map(|message| message["text"].as_str()).collect::<Vec<_>>().join("\n");
                if !reply.is_empty() || !chat["error"].is_null() {
                    return Ok(Some(json!({"agent":chat["agent"], "model":chat["model"], "thread":chat["id"],
                        "mcp":chat["mcp"], "tools":chat["tools"], "reply":reply, "error":chat["error"]})));
                }
                return Ok(None);
            }
            if let Some(pairing) = &pairing_path {
                if !pair_requested {
                    pair_thread = root.browser_thread(cx);
                    return Ok(None);
                }
                if !pairing.with_extension("ready").is_file() {
                    return Ok(None);
                }
            } else {
                if !matches!(root.navigation.current(), Some(WorkspaceItem::Web(id)) if id == url) {
                    root.web_command(json!({"action":"web_open","url":url}), window, cx);
                    return Ok(None);
                }
                if !root.native_web_pages.get(url).is_some_and(|page| page.view.read(cx).browser_view(cx).is_ok()) {
                    return Ok(None);
                }
                anyhow::ensure!(root.native_browser_allow(url, cx), "Native could not approve the visible fixture tab");
            }
            anyhow::ensure!(root.chat.update(cx, |chat, cx| chat.submit_prompt(prompt.clone(), Vec::new(), cx)),
                "Native Chat could not submit the REPL acceptance prompt");
            sent = true;
            Ok::<_, anyhow::Error>(None)
        }))??;
        if let Some(result) = complete {
            return Ok(result);
        }
        if let (Some(thread), Some(path)) = (pair_thread, pairing_path.as_ref()) {
            let owner = crate::native::chrome_relay_owner()
                .ok_or_else(|| anyhow::anyhow!("Native Chrome Relay is unavailable"))?;
            let path = path.clone();
            cx.background_executor().spawn(async move {
                let value = owner.request(json!({
                    "operation":"chrome-relay-pair", "thread":thread, "label":"Native Chrome acceptance"
                }))?;
                anyhow::ensure!(value["ok"] == true, "Could not pair Native Chrome: {}", value["message"]);
                let code = value["code"].as_str().ok_or_else(|| anyhow::anyhow!("Missing Chrome pairing code"))?;
                std::fs::write(path, code)?;
                Ok::<_, anyhow::Error>(())
            }).await?;
            pair_requested = true;
        }
        cx.background_executor().timer(Duration::from_millis(100)).await;
    }
    anyhow::bail!("Native real Agent REPL timed out (prompt submitted: {sent}): {last}");
}
