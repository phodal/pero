//! 光标运动的**路径模型** —— 纯几何,零平台接触。REF `cursor_motion.py`
//! 的移植。
//!
//! 这是刻意无趣的一半:给起点终点,产出一列采样屏幕点 + 时长,仅此而已。
//! 无 unsafe、无 IO、无时钟(除调用方传入的)。一切都是参数的全函数 ——
//! 这让运动的**形状**回归被数字断言抓住,而不是靠人眼盯屏幕。
//!
//! 模型(按参考实现的 `CursorMotionModel.swift` 重实现,读算法不抄码):
//!
//! * 起点到终点**一条三次 Bezier**,被垂直弦向的*弧*
//!   `clamp(distance × 0.22, 28, 110) × curve_scale` 顶弯。直线插值读作
//!   瞬移,恰是合成光标露馅之处;弧是全部错觉所在。
//! * **不对称控制点**(沿弦 0.18/0.80、跨弦 0.10/0.96)让光标快出、缓收。
//!   `curve_scale == 0` 把手柄折叠到经典三分位 —— 精确直线,「不要花活」
//!   的逃生口。
//! * **进度弹簧**(velocity-Verlet,固定步长 1/240s,response=1.4/
//!   damping=0.9)从 0 积分到 1 再喂给 Bezier。弹簧驱动**进度**而非位置,
//!   其越过 1.0 的轻微数值过冲在采样**之前**被钳住 —— 画出的光标永不过冲
//!   目标位置;动画的目的就是给用户看点击将落何处,这点必须成立。
//!
//! 坐标约定:本模块一切点为**左上原点屏幕坐标**(y 向下)—— computer use
//! 其余部分(AX/CG 表面、截屏裁剪、元素 frame)全用它。REF 中 AppKit
//! `NSWindow` 原点需要的翻转到 overlay 进程做;本移植未移植 overlay,翻
//! 转无家可归,也就不存在 —— 坐标从这里到 CGEvent 投递一路同 Convention。

use crate::types::{
	CURVE_AMOUNT_MAX, CURVE_AMOUNT_MIN, CURVE_C1_ACROSS, CURVE_C1_ALONG, CURVE_C2_ACROSS, CURVE_C2_ALONG,
	CURVE_C2_OFFSET_RATIO, CURVE_DISTANCE_RATIO, DEFAULT_CURVE_SCALE, DragPath, FULL_SPEED_DISTANCE, MAX_CURVE_SCALE,
	MAX_DRAG_STEPS, MAX_MOVE_DURATION_MS, MAX_PATH_SAMPLES, MIN_DRAG_STEPS, MIN_MOTION_DISTANCE, MIN_MOVE_DURATION_MS,
	MIN_PATH_SAMPLES, MOTION_EPSILON, SPRING_DAMPING_FRACTION, SPRING_DT, SPRING_FALLBACK_SETTLE_SECS,
	SPRING_MAX_STEPS, SPRING_MAX_STIFFNESS, SPRING_RESPONSE, SPRING_SETTLE_DISTANCE, STRAIGHT_C1_FRACTION,
	STRAIGHT_C2_FRACTION, STRAIGHT_MOVE_DISTANCE,
};

/// 屏幕点(左上原点)。元组而非新类型:与 FFI 边界的 CGPoint 形状一致,
/// 且这里不存在 x/y 转置的表意风险(每个函数都成对取用)。
pub type ScreenPoint = (f64, f64);

/// 进度弹簧的两个旋钮及由它们推导的一切。
///
/// `stiffness`/`drag` 在 [`SpringConfig::new`] 里推导而非手填,使这对值
/// 永不与 `response`/`damping` 失配 —— 手设一个不匹配刚度的阻力,正是
/// 「settle 动画」变成可见弹跳或永恒爬行的来路。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SpringConfig {
	pub response: f64,
	pub damping: f64,
	pub dt: f64,
	pub stiffness: f64,
	pub drag: f64,
}

