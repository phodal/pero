//! Overlay 线协议:一行一种类,点列随后。无第三方 JSON。
//!
//! 坐标是左上原点屏幕点。helper 若用 AppKit,翻转留在 helper 内。

use point_computer_core::cursor_motion::{CursorPath, MotionPlan, ScreenPoint};

use crate::OverlayKind;

pub fn encode(kind: &OverlayKind) -> String {
	match kind {
		OverlayKind::Arc { plan } => {
			let mut out = format!("A {} {}\n", plan.duration_ms, plan.points.len());
			for &(x, y) in &plan.points {
				out.push_str(&format!("{x:.3} {y:.3}\n"));
			}
			out
		}
		OverlayKind::Ripple { point } => format!("R {:.3} {:.3}\n", point.0, point.1),
		OverlayKind::Trail { points, duration_ms } => {
			let mut out = format!("T {duration_ms} {}\n", points.len());
			for &(x, y) in points {
				out.push_str(&format!("{x:.3} {y:.3}\n"));
			}
			out
		}
		OverlayKind::Dismiss => "D\n".into(),
	}
}

/// 解析一条完整命令。残缺输入 → None(helper 丢弃,不猜点)。
pub fn decode(text: &str) -> Option<OverlayKind> {
	let mut lines = text.lines().filter(|line| !line.is_empty());
	let header = lines.next()?;
	let mut parts = header.split_whitespace();
	match parts.next()? {
		"D" => Some(OverlayKind::Dismiss),
		"R" => {
			let x: f64 = parts.next()?.parse().ok()?;
			let y: f64 = parts.next()?.parse().ok()?;
			Some(OverlayKind::Ripple { point: (x, y) })
		}
		"A" => {
			let duration_ms: u64 = parts.next()?.parse().ok()?;
			let count: usize = parts.next()?.parse().ok()?;
			let points = read_points(&mut lines, count)?;
			Some(OverlayKind::Arc { plan: stub_plan(points, duration_ms) })
		}
		"T" => {
			let duration_ms: u64 = parts.next()?.parse().ok()?;
			let count: usize = parts.next()?.parse().ok()?;
			let points = read_points(&mut lines, count)?;
			Some(OverlayKind::Trail { points, duration_ms })
		}
		_ => None,
	}
}

fn read_points<'a>(lines: &mut impl Iterator<Item = &'a str>, count: usize) -> Option<Vec<ScreenPoint>> {
	let mut points = Vec::with_capacity(count);
	for _ in 0..count {
		let mut xy = lines.next()?.split_whitespace();
		let x: f64 = xy.next()?.parse().ok()?;
		let y: f64 = xy.next()?.parse().ok()?;
		points.push((x, y));
	}
	Some(points)
}

fn stub_plan(points: Vec<ScreenPoint>, duration_ms: u64) -> MotionPlan {
	let start = points.first().copied().unwrap_or((0.0, 0.0));
	let end = points.last().copied().unwrap_or(start);
	MotionPlan {
		points,
		duration_ms,
		path: CursorPath { start, end, control1: start, control2: end, curve_scale: 0.0, arc_amount: 0.0 },
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::OverlayKind;

	#[test]
	fn roundtrip_ripple_and_dismiss() {
		let ripple = OverlayKind::Ripple { point: (12.5, 80.0) };
		assert_eq!(decode(&encode(&ripple)), Some(ripple));
		assert_eq!(decode(&encode(&OverlayKind::Dismiss)), Some(OverlayKind::Dismiss));
	}

	#[test]
	fn truncated_arc_is_none() {
		assert!(decode("A 200 3\n0 0\n").is_none());
		assert!(decode("Z 1\n").is_none());
	}
}
