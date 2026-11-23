use super::{WebSourceTarget, Workbench};
use crate::projects::ProjectTab;
use gpui_kit::*;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

pub(crate) async fn verify(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<Value> {
    let origin = std::env::var("PERO_SHARED_SOURCES_ORIGIN")?;
    anyhow::ensure!(
        origin.starts_with("http://127.0.0.1:"),
        "Expected a loopback Cloud fixture"
    );
    let token = std::env::var("PERO_SHARED_SOURCES_CLIENT")?;
    let files = PathBuf::from(
        std::env::var_os("PERO_SHARED_SOURCES_FILES")
            .ok_or_else(|| anyhow::anyhow!("Missing fixture path"))?,
    );
    let phase = std::env::args().nth(4).unwrap_or_default();
    cx.update(|cx| {
        root.update(cx, |root, cx| {
            root.command(
                json!({"action":"remote_configure","url":origin,"token":token,"mode":"client"}),
                cx,
            );
        })
    });
    let mut opened = false;
    let mut asked = false;
    let mut paired = false;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(35) {
        let mut pair = None;
        let complete = window.update(cx, |_, window, cx| {
            root.update(cx, |root, cx| {
                if let Some(error) = root.remote.data["error"].as_str() {
                    anyhow::bail!("Fixture Cloud connection failed: {error}");
                }
                let Some(account) = root.remote.data["identity"]["id"]
                    .as_str()
                    .map(str::to_owned)
                else {
                    return Ok(None);
                };
                if phase == "write" {
                    if !opened
                        && root.chat.read(cx).connected
                        && !root.chat.read(cx).agents.is_empty()
                    {
                        root.new_chat(cx);
                        opened = true;
                    }
                    if !paired {
                        pair = root.browser_thread(cx);
                    } else if files.join("saved").is_file() {
                        return Ok(Some(json!({"passed":true,"account":account})));
                    }
                    return Ok(None);
                }
                anyhow::ensure!(phase == "read", "Unknown fixture phase");
                if !opened {
                    root.open_project("shared:lab".into(), window, cx);
                    root.select_project_view(ProjectTab::ResearchResources, cx);
                    opened = true;
                }
                let Some(target) = root
                    .shared_web_source_target(cx)
                    .map(WebSourceTarget::Shared)
                else {
                    return Ok(None);
                };
                let view = &root.research.web_sources;
                if let Some(error) = &view.error {
                    anyhow::bail!("Native Materials failed: {error}");
                }
                if let Some(source) = &view.preview {
                    let receipt = view
                        .sources
                        .iter()
                        .find(|entry| entry.id == source.source.capture().id);
                    return Ok(Some(
                        json!({"passed":true,"account":account,"receipt":receipt,"source":source}),
                    ));
                }
                if view.pending.is_none() {
                    if view.target.as_ref() != Some(&target) {
                        root.request_project_web_source(None, Some(target), cx);
                    } else if !asked {
                        let id = view
                            .sources
                            .first()
                            .ok_or_else(|| {
                                anyhow::anyhow!("Native shared Materials listed no sources")
                            })?
                            .id
                            .clone();
                        root.request_project_web_source(Some(id), Some(target), cx);
                        asked = true;
                    }
                }
                Ok::<_, anyhow::Error>(None)
            })
        })??;
        if let Some(receipt) = complete {
            return Ok(receipt);
        }
        if let Some(thread) = pair {
            let owner = crate::native::chrome_relay_owner()
                .ok_or_else(|| anyhow::anyhow!("Native Chrome Relay unavailable"))?;
            let files = files.clone();
            cx.background_executor().spawn(async move {
                let reply = owner.request(json!({"operation":"chrome-relay-pair","thread":thread,"label":"Project capture fixture"}))?;
                let code = reply["code"].as_str().ok_or_else(|| anyhow::anyhow!("Native Chrome pairing failed"))?;
                std::fs::write(files.join("pairing"), code)?;
                Ok::<_, anyhow::Error>(())
            }).await?;
            paired = true;
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
    }
    anyhow::bail!(
        "Native shared Project {phase} timed out (opened={opened}, paired={paired}, read requested={asked})"
    )
}
