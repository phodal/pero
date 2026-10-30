//! 单调时钟 —— REF `time.monotonic()` 的对齐。
//!
//! 输出为「进程纪元起的 f64 秒」。不存 [`std::time::Instant`] 本体:它无法
//! 为任意过去时刻构造,TTL/过期测试(index 的 `now=` 参数)将无从下手;
//! f64 保留全部所需性质 —— 单调、可比较、测试可任意构造、可跨 JSON 边界。
//!
//! 进程内语义与 REF 相同:快照索引是进程内的,`captured_at` 从不出现在
//! doctor 输出里,跨进程无意义不构成问题。

use std::sync::OnceLock;
use std::time::Instant;

static EPOCH: OnceLock<Instant> = OnceLock::new();

/// 当前单调时刻(进程纪元起的秒数)。
pub fn now() -> f64 {
	let epoch = EPOCH.get_or_init(Instant::now);
	epoch.elapsed().as_secs_f64()
}

/// 距 `earlier` 经过的秒数(`earlier` 可为测试构造的任意值)。
pub fn elapsed_since(earlier: f64) -> f64 {
	now() - earlier
}

#[cfg(test)]
mod tests {
	#[test]
	fn monotonic_nondecreasing() {
		let a = super::now();
		let b = super::now();
		assert!(b >= a);
		assert!(super::elapsed_since(a) >= 0.0);
	}
}
