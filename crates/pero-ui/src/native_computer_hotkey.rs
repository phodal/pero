//! macOS global Computer Use shortcuts. Registration needs no input-monitoring grant.
use std::{ffi::c_void, ptr, sync::Arc};

use async_channel::{Receiver, Sender};
use gpui_kit::component::{WindowExt, notification::Notification};
use gpui_kit::{AnyWindowHandle, App, Entity};
use objc2_app_kit::NSWorkspace;
use pero_chat_ui::{ChatPanel, Conversation, session_state::SessionState};
use pero_contracts::computer_runtime::{ComputerAppshotResponse, ComputerControl};

use crate::{app::Workbench, native_connectors::NativeConnectors, workspace::ConversationTab};

#[repr(C)]
struct EventType {
    class: u32,
    kind: u32,
}

#[repr(C)]
#[derive(PartialEq, Eq)]
struct HotKeyId {
    signature: u32,
    id: u32,
}

const STOP: HotKeyId = HotKeyId {
    signature: u32::from_be_bytes(*b"Pero"),
    id: 1,
};
const APPSHOT: HotKeyId = HotKeyId {
    signature: STOP.signature,
    id: 2,
};
type EventRef = *mut c_void;

#[link(name = "Carbon", kind = "framework")]
unsafe extern "C" {
    fn GetApplicationEventTarget() -> EventRef;
    fn InstallEventHandler(
        target: EventRef,
        callback: extern "C" fn(EventRef, EventRef, EventRef) -> i32,
        count: u32,
        types: *const EventType,
        context: EventRef,
        handler: *mut EventRef,
    ) -> i32;
    fn RegisterEventHotKey(
        code: u32,
        modifiers: u32,
        id: HotKeyId,
        target: EventRef,
        options: u32,
        hotkey: *mut EventRef,
    ) -> i32;
    fn GetEventParameter(
        event: EventRef,
        name: u32,
        kind: u32,
        actual_type: *mut u32,
        size: usize,
        actual_size: *mut usize,
        data: EventRef,
    ) -> i32;
    fn UnregisterEventHotKey(hotkey: EventRef) -> i32;
    fn RemoveEventHandler(handler: EventRef) -> i32;
}

extern "C" fn handle(_: EventRef, event: EventRef, context: EventRef) -> i32 {
    let mut id = HotKeyId {
        signature: 0,
        id: 0,
    };
    let result = unsafe {
        GetEventParameter(
            event,
            u32::from_be_bytes(*b"----"),
            u32::from_be_bytes(*b"hkid"),
            ptr::null_mut(),
            std::mem::size_of::<HotKeyId>(),
            ptr::null_mut(),
            (&raw mut id).cast(),
        )
    };
    if result != 0 {
        return -9874; // eventNotHandledErr
    }
    if id == STOP {
        if let Err(error) = crate::native::computer_control(ComputerControl::Stop {}) {
            eprintln!("Computer Use emergency stop: {error}");
        }
    } else if id == APPSHOT {
        if let Some(app) = NSWorkspace::sharedWorkspace().frontmostApplication() {
            let pid = app.processIdentifier();
            if pid > 0 && pid != std::process::id() as i32 {
                // The handler is removed before the registration's sender is dropped.
                let sender = unsafe { &*context.cast::<Sender<i32>>() };
                let _ = sender.try_send(pid);
            }
        }
    } else {
        return -9874;
    }
    0
}

pub(super) struct ComputerHotKeys {
    handler: EventRef,
    stop: EventRef,
    appshot: EventRef,
    sender: Box<Sender<i32>>,
}

impl ComputerHotKeys {
    #[cfg(feature = "native-probe")]
    pub(super) fn appshot_registered(&self) -> bool {
        !self.appshot.is_null()
    }