impl SpringConfig {
	/// 以 *response*/*damping*/*dt* 建配置,推导刚度与阻力。
	///
	/// 每个输入都设地板:非正 `response` 会令刚度无穷(`(2π/0)²`)、首步
	/// NaN;非正 `dt` 会死循环。两者钳制而非拒绝 —— 这是装饰子系统,传傻
	/// 数字的调用方该得到丑动画,绝不是工具调用路径上的异常。
	pub fn new(response: f64, damping: f64, dt: f64) -> Self {
		let safe_response = response.max(MOTION_EPSILON);
		let safe_dt = dt.max(MOTION_EPSILON);
		let stiffness = ((2.0 * std::f64::consts::PI / safe_response).powi(2)).min(SPRING_MAX_STIFFNESS);
		let damping = damping.max(0.0);
		let drag = 2.0 * damping * stiffness.sqrt();
		Self { response: safe_response, damping, dt: safe_dt, stiffness, drag }
	}
}

impl Default for SpringConfig {
	fn default() -> Self {
		SpringConfig::new(SPRING_RESPONSE, SPRING_DAMPING_FRACTION, SPRING_DT)
	}
}

/// 左上屏幕坐标下的一条三次 Bezier。
///
/// 持控制点(而非只持采样结果)让曲线可在不同密度下重采样,且几何可直接
/// 被断言 —— 弧偏移是那个回归了人才会注意、别的断言抓不到的数。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CursorPath {
	pub start: ScreenPoint,
	pub end: ScreenPoint,
	pub control1: ScreenPoint,
	pub control2: ScreenPoint,
	pub curve_scale: f64,
	pub arc_amount: f64,
}

impl CursorPath {
	/// 参数 *t* 处的曲线点,钳在 `[0, 1]`。
	///
	/// 钳制而非外插:t 过 1 的三次 Bezier 沿末端切线飞出 —— 对假光标意味
	/// 跳过它要指的东西。端点**精确**返回(不求值):`point_at(0)`/
	/// `point_at(1)` 与 `start`/`end` 位相等,不可能漂一个浮点 ε。
	pub fn point_at(&self, t: f64) -> ScreenPoint {
		if t <= 0.0 {
			return self.start;
		}
		if t >= 1.0 {
			return self.end;
		}
		let omt = 1.0 - t;
		let a = omt * omt * omt;
		let b = 3.0 * omt * omt * t;
		let c = 3.0 * omt * t * t;
		let d = t * t * t;
		(
			a * self.start.0 + b * self.control1.0 + c * self.control2.0 + d * self.end.0,
			a * self.start.1 + b * self.control1.1 + c * self.control2.1 + d * self.end.1,
		)
	}
}

/// 一份完全解析的动画:在哪画、画多久。
///
/// supervisor 发给渲染方(REF 里是 dumb 的 overlay 进程)的唯一东西,因此
/// 预采样:渲染方里没有 Bezier,运动的每个形状决定都留在本可测模块。
#[derive(Debug, Clone, PartialEq)]
pub struct MotionPlan {
	pub points: Vec<ScreenPoint>,
	pub duration_ms: u64,
	pub path: CursorPath,
}

/// *distance* 像素位移的垂直弧幅。`clamp(distance × 0.22, 28, 110) ×
/// curve_scale` —— 参考实现的精确公式,三个常量住在 types。下限让短拨
/// 仍读作「动了一下」而非瞬移;上限让横扫全屏不弓成半圆。
pub fn curve_amount(distance: f64, curve_scale: f64) -> f64 {
	let scale = curve_scale.clamp(0.0, MAX_CURVE_SCALE);
	let raw = distance.max(0.0) * CURVE_DISTANCE_RATIO;
	raw.clamp(CURVE_AMOUNT_MIN, CURVE_AMOUNT_MAX) * scale
}

