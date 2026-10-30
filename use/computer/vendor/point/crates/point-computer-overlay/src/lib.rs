//! 无特权光标 overlay(ADR-0079 M5):消费 [`MotionPlan`],失败不影响动作。
//!
//! 本 crate **可以** IO(spawn / stdin),`point-computer-core` 不可以。
//! overlay 无 AX、无 CGEvent、无截图权;可见性不得作为授权。

#![forbid(unsafe_code)]

use point_computer_core::cursor_motion::{MotionPlan, ScreenPoint, SpringConfig, plan_motion};
use point_computer_core::types::{DEFAULT_CURVE_SCALE, DEFAULT_PATH_SAMPLES, MAX_MOVE_DURATION_MS};

pub mod protocol;
pub mod session;

/// 审计字段:`cursorOverlay` 的取值。动作路径只读它,从不据它放行。
pub const OVERLAY_SHOWN: &str = "shown";
pub const OVERLAY_UNAVAILABLE: &str = "unavailable";

/// 一次示能请求。点列为左上原点屏幕点,已由 [`plan_motion`] 预采样。
#[derive(Debug, Clone, PartialEq)]
pub enum OverlayKind {
	/// `global` 路径:先画弧,再由调用方投递真指针。
	Arc { plan: MotionPlan },
	/// 元素/`app_post`/`sky_click`:只在落点画水波纹,不移动真指针。
	Ripple { point: ScreenPoint },
	/// 拖拽轨迹。
	Trail { points: Vec<ScreenPoint>, duration_ms: u64 },
	Dismiss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OverlayOutcome {
	Shown,
	Unavailable,
}

impl OverlayOutcome {
	pub fn as_audit(self) -> &'static str {
		match self {
			OverlayOutcome::Shown => OVERLAY_SHOWN,
			OverlayOutcome::Unavailable => OVERLAY_UNAVAILABLE,
		}
	}
}

/// 渲染缝。生产实现写子进程 stdin;测试实现记日志。任何错误都是 Unavailable。
pub trait OverlaySink {
	fn present(&mut self, kind: &OverlayKind) -> OverlayOutcome;
}

/// 永远 Unavailable:没 helper、崩溃、超时。动作路径必须继续。
#[derive(Debug, Default)]
pub struct NullOverlay;

impl OverlaySink for NullOverlay {
	fn present(&mut self, _kind: &OverlayKind) -> OverlayOutcome {
		OverlayOutcome::Unavailable
	}
}

/// 一次示能的结果。`wait_ms` 仅在 Shown 的弧/轨迹上非零;Unavailable 必须为 0,
/// 这样动作路径不会因为 overlay 挂了而多等 2s。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OverlayPlay {
	pub outcome: OverlayOutcome,
	pub wait_ms: u64,
}

impl OverlayPlay {
	pub fn unavailable() -> Self {
		OverlayPlay { outcome: OverlayOutcome::Unavailable, wait_ms: 0 }
	}
}

/// `global` 点击前的示能。没有起点就只画落点,绝不猜光标,也不拖延投递。
pub fn play_global_click(sink: &mut dyn OverlaySink, start: Option<ScreenPoint>, end: ScreenPoint) -> OverlayPlay {
	match start {
		Some(start) => {
			let plan = plan_motion(start, end, DEFAULT_CURVE_SCALE, 0.0, DEFAULT_PATH_SAMPLES, &SpringConfig::default());
			debug_assert!(plan.duration_ms <= MAX_MOVE_DURATION_MS);
			let wait_ms = plan.duration_ms.min(MAX_MOVE_DURATION_MS);
			let outcome = sink.present(&OverlayKind::Arc { plan });
			OverlayPlay { outcome, wait_ms: if outcome == OverlayOutcome::Shown { wait_ms } else { 0 } }
		}
		None => OverlayPlay { outcome: sink.present(&OverlayKind::Ripple { point: end }), wait_ms: 0 },
	}
}

/// 非 `global` 路径:落点水波纹。不移动真指针,也不拖延投递。
pub fn play_landing(sink: &mut dyn OverlaySink, point: ScreenPoint) -> OverlayPlay {
	OverlayPlay { outcome: sink.present(&OverlayKind::Ripple { point }), wait_ms: 0 }
}

