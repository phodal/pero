//! Full App panels remain separate Host-owned WebViews inside a Notebook region.
use crate::{app::Workbench, workspace::{WorkspaceItem, WorkspaceRoute}};
use gpui_kit::{prelude::*, *};
use pero_contracts::{AppChatScope, HostEvent};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Clone, Deserialize)]
pub(crate) struct PanelRect { x: f32, y: f32, width: f32, height: f32 }
#[derive(Deserialize)]
struct PanelRequest { id: String, app: String, panel: String, rect: Option<PanelRect>, #[serde(default)] release: bool }
pub(crate) struct NativePanelSlot {
    pub(crate) owner: AppChatScope,
    app: String,
    panel: String,
    rect: Option<PanelRect>,
}
impl Workbench {
    fn app_item_visible(&self, item: &WorkspaceItem) -> bool {
        self.layout.embedded_surface_visible && if self.navigation.pane_layout_visible() {
            self.navigation.pane_layout().is_some_and(|layout| layout.active_items().iter().any(|leaf| leaf.route == WorkspaceRoute::Content(item.clone())))
        } else { self.navigation.current() == Some(item) }
    }
    pub(crate) fn native_app_presented(&self, item: &WorkspaceItem) -> bool {
        self.app_item_visible(item) || self.native_panel_slots.values().any(|slot| {
            item == &WorkspaceItem::App { name: slot.app.clone(), panel: slot.panel.clone() } && slot.rect.is_some() &&
                self.app_item_visible(&WorkspaceItem::App { name: slot.owner.app.clone(), panel: slot.owner.panel.clone() })
        })
    }
    pub(crate) fn native_panel_owner(&self, item: &WorkspaceItem) -> Option<WorkspaceItem> {
        self.native_panel_slots.values().find(|slot| slot.rect.is_some() && item == &WorkspaceItem::App { name: slot.app.clone(), panel: slot.panel.clone() })
            .map(|slot| WorkspaceItem::App { name: slot.owner.app.clone(), panel: slot.owner.panel.clone() })
    }
    pub(crate) fn native_panel_retained(&self, name: &str, panel: &str) -> bool {
        self.native_panel_slots.values().any(|slot| slot.app == name && slot.panel == panel &&
            self.navigation.items().contains(&WorkspaceItem::App { name: slot.owner.app.clone(), panel: slot.owner.panel.clone() }))
    }
    pub(crate) fn receive_native_panel_slot(&mut self, owner: &AppChatScope, message: &Value, cx: &mut Context<Self>) {
        if owner.app != "notebook" { return; }
        let Ok(request) = serde_json::from_value::<PanelRequest>(message.clone()) else { return; };
        let valid_id = !request.id.is_empty() && request.id.len() <= 128 && request.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_');
        if !valid_id { return; }
        let result = (|| -> anyhow::Result<bool> {
            anyhow::ensure!(request.app != "notebook" && self.apps.contains_panel(&request.app, &request.panel), "Choose an enabled installed App panel");
            if request.release { self.native_panel_slots.remove(&request.id); return Ok(false); }
            if let Some(rect) = &request.rect {
                let page = self.native_app_pages.get(&(owner.app.clone(),owner.panel.clone())).ok_or_else(|| anyhow::anyhow!("Notebook page closed"))?;
                let size = page.view.read(cx).panel_size;
                anyhow::ensure!(rect.x + rect.width <= f32::from(size.width) + 1. && rect.y + rect.height <= f32::from(size.height) + 1., "App panel must stay inside its Notebook");
                anyhow::ensure!([rect.x, rect.y, rect.width, rect.height].iter().all(|v| v.is_finite()) && rect.x >= 0. && rect.y >= 0. && rect.width >= 200. && rect.height >= 180., "Invalid App panel region");
            }
            anyhow::ensure!(!self.native_panel_slots.iter().any(|(id, slot)| id != &request.id && slot.app == request.app && slot.panel == request.panel && slot.rect.is_some() && request.rect.is_some()), "This App panel is already embedded in another region");
            let first = !self.native_panel_slots.contains_key(&request.id);
            let visible = request.rect.is_some();
            self.native_panel_slots.insert(request.id.clone(), NativePanelSlot { owner: owner.clone(), app: request.app.clone(), panel: request.panel.clone(), rect: request.rect.clone() });
            if first && !self.native_app_pages.contains_key(&(request.app.clone(), request.panel.clone())) {
                crate::native::apps().command(json!({"action":"apps_open","name":request.app,"panel":request.panel,"request_id":format!("app-panel:{}",request.id)}));
            }
            Ok(visible)
        })();
        if let Some(page) = self.native_app_pages.get(&(owner.app.clone(), owner.panel.clone())) {
            page.view.read(cx).send(match result {
                Ok(active) => json!({"type":"pero:app:panel-slot-result","id":request.id,"active":active}),
                Err(error) => json!({"type":"pero:app:panel-slot-result","id":request.id,"active":false,"error":error.to_string()}),
            }, cx);
        }
        self.sync_native_apps(cx); cx.notify();
    }
    pub(crate) fn receive_native_panel_failure(&mut self, event: &HostEvent, cx: &mut Context<Self>) {
        let Some(id) = event.request_id.as_deref().and_then(|id| id.strip_prefix("app-panel:")) else { return; };
        if let Some(slot) = self.native_panel_slots.get(id) {
            if let Some(page) = self.native_app_pages.get(&(slot.owner.app.clone(), slot.owner.panel.clone())) {
                page.view.read(cx).send(json!({"type":"pero:app:panel-slot-result","id":id,"active":false,"error":event.text}),cx);
            }
        }
    }
    pub(crate) fn native_panel_elements(&self, name: &str, panel: &str, cx: &App) -> Vec<AnyElement> {
        self.native_panel_slots.iter().filter_map(|(id, slot)| {
            if slot.owner.app != name || slot.owner.panel != panel { return None; }
            let rect = slot.rect.as_ref()?;
            let page = self.native_app_pages.get(&(slot.app.clone(), slot.panel.clone()))?;
            if let Some(error) = page.view.read(cx).error.as_ref() {
                if let Some(owner) = self.native_app_pages.get(&(name.into(),panel.into())) {
                    owner.view.read(cx).send(json!({"type":"pero:app:panel-slot-result","id":id,"active":false,"error":error}),cx);
                }
                return None;
            }
            Some(div().id(SharedString::from(format!("app-panel-{id}"))).absolute().left(px(rect.x)).top(px(rect.y))
                .w(px(rect.width)).h(px(rect.height)).overflow_hidden().child(page.view.clone()).into_any_element())
        }).collect()
    }
}
