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

// Rendered only by the wasm Workbench; native builds compile it for its tests.
#[cfg_attr(not(target_family = "wasm"), allow(dead_code))]
mod cloud;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod local_roadmap;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod project_view;
#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod projects;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_menu;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod settings_view;
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
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_cloud;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod local_execution;

#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_device;
#[cfg(all(feature = "native", not(target_family = "wasm")))]
mod native_secrets;

#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod workspace;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod workspace_view;

#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod layout;
