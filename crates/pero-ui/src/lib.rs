#[cfg_attr(not(any(target_family = "wasm", feature = "native")), allow(dead_code))]
mod apps;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod app;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod assets;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod chat;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod components;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod conversation;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod theme;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod view;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod composer;

// Rendered only by the wasm Workbench; native builds compile it for its tests.
#[cfg_attr(not(target_family = "wasm"), allow(dead_code))]
mod cloud;
mod stream;
mod tool_ui;

#[cfg(any(target_family = "wasm", feature = "native"))]
mod remote;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod remote_connection;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod remote_view;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod contributions;

#[cfg(all(feature = "native", not(target_family = "wasm")))]
pub mod native;