    pub(super) fn register(sender: Sender<i32>) -> anyhow::Result<Self> {
        let mut registration = Self {
            handler: ptr::null_mut(),
            stop: ptr::null_mut(),
            appshot: ptr::null_mut(),
            sender: Box::new(sender),
        };
        let event = EventType {
            class: u32::from_be_bytes(*b"keyb"),
            kind: 5,
        }; // kEventHotKeyPressed
        unsafe {
            let target = GetApplicationEventTarget();
            let result = InstallEventHandler(
                target,
                handle,
                1,
                &event,
                (&raw mut *registration.sender).cast(),
                &mut registration.handler,
            );
            anyhow::ensure!(
                result == 0,
                "Could not install emergency stop handler ({result})"
            );
            let result = RegisterEventHotKey(
                53,
                (1 << 8) | (1 << 9),
                STOP,
                target,
                0,
                &mut registration.stop,
            );
            if result != 0 {
                eprintln!("Could not register Command+Shift+Escape ({result})");
            }
            let result = RegisterEventHotKey(
                26, // kVK_ANSI_7
                (1 << 8) | (1 << 9) | (1 << 12),
                APPSHOT,
                target,
                0,
                &mut registration.appshot,
            );
            if result != 0 {
                eprintln!("Could not register Appshot Control+Shift+Command+7 ({result})");
            }
        }
        Ok(registration)
    }
}

fn active_chat(panel: &ChatPanel) -> Option<&Conversation> {
    panel.active_chat.and_then(|index| panel.chats.get(index))
}

pub(super) fn attach(
    view: Entity<Workbench>,
    window: AnyWindowHandle,
    owner: Arc<NativeConnectors>,
    captures: Receiver<i32>,
    cx: &mut App,
) {
    let view = view.downgrade();
    cx.spawn(async move |cx| {
        while let Ok(pid) = captures.recv().await {
            let Ok(Some((selected, target))) = window.update(cx, |_, _, cx| {
                let view = view.upgrade()?;
                let panel = view.read(cx).chat.read(cx);
                let active = active_chat(panel);
                let selected = active.map(|chat| chat.id.clone());
                let target = active
                    .filter(|chat| {
                        chat.scope.is_none()
                            && chat.project_agent.is_none()
                            && chat.brief.is_none()
                            && chat.state != SessionState::Closed
                    })
                    .map(|chat| chat.id.clone());
                Some((selected, target))
            }) else {
                break;
            };
            let owner = owner.clone();
            let shot = cx
                .background_executor()
                .spawn(async move {
                    let reply = owner
                        .request(serde_json::json!({"operation":"appshot","foreground_pid":pid}))?;
                    if let Some(message) = reply["message"].as_str() {
                        anyhow::bail!("{message}");
                    }
                    Ok::<_, anyhow::Error>(serde_json::from_value::<ComputerAppshotResponse>(
                        reply,
                    )?)
                })
                .await;
            // A held shortcut should not capture twice.
            let _ = captures.try_recv();
            let _ = window.update(cx, |_, window, cx| {
                view.update(cx, |root, cx| {
                    let current = active_chat(root.chat.read(cx)).map(|chat| chat.id.as_str());
                    let same_chat = current == selected.as_deref();
                    if same_chat {
                        cx.activate(true);
                        window.activate_window();
                    }
                    let shot = match shot {
                        Ok(shot) => shot,
                        Err(error) => {
                            window.push_notification(Notification::error(error.to_string()), cx);
                            return;
                        }
                    };
                    let index = if let Some(target) = target {
                        root.chat
                            .read(cx)
                            .chats
                            .iter()
                            .position(|chat| chat.id == target)
                    } else if same_chat {
                        root.new_chat(cx);
                        root.chat.read(cx).active_chat
                    } else {
                        None
                    };
                    let Some(index) = index else {
                        window.push_notification(
                            Notification::error(root.t("computer.appshot_conversation_changed")),
                            cx,
                        );
                        return;
                    };
                    let chat = &root.chat.read(cx).chats[index];
                    let thread = chat.id.clone();
                    let images = chat.state == SessionState::Draft || chat.capabilities.images;
                    let contexts = shot.into_contexts(images, root.t("computer.appshot_text"));
                    if !images {
                        let key = if contexts.is_empty() {
                            "composer.image_unsupported"
                        } else {
                            "computer.appshot_text_only"
                        };
                        window.push_notification(Notification::warning(root.t(key)), cx);
                    }
                    if contexts.is_empty() {
                        return;
                    }
                    if same_chat {
                        root.focus_chat(Some(index), ConversationTab::Chat, cx);
                    }
                    root.chat.update(cx, |panel, cx| {
                        panel.compose_in_thread(thread, String::new(), contexts, cx)
                    });
                })
            });
        }
    })
    .detach();
}

