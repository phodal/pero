//! The UI shell supplies wall-clock observations to the pure display rules.
pub fn unix_seconds() -> Option<i64> {
    #[cfg(target_family = "wasm")]
    {
        Some((js_sys::Date::now() / 1000.) as i64)
    }
    #[cfg(not(target_family = "wasm"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs()
            .try_into()
            .ok()
    }
}
