//! App-owned example controllers, presented in the existing pane titlebar.
use crate::{app::Workbench,workspace::{WorkspaceItem,WorkspaceRoute},view_bounds::ViewBounds};
use gpui_kit::{component::{button::*,menu::{DropdownMenu,PopupMenuItem},*},prelude::*,*};
use pero_contracts::{AppChatScope,workspace_panes::PaneLeaf};
use serde::Deserialize;
use serde_json::{json,Value};

#[derive(Clone,Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Entry {id:String,title:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Examples {
    entries:Vec<Entry>,ready:bool,busy:bool,selected_id:Option<String>,source:bool,error:String,
    #[serde(skip)] bounds:ViewBounds,
}
impl Workbench {
    pub(crate) fn receive_app_examples(&mut self,scope:AppChatScope,value:Value,cx:&mut Context<Self>) {
        let Ok(state)=serde_json::from_value::<Examples>(value) else{return;};
        if !self.apps.contains_panel(&scope.app,&scope.panel)||state.entries.len()>32||state.error.len()>4096||state.entries.iter().any(|entry|entry.id.is_empty()||entry.id.len()>64||entry.title.len()>200){return;}
        self.app_examples.insert((scope.app,scope.panel),state);cx.notify();
    }
    pub(crate) fn app_example_action(&mut self,scope:&AppChatScope,action:&str,id:Option<&str>,cx:&mut Context<Self>) {
        let message=json!({"scope":scope,"action":action,"id":id});
        #[cfg(target_family="wasm")]
        {
            #[wasm_bindgen::prelude::wasm_bindgen]
            extern "C" {#[wasm_bindgen(js_namespace=window,js_name=peroAppExample,catch)] fn send(json:&str)->Result<(),wasm_bindgen::JsValue>;}
            let _=send(&message.to_string());
        }
        #[cfg(not(target_family="wasm"))]
        if let Some(page)=self.native_app_pages.get(&(scope.app.clone(),scope.panel.clone())) {
            let mut message=message;message["type"]=json!("pero:app:example");page.view.read(cx).send(message,cx);
        }
        let _=cx;
    }
    pub(crate) fn app_examples_button(&self,leaf:&PaneLeaf,cx:&mut Context<Self>)->Option<AnyElement> {
        let Some(WorkspaceRoute::Content(WorkspaceItem::App{name,panel}))=leaf.route() else{return None;};
        let state=self.app_examples.get(&(name.clone(),panel.clone()))?;
        if state.entries.is_empty(){return None;}
        let scope=AppChatScope{app:name.clone(),panel:panel.clone()};
        let entries=state.entries.clone();let selected=state.selected_id.clone();let source=state.source;let failed=!state.error.is_empty();
        let source_label=self.t("apps.example_source").to_string();let retry_label=self.t("apps.env_retry").to_string();
        let owner=cx.entity().downgrade();
        let button=Button::new(("app-examples",leaf.id.0 as usize)).ghost().small().label(self.t("apps.examples"))
            .accessibility_label(self.t("apps.examples")).disabled(!state.ready||state.busy)
            .dropdown_menu(move|mut menu,_,_|{
                for entry in &entries {
                    let owner=owner.clone();let scope=scope.clone();let id=entry.id.clone();
                    menu=menu.item(PopupMenuItem::new(entry.title.clone()).checked(selected.as_deref()==Some(&entry.id)).on_click(move|_,_,cx|{let _=owner.update(cx,|this,cx|this.app_example_action(&scope,"load",Some(&id),cx));}));
                }
                let source_owner=owner.clone();let source_scope=scope.clone();
                menu=menu.separator().item(PopupMenuItem::new(source_label.clone()).disabled(!source).on_click(move|_,_,cx|{let _=source_owner.update(cx,|this,cx|this.app_example_action(&source_scope,"source",None,cx));}));
                if failed {let owner=owner.clone();let scope=scope.clone();menu=menu.item(PopupMenuItem::new(retry_label.clone()).on_click(move|_,_,cx|{let _=owner.update(cx,|this,cx|this.app_example_action(&scope,"retry",None,cx));}));}
                menu
            });
        Some(div().relative().child(button).child(state.bounds.probe("examples".into())).into_any_element())
    }
    pub(crate) fn app_examples_bounds(&self)->Value {
        json!(self.app_examples.iter().map(|((app,panel),state)|(format!("{app}:{panel}"),state.bounds.snapshot())).collect::<std::collections::BTreeMap<_,_>>())
    }
}
