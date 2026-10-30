//! Worker-provided guard is checked again at the native side-effect boundary.
use std::{cell::RefCell, sync::Arc};
pub type Guard = Arc<dyn Fn() -> bool + Send + Sync>;
thread_local! { static INPUT_GUARD: RefCell<Option<Guard>> = RefCell::new(None); }
pub fn set_guard(guard: Option<Guard>) {
	INPUT_GUARD.with(|g| *g.borrow_mut() = guard);
}
pub fn check() -> Result<(), String> {
	if crate::stop::blocked() {
		return Err("WINDOWS_PHYSICAL_STOP".into());
	}
	INPUT_GUARD.with(|g| {
		if g.borrow().as_ref().is_none_or(|guard| guard()) {
			Ok(())
		} else {
			Err("WINDOWS_CONTROL_LEASE_EXPIRED".into())
		}
	})
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn physical_stop_cuts_the_next_input_unit() {
		let _gate = crate::stop::test_gate();
		crate::stop::clear_latch();
		assert!(check().is_ok());
		crate::stop::set_latched(true);
		assert_eq!(check().unwrap_err(), "WINDOWS_PHYSICAL_STOP");
		crate::stop::clear_latch();
		assert!(check().is_ok());
	}
}
