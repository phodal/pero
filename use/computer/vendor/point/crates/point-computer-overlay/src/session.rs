//! Overlay 会话:spawn helper、写 stdin、任何 IO 失败都记 Unavailable。
//!
//! 找不到二进制、写失败、进程已死 → 动作路径继续。可见性不是授权。

use std::io::Write;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use crate::protocol;
use crate::{OverlayKind, OverlayOutcome, OverlaySink};

/// 环境变量:显式 helper 路径。未设则不 spawn。
pub const OVERLAY_BIN_ENV: &str = "POINT_CURSOR_OVERLAY";

/// 懒启动的 helper 会话。第一次失败后本进程内不再重试。
pub struct OverlaySession {
	bin: Option<PathBuf>,
	child: Option<Child>,
	stdin: Option<ChildStdin>,
	dead: bool,
}

impl OverlaySession {
	pub fn from_env() -> Self {
		// 未设环境变量 = 不 spawn。装饰进程不得因为 PATH 上碰巧有同名二进制
		// 就拖住每一次 global 点击。
		Self::new(std::env::var_os(OVERLAY_BIN_ENV).map(PathBuf::from))
	}

	pub fn new(bin: Option<PathBuf>) -> Self {
		OverlaySession { bin, child: None, stdin: None, dead: false }
	}

	fn spawn(&mut self) -> bool {
		if self.dead {
			return false;
		}
		if self.stdin.is_some() {
			return true;
		}
		let Some(bin) = self.bin.as_deref() else {
			self.dead = true;
			return false;
		};
		if bin.as_os_str().is_empty() {
			self.dead = true;
			return false;
		}
		match Command::new(bin).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
			Ok(mut child) => {
				self.stdin = child.stdin.take();
				self.child = Some(child);
				self.stdin.is_some()
			}
			Err(_) => {
				self.dead = true;
				false
			}
		}
	}

	fn write_kind(&mut self, kind: &OverlayKind) -> OverlayOutcome {
		if !self.spawn() {
			return OverlayOutcome::Unavailable;
		}
		let Some(stdin) = self.stdin.as_mut() else {
			self.dead = true;
			return OverlayOutcome::Unavailable;
		};
		let payload = protocol::encode(kind);
		match stdin.write_all(payload.as_bytes()).and_then(|_| stdin.flush()) {
			Ok(()) => OverlayOutcome::Shown,
			Err(_) => {
				self.dead = true;
				self.stdin = None;
				OverlayOutcome::Unavailable
			}
		}
	}

	pub fn dismiss(&mut self) {
		let _ = self.write_kind(&OverlayKind::Dismiss);
		if let Some(mut child) = self.child.take() {
			let _ = child.kill();
			let _ = child.wait();
		}
		self.stdin = None;
		self.dead = true;
	}
}

impl OverlaySink for OverlaySession {
	fn present(&mut self, kind: &OverlayKind) -> OverlayOutcome {
		if matches!(kind, OverlayKind::Dismiss) {
			self.dismiss();
			return OverlayOutcome::Unavailable;
		}
		self.write_kind(kind)
	}
}

impl Drop for OverlaySession {
	fn drop(&mut self) {
		self.dismiss();
	}
}

/// 进程内单例:driver 调 [`shared_overlay`] 即可,没有 helper 也不炸。
static SHARED: Mutex<Option<OverlaySession>> = Mutex::new(None);

pub fn shared_overlay() -> OverlayGuard {
	OverlayGuard
}

pub struct OverlayGuard;

impl OverlaySink for OverlayGuard {
	fn present(&mut self, kind: &OverlayKind) -> OverlayOutcome {
		let Ok(mut slot) = SHARED.lock() else {
			return OverlayOutcome::Unavailable;
		};
		let session = slot.get_or_insert_with(OverlaySession::from_env);
		session.present(kind)
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn missing_binary_is_unavailable_not_a_panic() {
		let mut session = OverlaySession::new(Some(PathBuf::from("/no/such/point-cursor-overlay")));
		assert_eq!(session.present(&OverlayKind::Ripple { point: (1.0, 2.0) }), OverlayOutcome::Unavailable);
		assert_eq!(session.present(&OverlayKind::Dismiss), OverlayOutcome::Unavailable);
	}

	#[test]
	fn empty_path_never_spawns() {
		let mut session = OverlaySession::new(Some(PathBuf::from("")));
		assert_eq!(session.present(&OverlayKind::Ripple { point: (0.0, 0.0) }), OverlayOutcome::Unavailable);
	}

	#[test]
	fn unset_env_never_spawns() {
		let mut session = OverlaySession::new(None);
		assert_eq!(session.present(&OverlayKind::Ripple { point: (0.0, 0.0) }), OverlayOutcome::Unavailable);
	}
}