/// 从 *start* 到 *end* 建带弓的三次 Bezier。
///
/// *curve_direction* 选弓落在弦哪一侧:正 = 左手法向,负 = 右手,`0` =
/// 「由行进方向推导」(右行与左行各弓一边 —— 往返画两条不同的弧而非重描
/// 一线,参考实现同款技巧,重复移动因此不像节拍器)。
///
/// 退化输入就地处理而非让调用方设防:零长位移无方向,法向是 0/0。距离
/// 垫到 1px、方向回退 +x,得到一条(无意义的)有效路径而非满是 NaN 的曲
/// 线 —— NaN 坐标到 AppKit 是放不下的窗口,不是错误。
pub fn build_path(start: ScreenPoint, end: ScreenPoint, curve_scale: f64, curve_direction: f64) -> CursorPath {
	let (sx, sy) = start;
	let (ex, ey) = end;
	let (dx, dy) = (ex - sx, ey - sy);
	let raw_distance = dx.hypot(dy);
	let distance = raw_distance.max(MIN_MOTION_DISTANCE);

	if raw_distance <= MOTION_EPSILON {
		// 完全无位移:没有方向可导法向(朴素归一是 0/0),更重要的是没有
		// 东西可动画。折叠为全端点的退化路径,每个采样都是同一个有限点 ——
		// 给零长位移画弧,是绕着一个不动的目标画 28px 的环。
		return CursorPath { start, end, control1: start, control2: end, curve_scale: 0.0, arc_amount: 0.0 };
	}
	// 单位行进向量的左手垂直向量。
	let (norm_x, norm_y) = (-dy / raw_distance, dx / raw_distance);

	let direction = if curve_direction.abs() <= MOTION_EPSILON {
		if dx >= 0.0 { 1.0 } else { -1.0 }
	} else if curve_direction > 0.0 {
		1.0
	} else {
		-1.0
	};

	let scale = curve_scale.clamp(0.0, MAX_CURVE_SCALE);
	let amount = curve_amount(distance, scale);
	let (off_x, off_y) = (norm_x * amount * direction, norm_y * amount * direction);

	if scale <= MOTION_EPSILON {
		// curve_scale == 0:三分位、零偏移 = 精确直线。显式分支(而非依赖
		// amount == 0)使「无花活」同时意味着「空间上无不对称缓动」。
		return CursorPath {
			start,
			end,
			control1: (sx + dx * STRAIGHT_C1_FRACTION, sy + dy * STRAIGHT_C1_FRACTION),
			control2: (sx + dx * STRAIGHT_C2_FRACTION, sy + dy * STRAIGHT_C2_FRACTION),
			curve_scale: 0.0,
			arc_amount: 0.0,
		};
	}

	CursorPath {
		start,
		end,
		control1: (sx + dx * CURVE_C1_ALONG + off_x, sy + dy * CURVE_C1_ACROSS + off_y),
		control2: (
			sx + dx * CURVE_C2_ALONG + off_x * CURVE_C2_OFFSET_RATIO,
			sy + dy * CURVE_C2_ACROSS + off_y * CURVE_C2_OFFSET_RATIO,
		),
		curve_scale: scale,
		arc_amount: amount,
	}
}

/// 积分进度弹簧 0 → 1,返回全部采样值。
///
/// 固定 `dt` 的 velocity-Verlet:缓动形状不得依赖渲染方恰好多快 —— 时间在
/// 此模拟,渲染方只决定画其中多少。
///
/// 返回值恒以精确 `0.0` 开头、精确 `1.0` 结尾。末位钳制不是装饰:出厂常数
/// 下弹簧 settle 在 `1.0000139`,把 `t > 1` 喂进三次 Bezier 会外插冲过目标
/// —— 假光标肉眼可见地射过它指着的东西。钳**进度**(而非之后钳位置)把
/// 过冲整个挡在模型之外。
///
/// 以 `SPRING_MAX_STEPS` 封顶:病态配置(调用方荒谬的 response、永不
/// settle 的 0 阻尼)以一条可用但难看的曲线终止,而不是死循环。
pub fn spring_progress_curve(config: &SpringConfig) -> Vec<f64> {
	let mut values = vec![0.0];
	let mut current = 0.0;
	let mut velocity = 0.0;
	let mut force = 0.0;
	let half_dt = config.dt * 0.5;
	for _ in 0..SPRING_MAX_STEPS {
		let velocity_half = velocity + force * half_dt;
		current += velocity_half * config.dt;
		force = config.stiffness * (1.0 - current) - config.drag * velocity_half;
		velocity = velocity_half + force * half_dt;
		if !current.is_finite() {
			// 调用方给的配置发散了。带着已有的退出:采样器容忍短曲线,
			// 动画退化为一次快速移动,而不是把异常抛进工具调用。
			break;
		}
		values.push(current);
		if current >= 1.0 && (1.0 - current).abs() <= SPRING_SETTLE_DISTANCE {
			break;
		}
	}
	let last = values.len() - 1;
	values[last] = 1.0;
	values
}

