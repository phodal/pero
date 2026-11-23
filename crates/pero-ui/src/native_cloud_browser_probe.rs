//! Opt-in Native Workbench probe. Answers at the confirmation boundary.
use crate::{app::Workbench, native};
use gpui_kit::*;
use serde_json::{Value, json};
use std::{path::Path, time::Duration};

async fn wait_for<T>(
    cx: &AsyncApp,
    description: &str,
    mut check: impl FnMut() -> anyhow::Result<Option<T>>,
) -> anyhow::Result<T> {
    for _ in 0..300 {
        if let Some(value) = check()? {
            return Ok(value);
        }
        cx.background_executor()
            .timer(Duration::from_millis(50))
            .await;
    }
    anyhow::bail!("Timed out waiting for {description}");
}

fn command(data: Value) -> anyhow::Result<()> {
    native::send_probe(&data.to_string()).map_err(anyhow::Error::msg)
}

fn write(file: &Path, data: &Value) -> anyhow::Result<()> {
    let temporary = file.with_extension("tmp");
    std::fs::write(&temporary, serde_json::to_vec(data)?)?;
    std::fs::rename(temporary, file)?;
    Ok(())
}

pub(super) async fn verify(root: &Entity<Workbench>, cx: &mut AsyncApp) -> anyhow::Result<Value> {
    let directory = std::env::var("PERO_NATIVE_CLOUD_BROWSER_FIXTURE")?;
    let directory = Path::new(&directory);
    let url = std::env::var("PERO_TEST_CLOUD_BROWSER_ORIGIN")?;
    anyhow::ensure!(
        reqwest::Url::parse(&url)?.host_str() == Some("127.0.0.1"),
        "Loopback fixture required"
    );
    let task_id = std::env::var("PERO_TEST_CLOUD_BROWSER_TASK")?;
    let run_id = std::env::var("PERO_TEST_CLOUD_BROWSER_RUN")?;
    let (send, events) = async_channel::unbounded();
    cx.update(|cx| root.update(cx, |view, _| view.remote.browser_share.probe = Some(send)));
    command(
        json!({"action":"remote_configure","url":url,"mode":"client",
        "token":std::env::var("PERO_TEST_CLOUD_BROWSER_CLIENT")?}),
    )?;
    let mut thread = None;
    for _ in 0..300 {
        thread = cx.update(|cx| {
            root.update(cx, |view, cx| {
                if view.chat.read(cx).connected && view.remote.configured() && view.remote.client()
                {
                    if view.browser_thread(cx).is_none() {
                        view.new_chat(cx);
                    }
                    return view.browser_thread(cx);
                }
                None
            })
        });
        if thread.is_some() {
            break;
        }
        cx.background_executor()
            .timer(Duration::from_millis(50))
            .await;
    }
    let thread = thread
        .ok_or_else(|| anyhow::anyhow!("Native connection or ordinary Chat did not start"))?;
    let owner = cx
        .update(|_| native::chrome_relay_owner())
        .ok_or_else(|| anyhow::anyhow!("Native connector is unavailable"))?;
    let ticket = cx.background_executor().spawn(async move {
        owner.request(json!({"operation":"chrome-relay-pair","thread":thread,"label":"Cloud Browser fixture"}))
    }).await?;
    anyhow::ensure!(
        ticket["ok"] == true,
        "Pairing failed: {}",
        ticket["message"]
    );
    write(&directory.join("ticket.json"), &ticket)?;
    let paired = directory.join("chrome-paired");
    wait_for(cx, "Chrome pairing", || Ok(paired.exists().then_some(()))).await?;
    cx.update(|cx| root.update(cx, |view, cx| view.open_task(task_id.clone(), cx)));
    let mut ready = false;
    for _ in 0..300 {
        ready = cx.update(|cx| root.read(cx).remote.data["detail"]["run"]["id"] == run_id);
        if ready {
            break;
        }
        cx.background_executor()
            .timer(Duration::from_millis(50))
            .await;
    }
    anyhow::ensure!(ready, "Native did not select the running Cloud task");
    for decision in ["deny", "changed", "approve"] {
        let prepare = directory.join(format!("prepare-{decision}"));
        wait_for(cx, "Chrome and prepare signal", || {
            Ok(prepare.exists().then_some(()))
        })
        .await?;
        cx.update(|cx| {
            root.update(cx, |view, cx| {
                view.request_cloud_browser(&task_id, false, cx)
            })
        });
        let consent = wait_for(cx, "Cloud share confirmation", || {
            Ok(events.try_recv().ok())
        })
        .await?;
        anyhow::ensure!(
            consent["state"] == "confirm",
            "Confirmation failed: {consent}"
        );
        write(
            &directory.join(format!("confirm-{decision}.json")),
            &consent,
        )?;
        let answer = directory.join(decision);
        wait_for(cx, "confirmation answer", || {
            Ok(answer.exists().then_some(()))
        })
        .await?;
        command(if decision != "deny" {
            json!({"action":"remote_browser_approve","id":consent["id"]})
        } else {
            json!({"action":"remote_browser_dismiss"})
        })?;
        let state = wait_for(cx, "confirmation outcome", || Ok(events.try_recv().ok())).await?;
        let expected = match decision {
            "approve" => "sharing",
            "changed" => "error",
            _ => "idle",
        };
        anyhow::ensure!(
            state["state"] == expected,
            "Unexpected Cloud share outcome: {state}"
        );
        if decision == "changed" {
            anyhow::ensure!(
                state["key"] == "browser_use.cloud_tab_changed",
                "Wrong reason for refusing to share a different Chrome tab: {state}"
            );
        }
        write(&directory.join(format!("done-{decision}.json")), &state)?;
    }
    let stop = directory.join("stop");
    wait_for(cx, "stop signal", || Ok(stop.exists().then_some(()))).await?;
    cx.update(|cx| {
        root.update(cx, |view, cx| {
            view.request_cloud_browser(&task_id, true, cx)
        })
    });
    let state = wait_for(cx, "stream close", || {
        Ok(events
            .try_recv()
            .ok()
            .filter(|state| state["state"] == "closed"))
    })
    .await?;
    Ok(
        json!({"passed":true, "declined":true, "changedTabRefused":true,
        "shared":true, "stopped":state["state"] == "closed"}),
    )
}
