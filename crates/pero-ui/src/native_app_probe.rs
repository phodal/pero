//! Opt-in acceptance against real App assets, stdio Host and Python backend.
use crate::{
    app::Workbench,
    workspace::{WorkbenchPage, WorkspaceItem},
};
use gpui_kit::*;
use serde_json::{Value, json};
use std::{path::PathBuf, time::Duration};

const START: &str = r#"(()=>{
 if(!document.querySelector('#app')?.innerText.trim())return false;
 window.nativeIdentity=crypto.randomUUID();
 const input=document.createElement('input');input.id='native-retained-draft';input.value='retained draft';document.body.append(input);
 window.nativeResult={pending:true};
 (async()=>{
  const get=async(path,body)=>{const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response.json();};
  const sample=await get('/api/example');
  const imported=await get('/api/inputs',{documents:[sample.content]});
  const output=await get('/api/execute',{inputId:imported.id,operation:'evaluate'});
  const refused=await fetch('pero-app://insights/dist/index.html').then(response=>response.ok,()=>false);
  const denied=await fetch('/host/insights',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  window.nativeResult={passed:output.operation==='evaluate'&&!!output.result&&!refused&&!denied.ok,identity:window.nativeIdentity,bridge:typeof window.pero,text:document.querySelector('#app').innerText.slice(0,200),result:output.operation};
 })().catch(error=>window.nativeResult={error:String(error)});
 return true;
})()"#;
const READ: &str = "({result:window.nativeResult,identity:window.nativeIdentity,draft:document.querySelector('#native-retained-draft')?.value,dark:document.documentElement.style.colorScheme,locale:document.documentElement.lang,mediaDark:matchMedia('(prefers-color-scheme: dark)').matches})";

pub(crate) fn attach(
    root: Entity<Workbench>,
    window: AnyWindowHandle,
    receipt: PathBuf,
    cx: &mut App,
) {
    cx.spawn(async move |cx| {
        let outcome = verify(&root, window, cx).await;
        let value = match outcome {
            Ok(value) => value,
            Err(error) => json!({"passed":false,"error":error.to_string()}),
        };
        let _ = std::fs::write(receipt, serde_json::to_vec_pretty(&value).unwrap());
        cx.update(|cx| cx.quit());
    })
    .detach();
}
pub(crate) async fn query(root: &Entity<Workbench>, name: &str, script: &str, cx: &mut AsyncApp) -> anyhow::Result<Value> {
    let (sender, receiver) = async_channel::bounded(1);
    cx.update(|cx| {
        let view=root.read(cx).native_app_pages.get(&(name.into(),"main".into())).ok_or_else(||anyhow::anyhow!("App not mounted"))?;
        view.view.read(cx).inspect(&format!("(()=>{{try{{return ({script});}}catch(error){{return {{scriptError:String(error)}};}}}})()"),cx,move|reply|{let _=sender.try_send(reply);})
    })?;
    let text = receiver.recv().await?;
    let value: Value = serde_json::from_str(&text)?;
    let value = if let Some(text) = value.as_str() {
        serde_json::from_str(text)?
    } else {
        value
    };
    anyhow::ensure!(
        value["scriptError"].is_null(),
        "Page script failed: {value}"
    );
    Ok(value)
}
async fn verify(
    root: &Entity<Workbench>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<Value> {
    let key = ("virtual-cell".into(), "main".into());
    let mut stage = 0;
    let mut identity = Value::Null;
    let mut result = Value::Null;
    let restoring=std::env::args().nth(3).as_deref()==Some("restore");
    for _ in 0..300 {
        match stage {
            0 => {
                let ready =
                    cx.update(|cx| root.read(cx).apps.contains_panel("virtual-cell", "main"));
                if ready {
                    if !restoring {
                        cx.update(|cx|root.update(cx,|root,cx|root.open_app("virtual-cell".into(),"main".into(),cx)));
                    }
                    stage = 1;
                }
            }
            1 => {
                if cx.update(|cx| root.read(cx).native_app_pages.contains_key(&key)) {
                    match query(root, "virtual-cell", START, cx).await {
                        Ok(value) if value == true => stage = 2,
                        Ok(value) => result = value,
                        Err(error) => result = json!({"queryError":error.to_string()}),
                    }
                }
            }
            2 => {
                let value = query(root, "virtual-cell", READ, cx).await?;
                anyhow::ensure!(
                    value["result"]["error"].is_null(),
                    "App operation failed: {}",
                    value
                );
                if value["result"]["passed"] == true {
                    anyhow::ensure!(
                        value["result"]["bridge"] == "undefined",
                        "App received the Workbench bridge"
                    );
                    identity = value["identity"].clone();
                    result = value["result"].clone();
                    cx.update(|cx| {
                        root.update(cx, |root, cx| {
                            root.navigate(WorkbenchPage::Projects, cx);
                            root.sync_app_surface(None, cx);
                            root.preferences.appearance =
                                pero_contracts::workbench::Appearance::Dark;
                            root.install_appearance(cx);
                            root.open_app("virtual-cell".into(), "main".into(), cx);
                            root.sync_native_apps(cx);
                        })
                    });
                    stage = 3;
                }
            }
            3 => {
                let value = query(root, "virtual-cell", READ, cx).await?;
                if value["dark"] == "dark" && value["mediaDark"] == true {
                    anyhow::ensure!(
                        value["identity"] == identity && value["draft"] == "retained draft",
                        "App reloaded after navigation: {value}"
                    );
                    let checkpoint=cx.update(|cx|root.update(cx,|root,cx|root.workspace_checkpoint(false,true,cx))).ok_or_else(||anyhow::anyhow!("Workspace checkpoint unavailable"))?;
                    let released = window.update(cx, |_, window, cx| {
                        root.update(cx, |root, cx| {
                            root.close_content(
                                &WorkspaceItem::App {
                                    name: "virtual-cell".into(),
                                    panel: "main".into(),
                                },
                                window,
                                cx,
                            );
                            root.sync_native_apps(cx);
                            root.native_app_pages.is_empty()
                        })
                    })?;
                    anyhow::ensure!(released, "App WebView was retained after tab close");
                    return Ok(
                        json!({"passed":true,"checks":["real React App assets","authenticated Python GET and POST","real synthetic evaluation","cross-App resource refusal","Host grant refusal","no Workbench bridge","retained DOM and form","SDK dark appearance","WebView teardown"],"app":result,"restored":restoring,"checkpoint":checkpoint,"visual_acceptance":false}),
                    );
                }
            }
            _ => unreachable!(),
        }
        cx.background_executor()
            .timer(Duration::from_millis(100))
            .await;
    }
    anyhow::bail!("Native App acceptance timed out at stage {stage}: {result}")
}