/// 进度弹簧 settle 到 1.0 的模拟秒数。
///
/// 从缓动所用的同一积分导出,动画的**时长**与**形状**永不失配 —— 独立挑
/// 的时长要么把 settle 截在余振里,要么在光标停了之后还举着它。积分器提前
/// 退出时回退到实测常数。
pub fn settle_time(config: &SpringConfig) -> f64 {
	let curve = spring_progress_curve(config);
	let steps = curve.len() - 1;
	if steps == 0 {
		return SPRING_FALLBACK_SETTLE_SECS;
	}
	steps as f64 * config.dt
}

/// 以 *samples* 个点采样 *path*,按进度弹簧缓动。
///
/// 第 k 个输出点是 `path.point_at(progress[k'])`,`k'` 按**均匀时间**步进
/// 走弹簧进度曲线 —— 点在**距离**上不均匀(首尾密、中段疏)、在**时间**上
/// 均匀。渲染方恒帧率画它们即得 ease-in/ease-out,自己不需要任何缓动逻辑。
///
/// 首末采样是路径的精确端点。端点保证是点击脉冲的依托:脉冲画在最后一个
/// 采样点上,差一像素的采样器会把视觉点击放到元素旁边而不是它身上。
pub fn sample_path(path: &CursorPath, samples: usize, config: &SpringConfig) -> Vec<ScreenPoint> {
	let count = samples.clamp(MIN_PATH_SAMPLES, MAX_PATH_SAMPLES);
	let curve = spring_progress_curve(config);
	let last = curve.len() - 1;
	let mut out = Vec::with_capacity(count);
	for step in 0..count {
		// 均匀于弹簧自身步数:更长的 settle 只是把同数量的点摊到曲线更多段。
		let idx = if count == 1 { 0 } else { ((step * last) as f64 / (count - 1) as f64).round() as usize };
		out.push(path.point_at(curve[idx.min(last)]));
	}
	out[0] = path.start;
	let end = count - 1;
	out[end] = path.end;
	out
}

