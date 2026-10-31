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
        let outcome = if std::env::args().nth(3).as_deref()==Some("paper-chat") { verify_paper_chat(&root,window,cx).await } else { verify(&root, window, cx).await };
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
        view.view.read(cx).inspect(&format!("(()=>{{try{{return JSON.stringify(({script}),(_,value)=>{{if(typeof value==='number'&&!Number.isFinite(value))throw Error('Non-finite observation');return value;}})??'null';}}catch(error){{return JSON.stringify({{scriptError:String(error)}});}}}})()"),cx,move|reply|{let _=sender.try_send(reply);})
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

// One native shell wiring journey; scientific domain rules remain Python tests.
async fn verify_paper_chat(root:&Entity<Workbench>,window:AnyWindowHandle,cx:&mut AsyncApp)->anyhow::Result<Value>{
    let mut stage=0;
    let mut last=Value::Null;
    let mut logged=99;
    for _ in 0..400 {
        if logged!=stage { eprintln!("Native Paper acceptance stage {stage}"); logged=stage; }
        match stage {
            0=>{
                if cx.update(|cx|root.read(cx).apps.contains_panel("paper-agent","main")) {
                    cx.update(|cx|root.update(cx,|root,cx|root.open_app("paper-agent".into(),"main".into(),cx)));
                    stage=1;
                }
            }
            1=>{
                let ready=query(root,"paper-agent","!!document.querySelector('.pa-library-screen .pero-ui-page-header button')",cx).await.unwrap_or(Value::Null);
                if ready==true {
                    let pdf=std::fs::read(std::env::var("PERO_NATIVE_PAPER_PDF")?)?;
                    query(root,"paper-agent",&format!("window.paperProbePdf={}",json!(pdf)),cx).await?;
                    query(root,"paper-agent",r#"(()=>{
                      window.paperProbe={pending:true};
                      (async()=>{
                        const get=async(path,body)=>{const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json();};
                        const reply=await fetch('/api/pdf/import?filename=Native-fixture.pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(window.paperProbePdf)});
                        if(!reply.ok)throw Error(await reply.text());const paper=await reply.json();
                        document.querySelector('.pa-library-screen button[aria-label="Refresh"]').click();
                        window.paperProbe={paperId:paper.id};
                      })().catch(error=>window.paperProbe={error:String(error)});
                      return true;
                    })()"#,cx).await?;
                    stage=2;
                }
            }
            2=>{
                let clicked=query(root,"paper-agent",r#"(()=>{const button=document.querySelector('.pa-library-list .pero-list-open');if(!button)return false;button.click();return true;})()"#,cx).await?;
                if clicked==true {stage=3;}
            }
            3=>{
                let clicked=query(root,"paper-agent",r#"(()=>{const button=[...document.querySelectorAll('.pa-reading-bar button')].find(b=>b.textContent==='Ask');if(!button||button.disabled)return false;button.click();return true;})()"#,cx).await?;
                if clicked==true {stage=4;}
            }
            4=>{
                let error=query(root,"paper-agent","document.querySelector('.pa-global-error')?.textContent ?? ''",cx).await?;
                anyhow::ensure!(error=="","Native context request failed: {error}");
                last=cx.update(|cx|root.read(cx).chat.read(cx).snapshot(cx));
                anyhow::ensure!(last["error"].is_null(),"Native Chat failed: {last}");
                if last["attachments"].as_array().is_some_and(|a|!a.is_empty()) {
                    anyhow::ensure!(last["scope"]["app"]=="paper-agent","Wrong Chat scope: {last}");
                    anyhow::ensure!(last["chats"][0]["messages"].as_array().is_some_and(|m|m.is_empty()),"App must not send a question implicitly");
                    let _=window.update(cx,|_,_window,cx|root.update(cx,|root,cx|root.chat.update(cx,|chat,cx|{
                        chat.compose("What does this synthetic source establish?".into(),cx);
                    })))?;
                    stage=5;
                }
            }
            5=>{
                let ready=cx.update(|cx|root.read(cx).chat.read(cx).snapshot(cx)["composer"].as_str().is_some_and(|value|value.contains("What does this synthetic source establish?")));
                if ready {
                    let _=window.update(cx,|_,window,cx|root.update(cx,|root,cx|root.chat.update(cx,|chat,cx|chat.send_chat(window,cx))))?;
                    stage=6;
                }
            }
            6=>{
                let value=query(root,"paper-agent",r#"(()=>{if(!window.paperProbeReading){window.paperProbeReading=true;fetch('/api/library').then(r=>r.json()).then(value=>{window.paperProbeLibrary=value;window.paperProbeReading=false;});}return {library:window.paperProbeLibrary,error:window.paperProbe?.error};})()"#,cx).await?;
                anyhow::ensure!(value["error"].is_null(),"Native App failed: {value}");
                last=cx.update(|cx|root.read(cx).chat.read(cx).snapshot(cx));
                if value["library"]["reports"].as_array().is_some_and(|r|!r.is_empty()) {
                    let active=last["activeChat"].as_u64().unwrap_or(0) as usize;
                    if last["chats"][active]["state"]=="idle" {
                        stage=7;
                    }
                }
            }
            7=>{
                last=cx.update(|cx|root.read(cx).chat.read(cx).snapshot(cx));
                if let Some(bounds)=last["appLinkBounds"][0]["bounds"].as_object() {
                    let x=bounds["x"].as_f64().unwrap() as f32+bounds["width"].as_f64().unwrap() as f32/2.;
                    let y=bounds["y"].as_f64().unwrap() as f32+bounds["height"].as_f64().unwrap() as f32/2.;
                    window.update(cx,|_,window,cx|{
                        window.dispatch_event(PlatformInput::MouseDown(MouseDownEvent{button:MouseButton::Left,position:point(px(x),px(y)),click_count:1,..Default::default()}),cx);
                        window.dispatch_event(PlatformInput::MouseUp(MouseUpEvent{button:MouseButton::Left,position:point(px(x),px(y)),click_count:1,..Default::default()}),cx);
                    })?;
                    stage=8;
                }
            }
            8=>{
                let highlighted=query(root,"paper-agent","!!document.querySelector('[data-citation-region=\"true\"]')",cx).await?;
                if highlighted==true {
                    let value=query(root,"paper-agent","window.paperProbeLibrary",cx).await?;
                    return Ok(json!({"passed":true,"realModel":false,"checks":["native Paper Ask freezes App context without auto-send","shared Host saves an exact PDF evidence report","native Chat source button receives real pointer events and highlights PDF"],"library":value,"chat":last}));
                }
            }
            _=>unreachable!(),
        }
        cx.background_executor().timer(Duration::from_millis(150)).await;
    }
    anyhow::bail!("Native Paper Chat timed out at stage {stage}: {last}")
}
