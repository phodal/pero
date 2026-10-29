//! Shared appearance definitions; application roots own installation.
pub use pero_contracts::appearance::{AccentColor, ResolvedTypography, TextRole};
#[cfg(any(target_family = "wasm", feature = "native"))]
mod appearance;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use appearance::*;
#[cfg(any(target_family = "wasm", feature = "native"))]
mod scope;
#[cfg(any(target_family = "wasm", feature = "native"))]
pub use scope::TypographyScope;