/// 一段 DRAG 途经的点,*start* 到 *end* 含两端。
///
/// 与装饰性的光标滑行共享本模块只有一个理由:`curved` 的形状就是手绘笔
/// 划的形状,算两遍会让画出的手势与画出的光标分道。但两者的缓动不同,
/// 且差异承重:
///
/// * [`sample_path`] 的采样在**时间**上均匀(经进度弹簧)—— 渲染方恒帧率
///   作画,不均匀的间距**就是** ease-in/ease-out;
/// * 拖拽的采样在**参数**上均匀 —— 这些点作为指针位置投递而非被画。
///   弹簧缓动会把笔划的大多数位置堆在两端,中段由几个长跳掠过 —— 曲线
///   中央一条看得见的弦,恰是多点拖拽要修的缺陷。
///
/// `steps` 数的是**段**,结果 `steps + 1` 个点;`steps = 1` 恰为
/// `(start, end)` —— 朴素两点拖拽,它因此是默认值,任何现存调用不改形状。
///
/// 两端点**精确**返回、永不求值:拖拽的释放点是落点,也是约束检查授权的
/// 那个点,不许漂一个浮点 ε。
///
/// 钳制而非校验:这是几何;收模型输入的调用方(tools 的 drag 请求构造、
/// schema)在到达这里之前就以可读消息拒绝超范围的值。未知 *path* 回退
/// 直线 —— 未来的拼法退到安全的形状。
pub fn drag_points(start: ScreenPoint, end: ScreenPoint, steps: u16, path: DragPath) -> Vec<ScreenPoint> {
	let count = usize::from(steps.clamp(MIN_DRAG_STEPS, MAX_DRAG_STEPS));
	let (sx, sy) = start;
	let (ex, ey) = end;
	if count <= 1 {
		return vec![(sx, sy), (ex, ey)];
	}
	let distance = (ex - sx).hypot(ey - sy);
	// **短**手势画直线 —— 与 plan_motion 给装饰滑行用的同规则同阈值,
	// 且这里是正确性而非观感:curve_amount 把弧垫在 28px 下限,2px 的
	// 「curved」拖拽会弓出弦外 16px —— 手势长度的八倍。两个后果,第二个
	// 要紧:路径的每个点都受约束(两个 driver 都是),窗缘附近的短弯笔
	// 划会为一个模型从未要求到访的**点**被拒 —— 拒绝还点名它没发过的
	// 坐标,正是 ERR_POINT_NOT_OWNED 要挡出模型之路的那种无出口重试循环。
	// 同一道闸也让「共享几何」的论证成立:没有它,同一对点上的拖拽弓了、
	// 滑行直了 —— 恰是共享模块要防的分道。
	let shaped = path == DragPath::Curved && distance >= STRAIGHT_MOVE_DISTANCE;
	let mut out: Vec<ScreenPoint> = if shaped {
		let curve = build_path((sx, sy), (ex, ey), DEFAULT_CURVE_SCALE, 0.0);
		(0..=count).map(|i| curve.point_at(i as f64 / count as f64)).collect()
	} else {
		(0..=count)
			.map(|i| {
				let t = i as f64 / count as f64;
				(sx + (ex - sx) * t, sy + (ey - sy) * t)
			})
			.collect()
	};
	out[0] = (sx, sy);
	let last = out.len() - 1;
	out[last] = (ex, ey);
	out
}

/// 建路径、采样、钳时长 —— 唯一入口。
///
/// 时长来自 [`settle_time`](弹簧自己的 settle 点),再钳到 `[100, 2000]` ms。
/// 钳制是记录在 types 的产品决定:低于 100ms 的运动读作瞬移,示能消失;
/// 纯装饰的东西无论弹簧说什么都不许拖住调用方超过 2s。
pub fn plan_motion(
	start: ScreenPoint,
	end: ScreenPoint,
	curve_scale: f64,
	curve_direction: f64,
	samples: usize,
	config: &SpringConfig,
) -> MotionPlan {
	let distance = (end.0 - start.0).hypot(end.1 - start.1);

	// **短**跳画直线。curve_amount 把弧垫在 28px,1-3px 的微动会弓出 ~28px
	// 再回来 —— 眼睛读作「它几乎没动」的动上一圈看得见的卷曲。
	// 改前实测:1px 位移产出 arc=28.0。
	let curve_scale = if distance < STRAIGHT_MOVE_DISTANCE { 0.0 } else { curve_scale };
	let path = build_path(start, end, curve_scale, curve_direction);
	let points = sample_path(&path, samples, config);

	// 时长按距离缩放。弹簧 settle 点与距离**无关**,原样使用会让 1px 微动
	// 与 600px 横扫同为 ~1429ms —— 读作卡死,不是运动。距离过
	// FULL_SPEED_DISTANCE 用弹簧自身时序不变;以下线性收敛到下限。
	let mut raw_ms = settle_time(config) * 1000.0;
	if distance < FULL_SPEED_DISTANCE {
		raw_ms *= distance.max(0.0) / FULL_SPEED_DISTANCE;
	}
	let duration_ms = (raw_ms.round() as i64).clamp(MIN_MOVE_DURATION_MS as i64, MAX_MOVE_DURATION_MS as i64);
	MotionPlan { points, duration_ms: duration_ms as u64, path }
}

#[cfg(test)]
mod tests {
	use super::*;
	use crate::types::DEFAULT_PATH_SAMPLES;

