#[cfg(any(target_family = "wasm", feature = "native"))]
mod terminal;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod view_bounds;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_harness;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_section;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod app;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod apps;
#[cfg(any(target_family = "wasm", feature = "native"))]
use pero_chat_ui::assets;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod components;
#[cfg(any(target_family = "wasm", feature = "native"))]
use pero_chat_ui::theme;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod view;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod sessions_view;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod documents;
#[cfg(any(target_family="wasm",feature="native"))]
mod web_documents;
#[cfg(any(target_family="wasm",feature="native"))]
mod icon_themes;

// Rendered only by the wasm Workbench; native builds compile it for its tests.
#[cfg_attr(not(target_family = "wasm"), allow(dead_code))]
mod cloud;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod local_roadmap;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod project_view;
#[cfg(any(target_family = "wasm", feature = "native"))]
#[cfg(test)]
mod insights;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod projects;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_menu;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_view;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_pages;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_controls;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_computer;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_mcp;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_window;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod contributions;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod remote;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod remote_connection;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod remote_view;

#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod cloud_links;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod desktop_login;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
pub mod native;
#[cfg(all(feature="native",not(target_family="wasm")))]
mod native_web;
#[cfg(all(feature="native-probe",not(target_family="wasm")))]
mod native_web_probe;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_cloud;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod local_execution;

#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_device;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_harness;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_secrets;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_connectors;

#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod workspace;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod workspace_view;

#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod layout;

#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_restore;

#[cfg(any(target_family="wasm",feature="native"))]
mod document_save_as;

#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_sources;

#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_pane_views;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod workspace_surface_views;

#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_draft_upload;

#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod workspace_close;

#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_pane_tabs;
#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_tab_actions;

#[cfg(any(target_family="wasm",feature="native"))]
mod workspace_recent;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod spotlight;

#[cfg(all(feature="native",not(target_family="wasm")))]
mod native_apps;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_python;
#[cfg(all(feature="native",not(target_family="wasm")))]
mod native_app_surface;

#[cfg(all(feature="native-probe",not(target_family="wasm")))]
mod native_app_probe;
#[cfg(all(feature = "native-probe", not(target_family = "wasm")))]
mod native_connector_probe;

#[cfg(any(target_family="wasm", feature="native"))]
mod workspace_tools;

#[cfg(any(target_family="wasm", feature="native"))]
mod compute_view;
