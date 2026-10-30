//! Native UIA snapshots; non-Windows fallback exists only for offline tests.

#[cfg(not(windows))]
use point_computer_core::clock;
#[cfg(not(windows))]
use point_computer_core::types::Frame;
use point_computer_core::types::{AppRef, ComputerUseError, Snapshot, SnapshotRequest};

#[cfg(not(windows))]
use crate::apps;

/// Native failures are refusals, never an apparently complete empty UIA tree.
pub fn build_snapshot(app: &AppRef) -> Result<Snapshot, ComputerUseError> {
	build_snapshot_with(app, SnapshotRequest::default())
}

pub fn build_snapshot_with(app: &AppRef, _req: SnapshotRequest) -> Result<Snapshot, ComputerUseError> {
	#[cfg(windows)]
	{
		crate::uia::snapshot(app, _req).map_err(ComputerUseError::Denied)
	}
	#[cfg(not(windows))]
	{
		let window = apps::window_for_app(app);
		let window_bounds = window.as_ref().and_then(|info| {
			let (x, y, w, h) = info.bounds?;
			Some(Frame { x, y, w, h })
		});
		let window_title = window.as_ref().map(|info| info.title.clone()).unwrap_or_else(|| app.window_title.clone());
		Ok(Snapshot {
			app: app.clone(),
			elements: Vec::new(),
			window_title,
			captured_at: clock::now(),
			truncated: false,
			depth_truncated: false,
			has_secure: false,
			window_bounds,
			..Snapshot::default()
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	fn app() -> AppRef {
		AppRef {
			name: "Notepad".into(),
			pid: 9,
			bundle_id: "notepad.exe".into(),
			window_id: 7,
			window_title: "notes".into(),
		}
	}

	#[test]
	fn empty_tree_is_complete_not_truncated() {
		if cfg!(windows) {
			assert!(build_snapshot(&app()).is_err());
			return;
		}
		let snap = build_snapshot(&app()).expect("snapshot");
		assert!(snap.elements.is_empty());
		assert!(!snap.truncated);
		assert!(!snap.depth_truncated);
		assert!(!snap.has_secure);
		assert_eq!(snap.app.pid, 9);
		assert!(snap.image_jpeg.is_empty());
	}

	#[test]
	fn missing_window_leaves_bounds_none() {
		if cfg!(windows) {
			return;
		}
		let snap = build_snapshot(&app()).expect("snapshot");
		assert!(snap.window_bounds.is_none());
		assert_eq!(snap.window_title, "notes");
	}
}