	#[test]
	fn endpoints_are_exact_never_evaluated() {
		let path = build_path((10.0, 10.0), (400.0, 300.0), DEFAULT_CURVE_SCALE, 0.0);
		assert_eq!(path.point_at(0.0), (10.0, 10.0));
		assert_eq!(path.point_at(1.0), (400.0, 300.0));
		// t 过界:钳制,不外插。
		assert_eq!(path.point_at(-0.5), (10.0, 10.0));
		assert_eq!(path.point_at(1.5), (400.0, 300.0));
		// 零长位移:全端点退化路径,有限无 NaN。
		let degenerate = build_path((5.0, 5.0), (5.0, 5.0), 1.0, 0.0);
		assert_eq!(degenerate.point_at(0.5), (5.0, 5.0));
		assert_eq!(degenerate.arc_amount, 0.0);
	}

	#[test]
	fn curve_amount_clamps() {
		assert_eq!(curve_amount(0.0, 1.0), 28.0); // 下限
		assert_eq!(curve_amount(10.0, 1.0), 28.0);
		assert!((curve_amount(200.0, 1.0) - 44.0).abs() < 1e-9); // 200×0.22
		assert_eq!(curve_amount(1000.0, 1.0), 110.0); // 上限
		assert_eq!(curve_amount(1000.0, 0.0), 0.0);
		assert_eq!(curve_amount(1000.0, 9.0), 440.0); // scale 上限 4
	}

	#[test]
	fn zero_curve_scale_is_a_straight_line() {
		let path = build_path((0.0, 0.0), (300.0, 0.0), 0.0, 0.0);
		assert_eq!(path.arc_amount, 0.0);
		// 三分位手柄:t=0.5 恰为中点。
		let mid = path.point_at(0.5);
		assert!((mid.0 - 150.0).abs() < 1e-9 && mid.1.abs() < 1e-9);
	}

	#[test]
	fn arc_bows_off_the_chord() {
		let path = build_path((0.0, 0.0), (400.0, 0.0), 1.0, 0.0);
		assert!((path.arc_amount - 88.0).abs() < 1e-9); // 400×0.22
		let mid = path.point_at(0.5);
		// 右行(dx≥0)direction=+1,左手法向 = (0,1)(y 向下)→ 弓向屏幕下方。
		// 不对称手柄下中点偏移 ≈ 0.5×弧幅(实测 400px/88px 弓 → 48.8px)。
		assert!(mid.1 > 40.0, "arc must bow visibly: {mid:?}");
		// 反向:curve_direction 负值把弓翻到另一侧。
		let flipped = build_path((0.0, 0.0), (400.0, 0.0), 1.0, -1.0);
		assert!(flipped.point_at(0.5).1 < -40.0);
		// 左行:direction=sign(dx)=-1 与法向 y 分量(dx/d=-1)相乘,弓仍向
		// 屏幕下方 —— 水平往返同侧下垂,但不对称手柄(0.18/0.80)让两条弧
		// 形状不同,不重描一线。
		let leftward = build_path((400.0, 0.0), (0.0, 0.0), 1.0, 0.0);
		assert!(leftward.point_at(0.5).1 > 40.0, "leftward mid: {:?}", leftward.point_at(0.5));
	}

	#[test]
	fn spring_curve_bounds_and_bounded_steps() {
		let curve = spring_progress_curve(&SpringConfig::default());
		assert_eq!(curve[0], 0.0);
		assert_eq!(*curve.last().unwrap(), 1.0);
		assert!(curve.iter().all(|v| v.is_finite()));
		assert!(curve.len() <= SPRING_MAX_STEPS + 1);
		// 过冲在进度里被钳:任何采样不越过 settle 距离之外。
		assert!(curve.iter().all(|v| *v <= 1.0 + SPRING_SETTLE_DISTANCE));
	}

	#[test]
	fn stiffness_capped_and_settle_time_matches_curve() {
		let cfg = SpringConfig::new(0.0001, 0.9, SPRING_DT);
		assert_eq!(cfg.stiffness, SPRING_MAX_STIFFNESS); // (2π/1e-4)² 远超上限
		let cfg = SpringConfig::default();
		let curve = spring_progress_curve(&cfg);
		assert!((settle_time(&cfg) - (curve.len() - 1) as f64 * SPRING_DT).abs() < 1e-12);
		// 出厂常数:~1.43s 量级(REF 实测 1429ms)。
		let secs = settle_time(&SpringConfig::default());
		assert!((1.2..1.7).contains(&secs), "settle {secs}");
	}