#[cfg(feature = "native-probe")]
pub(super) fn probe(
    view: Entity<Workbench>,
    window: AnyWindowHandle,
    sender: Sender<i32>,
    receipt: std::path::PathBuf,
    physical: bool,
    cx: &mut App,
) {
    cx.spawn(async move |cx| {
        let result = async {
            use pero_contracts::context::ContextContent;
            use std::time::{Duration, Instant};
            const DRAFT: &str = "Original Appshot draft";
            let workspace = std::env::var("PERO_NATIVE_APPSHOT_WORKSPACE")?;
            let deadline = Instant::now() + Duration::from_secs(if physical { 300 } else { 30 });
            let mut thread = None;
            let mut ready = false;
            let mut captured = false;
            let mut last = String::new();
            while Instant::now() < deadline {
                let state = window.update(cx, |_, window, cx| view.update(cx, |root, cx| {
                    if thread.is_none() && root.chat.read(cx).connected
                        && root.chat.read(cx).agents.iter().any(|agent| agent.id == "appshot-fixture" && agent.available)
                    {
                        root.chat.update(cx, |chat, _| chat.workspace = workspace.clone());
                        root.new_chat(cx);
                        thread = active_chat(root.chat.read(cx)).map(|chat| chat.id.clone());
                    }
                    let draft = active_chat(root.chat.read(cx))
                        .is_some_and(|chat| chat.capabilities.images && Some(&chat.id) == thread.as_ref());
                    if draft && !ready {
                        root.chat.update(cx, |panel, cx| {
                            panel.composer.update(cx, |input, cx| input.set_value(DRAFT, window, cx));
                        });
                        std::fs::write(receipt.with_extension("ready"), "")?;
                        ready = true;
                    }
                    let panel = root.chat.read(cx);
                    let Some(chat) = active_chat(panel) else { return Ok(None) };
                    anyhow::ensure!(chat.messages.is_empty(), "Appshot submitted its draft");
                    last = format!("images: {}, attachments: {}, original draft: {}",
                        chat.capabilities.images, panel.attachments.len(), panel.composer.read(cx).value().contains(DRAFT));
                    if chat.capabilities.images && panel.composer.read(cx).value().contains(DRAFT) {
                        if panel.attachments.len() >= 2 {
                            anyhow::ensure!(Some(&chat.id) == thread.as_ref(), "Appshot changed the draft conversation");
                            let image = panel.attachments.iter().find_map(|reference| match &reference.content {
                                ContextContent::Image { data, mime_type } => Some(serde_json::json!({
                                    "label": reference.label, "mimeType":mime_type, "data":data,
                                })),
                                _ => None,
                            });
                            let text = panel.attachments.iter().find_map(|reference| match &reference.content {
                                ContextContent::Text {text} => Some(text),
                                _ => None,
                            });
                            return Ok(Some(serde_json::json!({"passed": true, "draft": DRAFT, "image": image, "text": text})));
                        }
                    }
                    Ok::<_, anyhow::Error>(None)
                }))??;
                if let Some(state) = state { return Ok(state); }
                if ready && !physical && !captured && let Ok(pid) = std::fs::read_to_string(receipt.with_extension("capture")) {
                    sender.try_send(pid.trim().parse()?)?;
                    captured = true;
                }
                cx.background_executor().timer(Duration::from_millis(50)).await;
            }
            anyhow::bail!("Native Appshot timed out (draft ready: {ready}, capture requested: {captured}): {last}")
        }.await;
        let result = result.unwrap_or_else(|error| serde_json::json!({"passed":false,"error":error.to_string()}));
        let _ = std::fs::write(receipt, serde_json::to_vec(&result).unwrap());
        cx.update(|cx| cx.quit());
    }).detach();
}

impl Drop for ComputerHotKeys {
    fn drop(&mut self) {
        unsafe {
            for hotkey in [self.stop, self.appshot] {
                if !hotkey.is_null() {
                    UnregisterEventHotKey(hotkey);
                }
            }
            if !self.handler.is_null() {
                RemoveEventHandler(self.handler);
            }
        }
    }
}