/// 拖拽轨迹。空点列 = Unavailable,不发明路径。
pub fn play_trail(sink: &mut dyn OverlaySink, points: &[ScreenPoint], duration_ms: u64) -> OverlayPlay {
	if points.len() < 2 {
		return OverlayPlay::unavailable();
	}
	let wait_ms = duration_ms.min(MAX_MOVE_DURATION_MS);
	let outcome = sink.present(&OverlayKind::Trail { points: points.to_vec(), duration_ms: wait_ms });
	OverlayPlay { outcome, wait_ms: if outcome == OverlayOutcome::Shown { wait_ms } else { 0 } }
}

/// Shown 才睡;Unavailable 立即返回。调用方在这之后投递真指针。
pub fn wait_shown(play: OverlayPlay) {
	if play.wait_ms > 0 {
		std::thread::sleep(std::time::Duration::from_millis(play.wait_ms));
	}
}

/// driver 入口:`pid_owns_point` 之后、SendInput/CGEvent 之前。失败不抛、不拖延。
pub fn decorate_global_click(start: Option<ScreenPoint>, end: ScreenPoint) -> OverlayOutcome {
	let play = play_global_click(&mut session::shared_overlay(), start, end);
	wait_shown(play);
	play.outcome
}

/// driver 入口:拖拽轨迹。空点列 / helper 挂了都不挡投递。
pub fn decorate_global_drag(points: &[ScreenPoint], duration_ms: u64) -> OverlayOutcome {
	let play = play_trail(&mut session::shared_overlay(), points, duration_ms);
	wait_shown(play);
	play.outcome
}

/// 非 global 落点。不移动真指针。
pub fn decorate_landing(point: ScreenPoint) -> OverlayOutcome {
	play_landing(&mut session::shared_overlay(), point).outcome
}

#[cfg(test)]
mod tests {
	use super::*;

	struct LogSink(Vec<String>);
	impl OverlaySink for LogSink {
		fn present(&mut self, kind: &OverlayKind) -> OverlayOutcome {
			self.0.push(match kind {
				OverlayKind::Arc { plan } => format!("arc:{}:{}", plan.points.len(), plan.duration_ms),
				OverlayKind::Ripple { point } => format!("ripple:{:.0},{:.0}", point.0, point.1),
				OverlayKind::Trail { points, .. } => format!("trail:{}", points.len()),
				OverlayKind::Dismiss => "dismiss".into(),
			});
			OverlayOutcome::Shown
		}
	}

	#[test]
	fn null_overlay_is_unavailable_and_named_for_audit() {
		assert_eq!(NullOverlay.present(&OverlayKind::Dismiss), OverlayOutcome::Unavailable);
		assert_eq!(OverlayOutcome::Unavailable.as_audit(), OVERLAY_UNAVAILABLE);
	}

	#[test]
	fn global_without_start_ripples_instead_of_guessing() {
		let mut log = LogSink(Vec::new());
		let play = play_global_click(&mut log, None, (10.0, 20.0));
		assert_eq!(play.outcome, OverlayOutcome::Shown);
		assert_eq!(play.wait_ms, 0);
		assert_eq!(log.0, ["ripple:10,20"]);
	}

	#[test]
	fn global_with_start_clamps_duration() {
		let mut log = LogSink(Vec::new());
		let play = play_global_click(&mut log, Some((0.0, 0.0)), (800.0, 0.0));
		assert_eq!(play.outcome, OverlayOutcome::Shown);
		assert!(log.0[0].starts_with("arc:"), "{}", log.0[0]);
		assert!(play.wait_ms <= MAX_MOVE_DURATION_MS, "{}", play.wait_ms);
		assert!(play.wait_ms > 0);
	}

	#[test]
	fn unavailable_sink_does_not_delay_delivery() {
		let play = play_global_click(&mut NullOverlay, Some((0.0, 0.0)), (800.0, 0.0));
		assert_eq!(play.outcome, OverlayOutcome::Unavailable);
		assert_eq!(play.wait_ms, 0);
	}

	#[test]
	fn empty_trail_is_unavailable() {
		assert_eq!(play_trail(&mut NullOverlay, &[], 200), OverlayPlay::unavailable());
	}
}