	#[test]
	fn sample_path_is_exact_at_ends_and_time_uniform() {
		let path = build_path((0.0, 0.0), (100.0, 0.0), 0.0, 0.0);
		let points = sample_path(&path, 96, &SpringConfig::default());
		assert_eq!(points.len(), 96);
		assert_eq!(points[0], (0.0, 0.0));
		assert_eq!(points[95], (100.0, 0.0));
		// 样本数钳制。
		let tiny = sample_path(&path, 0, &SpringConfig::default());
		assert_eq!(tiny.len(), MIN_PATH_SAMPLES);
		let huge = sample_path(&path, 100_000, &SpringConfig::default());
		assert_eq!(huge.len(), MAX_PATH_SAMPLES);
	}

	#[test]
	fn drag_points_shapes() {
		// steps=1:恰好两端点。
		assert_eq!(drag_points((0.0, 0.0), (10.0, 10.0), 1, DragPath::Straight), vec![(0.0, 0.0), (10.0, 10.0)]);
		// 直线多段:参数均匀。
		let straight = drag_points((0.0, 0.0), (30.0, 0.0), 3, DragPath::Straight);
		assert_eq!(straight, vec![(0.0, 0.0), (10.0, 0.0), (20.0, 0.0), (30.0, 0.0)]);
		// 长距离 curved:中点离弦 ≥ 弧的一部分。
		let curved = drag_points((0.0, 0.0), (400.0, 0.0), 8, DragPath::Curved);
		assert_eq!(curved.len(), 9);
		assert_eq!(curved[0], (0.0, 0.0));
		assert_eq!(curved[8], (400.0, 0.0));
		assert!(curved[4].1 > 40.0, "curved midpoint must leave the chord: {:?}", curved[4]);
		// 短距离 curved:直线(弧下限 28px 会画出手势 8 倍长的卷曲)。
		let short = drag_points((0.0, 0.0), (10.0, 0.0), 4, DragPath::Curved);
		assert!(short.iter().all(|p| p.1.abs() < 1e-9));
		// steps 钳制到 [1, 512]。
		assert_eq!(drag_points((0.0, 0.0), (5.0, 0.0), 0, DragPath::Straight).len(), 2);
		assert_eq!(
			drag_points((0.0, 0.0), (5.0, 0.0), u16::MAX, DragPath::Straight).len(),
			usize::from(MAX_DRAG_STEPS) + 1
		);
	}

	#[test]
	fn plan_motion_short_hops_go_straight_and_fast() {
		let plan =
			plan_motion((100.0, 100.0), (101.0, 100.0), 1.0, 0.0, DEFAULT_PATH_SAMPLES, &SpringConfig::default());
		assert_eq!(plan.path.arc_amount, 0.0); // < 24px:弃弧
		// 距离 1px:时长线性缩到 ~3.6ms → 钳到下限 100ms。
		assert_eq!(plan.duration_ms, MIN_MOVE_DURATION_MS);
		assert_eq!(plan.points.first(), Some(&(100.0, 100.0)));
		assert_eq!(plan.points.last(), Some(&(101.0, 100.0)));

		// 远距全速:弹簧完整 settle(~1429ms)。
		let far = plan_motion((0.0, 0.0), (900.0, 0.0), 1.0, 0.0, DEFAULT_PATH_SAMPLES, &SpringConfig::default());
		assert!(far.path.arc_amount > 0.0);
		assert!((1300.0..1600.0).contains(&(far.duration_ms as f64)), "{}", far.duration_ms);

		// 全速距离内:比例缩放,仍 > 100ms 下限。
		let mid = plan_motion((0.0, 0.0), (200.0, 0.0), 1.0, 0.0, DEFAULT_PATH_SAMPLES, &SpringConfig::default());
		assert!(mid.duration_ms > MIN_MOVE_DURATION_MS && mid.duration_ms < 1600, "{}", mid.duration_ms);
	}
}
