//! Actual Native App/Host/credential/ACP acceptance; compiled only for probes.
use crate::{app::Workbench, native_app_probe::query};
use gpui_kit::*;
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};

pub(crate) fn attach(
    root: Entity<Workbench>,
    window: AnyWindowHandle,
    receipt: PathBuf,
    cx: &mut App,
) {
    cx.spawn(async move |cx| {
        let cleanup = std::env::args().nth(3).as_deref() == Some("cleanup");
        let restoring = std::env::args().nth(3).as_deref() == Some("restore");
        let mut outcome = if cleanup {
            clear_fixture(cx)
                .await
                .map(|_| json!({"passed":true,"cleanup":true}))
        } else {
            verify(&root, window, cx).await
        };
        if !cleanup && (restoring || outcome.is_err()) {
            if let Err(error) = clear_fixture(cx).await {
                outcome = Err(error);
            }
        }
        let value = match outcome {
            Ok(value) => value,
            Err(error) => json!({"passed":false,"error":error.to_string()}),
        };
        let _ = std::fs::write(receipt, serde_json::to_vec_pretty(&value).unwrap());
        cx.update(|cx| cx.quit());
    })
    .detach();
}

async fn clear_fixture(cx: &mut AsyncApp) -> anyhow::Result<()> {
    let apps = cx.update(|_| crate::native::apps());
    cx.background_spawn(async move {
        for _ in 0..50 {
            let response = apps.serve(
                "connectors",
                wry::http::Request::builder()
                    .method("POST")
                    .uri("pero-app://connectors/host/connectors")
                    .body(br#"{"operation":"secret.delete","reference":"fixture.native"}"#.to_vec())
                    .unwrap(),
            );
            let value: Value = serde_json::from_slice(response.body())?;
            if value["code"] == "MCP_CONTROL_BUSY" {
                std::thread::sleep(Duration::from_millis(20));
                continue;
            }
            anyhow::ensure!(
                response.status().is_success() && value["ok"] == true,
                "Fixture credential cleanup: {value}"
            );
            return Ok(());
        }
        anyhow::bail!("Fixture credential cleanup stayed busy")
    })
    .await
}

async fn verify(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<Value> {
    let fixture = std::env::var("PERO_CONNECTORS_FIXTURE")?;
    let cards: usize = std::env::var("PERO_CONNECTORS_CARDS")?.parse()?;
    let capture = PathBuf::from(std::env::var("PERO_CONNECTORS_CAPTURE")?);
    let restoring = std::env::args().nth(3).as_deref() == Some("restore");
    let mut stage = 0;
    let mut result = Value::Null;
    let mut thread = String::new();
    for _ in 0..600 {
        match stage {
            0 if cx.update(|cx| root.read(cx).apps.contains_panel("connectors", "main")) => {
                cx.update(|cx| {
                    root.update(cx, |root, cx| {
                        root.open_app("connectors".into(), "main".into(), cx)
                    })
                });
                stage = 1;
            }
            1 if cx.update(|cx| {
                root.read(cx)
                    .native_app_pages
                    .contains_key(&("connectors".into(), "main".into()))
            }) =>
            {
                let ready = query(
                    root,
                    "connectors",
                    "!!document.querySelector('.point-connectors-tile')",
                    cx,
                )
                .await;
                if ready.as_ref().is_ok_and(|ready| ready == true) {
                    let script = format!(
                        "(()=>{{window.nativeFixture={};window.nativeRestore={};window.nativeCardCount={cards};{};return true}})()",
                        json!(fixture),
                        restoring,
                        include_str!("../../../tests/fixtures/native-connectors.js")
                    );
                    query(root, "connectors", &script, cx).await?;
                    stage = 2;
                }
            }
            2 => {
                let value = query(root, "connectors", "window.nativeConnectors", cx).await?;
                anyhow::ensure!(value["error"].is_null(), "Native Connectors UI: {value}");
                if value["passed"] == true {
                    result = value;
                    anyhow::ensure!(
                        result["bridge"] == "undefined",
                        "App acquired Workbench bridge"
                    );
                    let apps = cx.update(|_| crate::native::apps());
                    let denied = cx
                        .background_spawn(async move {
                            apps.serve(
                                "insights",
                                wry::http::Request::builder()
                                    .method("POST")
                                    .uri("pero-app://insights/host/connectors")
                                    .body(b"{}".to_vec())
                                    .unwrap(),
                            )
                            .status()
                            .as_u16()
                        })
                        .await;
                    anyhow::ensure!(denied == 403, "An ungranted App reached Connectors");
                    thread = format!(
                        "native-connectors-{}",
                        if restoring { "restart" } else { "initial" }
                    );
                    crate::native::send_probe(
                        &json!({"action":"new_session","thread_id":thread,"agent_id":"codex"})
                            .to_string(),
                    )
                    .map_err(anyhow::Error::msg)?;
                    stage = 3;
                }
            }
            3 if capture.with_extension("ready").is_file() => {
                crate::native::send_probe(&json!({"action":"prompt","thread_id":thread,"text":"Call the synthetic connector counter"}).to_string()).map_err(anyhow::Error::msg)?;
                stage = 4;
            }
            4 if capture.is_file() => {
                let called: Value = serde_json::from_slice(&std::fs::read(&capture)?)?;
                anyhow::ensure!(
                    called["passed"] == true,
                    "ACP connector call failed: {called}"
                );
                cx.update(|cx| {
                    root.update(cx, |root, cx| {
                        root.preferences.appearance = pero_contracts::workbench::Appearance::Dark;
                        root.install_appearance(cx);
                        root.locale = "zh-CN".into();
                        root.sync_native_apps(cx);
                    })
                });
                window.update(cx, |_, window, _| window.resize(size(px(1000.), px(720.))))?;
                stage = 5;
            }
            5 => {
                let value = query(root, "connectors", "({dark:document.documentElement.style.colorScheme,locale:document.documentElement.lang,overflow:document.documentElement.scrollWidth>innerWidth+1,add:[...document.querySelectorAll('button')].some(b=>b.textContent==='添加自定义 MCP')})", cx).await?;
                if value["dark"] == "dark" && value["add"] == true {
                    anyhow::ensure!(
                        value["overflow"] == false,
                        "Narrow Native overflow: {value}"
                    );
                    stage = 6;
                }
            }
            6 => {
                return Ok(
                    json!({"passed":true,"restored":restoring,"app":result,"acp_call":true,"dark_zh_narrow":true}),
                );
            }
            _ => {}
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
    }
    anyhow::bail!("Native Connectors acceptance timed out at stage {stage}: {result}")
}
