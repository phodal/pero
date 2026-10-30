//! `click_method: "sky_click"` —— 私有 SkyLight 后台窗口点击。REF
//! `macos_skylight.py` 的移植。
//!
//! **本模块是隔离仓。** 它是本包唯一允许触碰未公开 Apple ABI 的地方,独自
//! 成模块(而非并入 `ffi.rs`)是为了:
//!
//! * `ffi.rs` 保持「仅公开框架」的性质 —— 那是它可对照 Apple 文档审阅的
//!   前提;
//! * 未来每次 macOS 兼容性破裂只有一个审阅边界:某个小版本改掉字节偏移
//!   或删掉符号,爆炸半径就是这个文件;
//! * 私有面可以整体禁用([`available`])而不触碰任何其它代码路径。
//!
//! **它买到什么。** sky_click 点击一个**位于其它窗口之后**的窗口,不抬升
//! 它、不动操作者光标。两条公开路径都做不到:`accessibility` 需要可寻址元
//! 素(很多画布没有),`app_post` 虽投递到应用但被「按窗口服务器的前后序
//! 做命中测试」的渲染器忽略 —— 实践中就是浏览器引擎支撑的那批应用。这个
//! 缺口是真实撞上的:Freeform 画布压在 Zoom 批注层之下时,任何公开方法都
//! 画不上去。
//!
//! **ABI 从哪来。** 符号声明与事件字段配方派生自先前对这条路径做过逆向的
//! 宽松许可开源工作(REF 的 `NOTICE` 有署名)。Apple 未发布其中任何内
//! 容:激活记录的字节布局与数值字段是**观察到的行为**,WindowServer 也不
//! 文档化 click-group 字段接受的宽度。这里的每个常量都按「观察所得」对
//! 待,不是「规格如此」。
//!
//! **永远 fail-closed。** [`available`] 报告缺哪些符号;每个入口在 SPI 不
//! 可用时给出类型化、模型可读的拒绝。一个删掉 `SLEventPostToPid` 的未来
//! macOS 必须降级为「此方法不可用,改用 app_post」—— 绝不崩溃,也绝不静
//! 默地把点击投错地方。
//!
//! 纯函数([`activation_record`]/[`click_recipe`])与投递分离:字节布局可
//! 以在**没有窗口服务器**的机器上单测 —— 在别处这都比不上这里要紧,这是
//! 未文档化 ABI,未来某次编辑悄悄改掉一个偏移的唯一察觉方式就是钉住字节。
//! 投递([`sky_click`] 本体:stale 复查、合成聚焦、双通道投递、进程级串行
//! 化)在纯函数之后。

use std::ffi::{CString, c_void};
use std::os::raw::c_double;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use point_computer_core::types::{ComputerUseError, ERR_SKY_CLICK_BUTTON, MouseButton, fill};

use crate::ffi::{self, c_int32_t, c_int64_t, sys};

// ── 私有框架 ──
// 绝对路径而非搜索:PrivateFrameworks 不在标准搜索路径上。缺失路径的
// dlopen 就是失败 —— 那正是我们要的降级。
const SKYLIGHT_PATH: &str = "/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight";
const APP_SERVICES_PATH: &str = "/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices";

// ── 私有符号 ──
// `CGEventSetWindowLocation` 虽带 CG 前缀却住在 SkyLight;`GetProcessForPID`
// 是 ApplicationServices 里已废弃但在场的 Carbon 调用。命名为常量,好让
// 「缺哪个符号」的诊断能把它们引述给操作者。
const SYM_POST_TO_PID: &str = "SLEventPostToPid";
const SYM_SET_INT_FIELD: &str = "SLEventSetIntegerValueField";
const SYM_SET_WINDOW_LOCATION: &str = "CGEventSetWindowLocation";
const SYM_POST_EVENT_RECORD: &str = "SLPSPostEventRecordTo";
const SYM_GET_PROCESS_FOR_PID: &str = "GetProcessForPID";

// ── 激活记录 ──
// 一条 0xF8 字节的事件记录,让窗口服务器把某进程的某窗口当作合成聚焦。
// 下方每个偏移都是从参考实现抄来的**观察所得**,无一有文档。Apple 可以
// 改掉其中任何一处。
const RECORD_SIZE: usize = 0xF8;
/// 偏移 0x04:承载记录自身长度。
const RECORD_OFF_SIZE: usize = 0x04;
/// 偏移 0x08:0x0D = 激活/去活这个 kind。
const RECORD_OFF_KIND: usize = 0x08;
/// 偏移 0x3C:4 字节小端 window id。
const RECORD_OFF_WINDOW_ID: usize = 0x3C;
/// 偏移 0x8A:0x01 = 激活,0x02 = 去活。
const RECORD_OFF_FOCUSED: usize = 0x8A;
const RECORD_KIND_ACTIVATE: u8 = 0x0D;
const RECORD_FOCUSED_YES: u8 = 0x01;
const RECORD_FOCUSED_NO: u8 = 0x02;
/// ProcessSerialNumber 是两个 32 位半;`GetProcessForPID` 填两个。
pub const PSN_SIZE: usize = 8;

// ── 私有事件字段 ──
// 窗口服务器把点击路由到指定窗口时读的裸 `CGEventField` 编号。公开枚举
// 不含它们。
pub const FIELD_GESTURE_PHASE: u32 = 0;
pub const FIELD_CLICK_STATE: u32 = 1;
pub const FIELD_BUTTON_NUMBER: u32 = 3;
pub const FIELD_SUBTYPE: u32 = 7;
pub const FIELD_TARGET_PID: u32 = 40;
pub const FIELD_WINDOW_NUMBER: u32 = 51;
pub const FIELD_CLICK_GROUP_ID: u32 = 58;
pub const FIELD_WINDOW_UNDER_POINTER: u32 = 91;
pub const FIELD_HANDLING_WINDOW_UNDER_POINTER: u32 = 92;
/// 观察所得常量:subtype 3 是真实窗口化鼠标事件携带的值。
pub const EVENT_SUBTYPE_WINDOWED: i64 = 3;

// ── 点击配方 ──
// 真实点击之前有一对在 (-1, -1) 的「底火」down/up。它不是重试:它让窗口
// 服务器把随后那对接受为对**目标**窗口的点击而非对最前窗口的。去掉它,
// 真实点击会落在最前窗口上 —— 那正是这个方法存在的全部理由所针对的
// bug。
pub const PRIMER_POINT: (f64, f64) = (-1.0, -1.0);
const PHASE_MOVED: i64 = 2;
const PHASE_PRIMER_DOWN: i64 = 1;
const PHASE_PRIMER_UP: i64 = 2;
const PHASE_TARGET: i64 = 3;
// 延时(秒)。对着真实应用现场调出来的。它们就是本方法的代价:单击
// ~0.12s。
pub const DELAY_AFTER_MOVE: f64 = 0.015;
pub const DELAY_AFTER_PRIMER_DOWN: f64 = 0.001;
pub const DELAY_AFTER_PRIMER_UP: f64 = 0.100;
pub const DELAY_AFTER_TARGET_DOWN: f64 = 0.001;
pub const DELAY_BETWEEN_CLICK_PAIRS: f64 = 0.080;
// 合成聚焦需要时间被目标观察到,而最后的 mouse-up 必须在聚焦撤掉**之前**
// 被消费,否则自做命中测试的浏览器引擎渲染器会错过它。
pub const DELAY_FOCUS_SETTLE: f64 = 0.040;
pub const DELAY_BEFORE_FOCUS_RELEASE: f64 = 0.100;
/// `kCGEventSourceStateHIDSystemState`。**声明在这里**而非借自 `ffi.rs`:
/// 那个模块只造私有源事件(修饰键卫生),没有 HID 常量可借,在那里加一
/// 个只会邀请某条公开路径去用它。sky_click 需要 HID 源:合成聚焦记录必须
/// 被窗口服务器当作真实输入流的一部分来路由,私有源的记录它不认。这是本
/// 包唯一出现 HID source 的地方。
pub const K_CG_EVENT_SOURCE_STATE_HID: i32 = 1;

/// 字段 58 接受的宽度未公开,group id 保持在被观察到可接受的范围内
//(纳秒分量,恒 < 1e9)。
pub const CLICK_GROUP_MODULUS: u64 = 1_000_000_000;

/// sky_click 只支持单击与双击。三连击不在观察到的配方里,发明第三对等于
/// 对 ABI 瞎猜。
pub const MAX_SKY_CLICK_COUNT: u8 = 2;
pub const MIN_SKY_CLICK_COUNT: u8 = 1;

const REFUSAL_UNAVAILABLE: &str = "click_method 'sky_click' is unavailable on this system ({reason}). Use click_method 'app_post' instead — it delivers to the same application through a public API, and only fails to reach renderers that hit-test against the window server";
const REFUSAL_COUNT: &str = "click_method 'sky_click' supports click_count 1 or 2 (got {count}). Use click_method 'app_post' for a triple click";
/// sky_click 是**仅左键**配方 —— 措辞见 core 的 `ERR_SKY_CLICK_BUTTON`,执法
/// 门在 `policy::check_method_button`。观察到的私有事件序(底火对、聚焦记
/// 录、九个私有字段)是对左键逆向出来的;按钮号只是其中一字段,没有证据
/// 说其余配方与按钮无关。
const REFUSAL_BUTTON: &str = ERR_SKY_CLICK_BUTTON;

/// 私有 SPI 在本机是否可用;不可用时为什么。
#[derive(Clone, Debug, Default)]
pub struct SkyLightCapability {
	pub missing_symbols: Vec<&'static str>,
	pub load_error: &'static str,
}

impl SkyLightCapability {
	pub fn is_available(&self) -> bool {
		self.missing_symbols.is_empty() && self.load_error.is_empty()
	}

	/// 模型可读的解释;可用时为空。
	pub fn reason(&self) -> String {
		if !self.load_error.is_empty() {
			return self.load_error.to_string();
		}
		if !self.missing_symbols.is_empty() {
			return format!("missing private symbols: {}", self.missing_symbols.join(", "));
		}
		String::new()
	}
}

// ── 绑定后的私有符号 ──

type PostToPidFn = unsafe extern "C" fn(c_int32_t, *const c_void);
type SetIntFieldFn = unsafe extern "C" fn(*const c_void, u32, c_int64_t);
// 标量 double,**不是**按值 CGPoint:参考实现把这条私有 ABI 建模为
// (event, double, double),并注明依赖聚合调用约定才是会断的做法。保持标
// 量形式。
type SetWindowLocationFn = unsafe extern "C" fn(*const c_void, c_double, c_double);
type PostEventRecordFn = unsafe extern "C" fn(*const c_void, *const u8) -> c_int32_t;
type GetProcessForPidFn = unsafe extern "C" fn(c_int32_t, *mut c_void) -> c_int32_t;

/// 一次 `dlopen`(RTLD_LAZY|RTLD_LOCAL),缺失 → `None`,永不失败。
fn dlopen_path(path: &str) -> Option<*mut c_void> {
	let c_path = CString::new(path).ok()?;
	// SAFETY:路径常量 NUL 结尾;句柄进程期内不 dlclose(与 REF 持有 CDLL
	// 同义),指针因此恒有效。
	let handle = unsafe { sys::dlopen(c_path.as_ptr(), sys::RTLD_LAZY_LOCAL) };
	(!handle.is_null()).then_some(handle)
}

/// 在 *handle* 里解析一个符号为函数指针;缺失记入 *missing*。
///
/// # Safety
/// *sym* 的真实签名必须与 *T* 一致 —— 全部五处调用点紧挨着各自的 type
/// 别名,签名就住在名字旁边。
unsafe fn bind_fn<T>(handle: *mut c_void, sym: &'static str, missing: &mut Vec<&'static str>) -> Option<T>
where
	T: Copy,
{
	let name = CString::new(sym).ok()?;
	// SAFETY:调用者保证 handle 来自成功 dlopen;名称 NUL 结尾。
	let raw = unsafe { sys::dlsym(handle, name.as_ptr()) };
	if raw.is_null() {
		missing.push(sym);
		return None;
	}
	// SAFETY:transmute_copy 逐位拷贝指针宽度的字节到 T —— 每个 T 都是
	// fn 指针(8 字节,与 *mut c_void 同宽);签名约束见本函数的 Safety 契
	// 约。泛型 T 上直接 transmute 需要编译期证明大小,这里用 _copy 绕开的
	// 正是那个证明而非任何安全性。
	Some(unsafe { std::mem::transmute_copy::<*mut c_void, T>(&raw) })
}

/// 绑定后的私有符号集合,或解释缺席的能力报告。
///
/// 只构造一次。与 REF 同:缺符号**永不**是错误 —— 私有 API 不可用是预期
/// 状态(未来的 macOS、精简过的系统),调用方把它折成点名公开替代的拒
/// 绝。
pub struct SkyLightSpi {
	pub post_to_pid: Option<PostToPidFn>,
	pub set_int_field: Option<SetIntFieldFn>,
	pub set_window_location: Option<SetWindowLocationFn>,
	pub post_event_record: Option<PostEventRecordFn>,
	pub get_process_for_pid: Option<GetProcessForPidFn>,
	pub capability: SkyLightCapability,
}

impl SkyLightSpi {
	fn load() -> Self {
		let mut spi = SkyLightSpi {
			post_to_pid: None,
			set_int_field: None,
			set_window_location: None,
			post_event_record: None,
			get_process_for_pid: None,
			capability: SkyLightCapability::default(),
		};
		let Some(sky) = dlopen_path(SKYLIGHT_PATH) else {
			spi.capability.load_error = "the private SkyLight framework could not be loaded";
			return spi;
		};
		let app_services = dlopen_path(APP_SERVICES_PATH);
		let mut missing: Vec<&'static str> = Vec::new();
		// SAFETY:每个符号的真实签名与紧邻的 type 别名一致(见 bind_fn 契
		// 约),来源是成功 dlopen 的框架句柄。
		unsafe {
			spi.post_to_pid = bind_fn(sky, SYM_POST_TO_PID, &mut missing);
			spi.set_int_field = bind_fn(sky, SYM_SET_INT_FIELD, &mut missing);
			spi.set_window_location = bind_fn(sky, SYM_SET_WINDOW_LOCATION, &mut missing);
			spi.post_event_record = bind_fn(sky, SYM_POST_EVENT_RECORD, &mut missing);
			match app_services {
				Some(asv) => spi.get_process_for_pid = bind_fn(asv, SYM_GET_PROCESS_FOR_PID, &mut missing),
				None => missing.push(SYM_GET_PROCESS_FOR_PID),
			}
		}
		spi.capability.missing_symbols = missing;
		spi
	}
}

static SPI: OnceLock<SkyLightSpi> = OnceLock::new();

/// 取进程级 SPI 单例(首次调用触发加载)。
pub fn spi() -> &'static SkyLightSpi {
	SPI.get_or_init(SkyLightSpi::load)
}

/// sky_click 在本机能否运行;首次调用后即廉价。
///
/// doctor 与 driver 都读它:设置面板因此能说「此 macOS 上不可用」,而非让
/// 操作者选一个永远被拒的方法。
pub fn available() -> SkyLightCapability {
	spi().capability.clone()
}

/// 不可用时的模型可读拒绝(点名公开替代)。
pub fn unavailable_refusal() -> String {
	fill(REFUSAL_UNAVAILABLE, &[("{reason}", spi().capability.reason().as_str())])
}

// ── 纯函数:激活记录 ──

/// 构造 0xF8 字节的窗口激活记录。
///
/// 纯函数、与投递分离,字节布局因此在没有窗口服务器的机器上可单测。
pub fn activation_record(window_id: u32, focused: bool) -> [u8; RECORD_SIZE] {
	let mut record = [0u8; RECORD_SIZE];
	record[RECORD_OFF_SIZE] = RECORD_SIZE as u8;
	record[RECORD_OFF_KIND] = RECORD_KIND_ACTIVATE;
	record[RECORD_OFF_WINDOW_ID..RECORD_OFF_WINDOW_ID + 4].copy_from_slice(&window_id.to_le_bytes());
	record[RECORD_OFF_FOCUSED] = if focused { RECORD_FOCUSED_YES } else { RECORD_FOCUSED_NO };
	record
}

const REFUSAL_STALE_WINDOW: &str = "the sky_click target window is no longer on screen or no longer belongs to that application. Call computer_get_state again to re-resolve it";
const REFUSAL_NO_WINDOW_ID: &str = "click_method 'sky_click' needs a resolved window id, and the driver did not report one for this application. Use click_method 'app_post' instead";
const REFUSAL_OUTSIDE_WINDOW: &str = "the sky_click point is outside the target window's bounds. Call computer_get_state again — the window has probably moved or resized";
const REFUSAL_PSN: &str = "click_method 'sky_click' could not resolve pid {pid} to a process serial number (OSStatus {status}). Use click_method 'app_post' instead";
const REFUSAL_FOCUS: &str = "click_method 'sky_click' could not synthesize target-window focus (OSStatus {status}). Use click_method 'app_post' instead";
const REFUSAL_EVENT: &str = "click_method 'sky_click' could not build a mouse event";

/// 一次只许一个 sky_click,进程级(REF `_dispatch_lock`)。这个方法修改全
/// 局窗口服务器的聚焦状态再还原;两条交错序列会互相还原对方,留下一个窗
/// 口被合成聚焦地挂着。中毒锁直接接管:持锁线程 panic 只意味着那条序列没
/// 走完,窗口服务器状态由下一次真实点击修正,进程不必因此永久失去这个方
/// 法(本包契约:永不 panic 不等于把可恢复状态升级成死锁)。
static DISPATCH_LOCK: Mutex<()> = Mutex::new(());

/// click-group id 的进程 epoch(REF 用 `time.monotonic_ns()`;这里只需要
/// 「每次调用不同且落在被观察可接受的值域内」,绝对纪元无意义)。
static GROUP_EPOCH: OnceLock<Instant> = OnceLock::new();

/// 字段 58 接受的宽度未公开:保持在被观察到可接受的范围内(纳秒分量,
/// 恒 < 1e9)。
fn click_group_id() -> u64 {
	let epoch = GROUP_EPOCH.get_or_init(Instant::now);
	(epoch.elapsed().as_nanos() as u64) % CLICK_GROUP_MODULUS
}

/// *window_id* 仍在屏且仍属 *pid*(REF `_window_is_current`)。
///
/// 点击前立即复查,不信快照的旧值:窗口服务商会回收 window id,过期 id 可
/// 能命名**另一个**窗口 —— 而这个方法的全部目的是点击操作者看不见的东
/// 西,投错一次他们也无从察觉。
fn window_is_current(window_id: u32, pid: i32) -> bool {
	ffi::window_list().iter().any(|info| info.window_id == window_id && info.pid == pid)
}

/// *pid* 是否拥有最前的普通窗口(REF `_is_frontmost`)。
///
/// 从 CG 窗口列表读而非 `NSWorkspace`(Swift 参考那么做):本包刻意不链
/// AppKit,在屏 layer-0 列表的第一个条目就是同一个答案,不用第二个框架。
/// 走查失败按非前台处理(fail-closed:多一次聚焦翻转的代价远小于对前台窗
/// 口误判带来的真聚焦丢失)。
fn is_frontmost(pid: i32) -> bool {
	for info in ffi::window_list() {
		if info.layer != ffi::CG_WINDOW_LAYER_NORMAL {
			continue;
		}
		return info.pid == pid;
	}
	false
}

/// 五个私有符号全部绑定后的非可选视图。
///
/// 入口处的能力检查保证它们在场;把「解包 Option」折到这里,下游每条投递
/// 路径都拿着确定存在的符号 —— 类型上消灭「走到一半才发现缺符号」的分支。
struct BoundSpi {
	post_to_pid: PostToPidFn,
	set_int_field: SetIntFieldFn,
	set_window_location: SetWindowLocationFn,
	post_event_record: PostEventRecordFn,
	get_process_for_pid: GetProcessForPidFn,
}

fn bound_spi() -> Option<BoundSpi> {
	let spi = spi();
	Some(BoundSpi {
		post_to_pid: spi.post_to_pid?,
		set_int_field: spi.set_int_field?,
		set_window_location: spi.set_window_location?,
		post_event_record: spi.post_event_record?,
		get_process_for_pid: spi.get_process_for_pid?,
	})
}

/// pid → ProcessSerialNumber(8 字节),失败折 REFUSAL_PSN。
fn process_serial_number(bound: &BoundSpi, pid: i32) -> Result<[u8; PSN_SIZE], ComputerUseError> {
	let mut buffer = [0u8; PSN_SIZE];
	// SAFETY:bound 来自入口能力检查后的解包;buffer 与 PSN_SIZE 同大。
	let status = unsafe { (bound.get_process_for_pid)(pid, buffer.as_mut_ptr() as *mut c_void) };
	if status != 0 {
		return Err(ComputerUseError::Unsupported(fill(
			REFUSAL_PSN,
			&[("{pid}", pid.to_string().as_str()), ("{status}", status.to_string().as_str())],
		)));
	}
	Ok(buffer)
}

/// 投递一条激活记录(REF `_post_activation`);失败折 REFUSAL_FOCUS。
fn post_activation(bound: &BoundSpi, psn: &[u8; PSN_SIZE], record: &[u8; RECORD_SIZE]) -> Result<(), ComputerUseError> {
	// SAFETY:psn/record 是定长栈数组,指针在调用期间有效。
	let status = unsafe { (bound.post_event_record)(psn.as_ptr() as *const c_void, record.as_ptr()) };
	if status != 0 {
		return Err(ComputerUseError::Unsupported(fill(REFUSAL_FOCUS, &[("{status}", status.to_string().as_str())])));
	}
	Ok(())
}

/// 把目标窗口标成合成聚焦;返回**是否需要撤销**(REF `_begin_synthetic_focus`)。
///
/// 目标已在前台时跳过:给已聚焦的窗口翻一次聚焦位,后面跟一个去活记录,
/// 等于把真聚焦从它身上拿走。
fn begin_synthetic_focus(bound: &BoundSpi, pid: i32, window_id: u32) -> Result<bool, ComputerUseError> {
	if is_frontmost(pid) {
		return Ok(false);
	}
	let psn = process_serial_number(bound, pid)?;
	post_activation(bound, &psn, &activation_record(window_id, true))?;
	std::thread::sleep(std::time::Duration::from_secs_f64(DELAY_FOCUS_SETTLE));
	Ok(true)
}

/// 撤销 [`begin_synthetic_focus`],尽力而为、永不失败(REF `_end_synthetic_focus`)。
///
/// 吞错是刻意的:点击已经发生,在这里抛错会把一次成功动作替换成报错。失
/// 败的还原让目标保持合成聚焦,下一次真实点击会修正它。
fn end_synthetic_focus(bound: &BoundSpi, pid: i32, window_id: u32) {
	let Ok(psn) = process_serial_number(bound, pid) else { return };
	let Ok(()) = post_activation(bound, &psn, &activation_record(window_id, false)) else { return };
	std::thread::sleep(std::time::Duration::from_secs_f64(DELAY_FOCUS_SETTLE));
}

/// 把九个私有路由字段 + 窗口本地位置写到一个事件上(REF `_stamp`)。
fn stamp(
	bound: &BoundSpi,
	event: &ffi::CfRef,
	pid: i32,
	window_id: u32,
	local: (f64, f64),
	click_state: u32,
	phase: i64,
	click_group: u64,
) {
	let fields = [
		(FIELD_GESTURE_PHASE, phase),
		(FIELD_CLICK_STATE, i64::from(click_state)),
		// 按钮号恒 0:配方只对左键逆向,0 号就是左键 —— 这个字段在此配
		// 方里是仪式而非开关,别「推广」它。
		(FIELD_BUTTON_NUMBER, 0),
		(FIELD_SUBTYPE, EVENT_SUBTYPE_WINDOWED),
		(FIELD_TARGET_PID, i64::from(pid)),
		(FIELD_WINDOW_NUMBER, i64::from(window_id)),
		(FIELD_CLICK_GROUP_ID, click_group as i64),
		// 两个「指针之下是什么」字段都点名**目标**窗口:这正是让窗口服
		// 务器路由到后台窗口的那个谎。
		(FIELD_WINDOW_UNDER_POINTER, i64::from(window_id)),
		(FIELD_HANDLING_WINDOW_UNDER_POINTER, i64::from(window_id)),
	];
	for (field_id, value) in fields {
		// SAFETY:event 是本进程创建的合法事件;字段编号见常量注释。
		unsafe { (bound.set_int_field)(event.as_ptr(), field_id, value) };
	}
	// SAFETY:同上;标量 double 形态见 SetWindowLocationFn 的类型注释。
	unsafe { (bound.set_window_location)(event.as_ptr(), local.0, local.1) };
}

/// 构造、打戳、投递配方里的每个事件(REF `_post_recipe`)。
fn post_recipe(
	bound: &BoundSpi,
	recipe: &[SkyClickStep],
	pid: i32,
	window_id: u32,
	screen: (f64, f64),
	window: (f64, f64),
) -> Result<(), ComputerUseError> {
	// HID 源,**不是**本包其余路径的私有源:窗口服务器对这批私有字段的
	// 路由只对 HID 态源观察到有效,私有源的事件被投递但被忽略。惯常的修
	// 饰键继承危害在此不适用 —— flags 在每个事件上显式置零。
	// SAFETY:常量参数的纯 Create 调用。
	let source = unsafe { sys::CGEventSourceCreate(K_CG_EVENT_SOURCE_STATE_HID) };
	let Some(source) = (unsafe { ffi::CfRef::from_created(source as *mut c_void) }) else {
		return Err(ComputerUseError::Unsupported(REFUSAL_EVENT.to_string()));
	};
	let click_group = click_group_id();
	let (button_number, _, _, _) = ffi::mouse_button_codes(MouseButton::Left);
	for step in recipe {
		let point = if step.at_target { screen } else { PRIMER_POINT };
		let local = if step.at_target { window } else { PRIMER_POINT };
		// SAFETY:source 合法;CGPoint 按值;类型/按钮号为 u32。
		let event = unsafe {
			sys::CGEventCreateMouseEvent(
				source.as_ptr(),
				step.event_type,
				ffi::CGPoint { x: point.0, y: point.1 },
				button_number,
			)
		};
		let Some(event) = (unsafe { ffi::CfRef::from_created(event as *mut c_void) }) else {
			return Err(ComputerUseError::Unsupported(REFUSAL_EVENT.to_string()));
		};
		// SAFETY:event 合法;SLEventPostToPid 与 CGEventPostToPid 同为
		//(pid, event) 投递。
		unsafe {
			sys::CGEventSetFlags(event.as_ptr(), 0);
			stamp(bound, &event, pid, window_id, local, step.click_state, step.phase, click_group);
			// 双通道,刻意,不是重试:SkyLight 投递够得着自做命中测试的
			// 渲染器,公开的 per-pid 投递保住纯 AppKit 兼容。丢掉任何一
			// 个都让一整类应用停止响应。
			(bound.post_to_pid)(pid, event.as_ptr());
			sys::CGEventPostToPid(pid, event.as_ptr());
		}
		if step.delay_after > 0.0 {
			std::thread::sleep(std::time::Duration::from_secs_f64(step.delay_after));
		}
	}
	Ok(())
}

/// 点击一个**后台**窗口里的 *screen* 点,不抬升它、不动操作者指针。
///
/// *window* 是同一点的窗口本地(左上原点)坐标 —— 窗口服务器按窗口本地点
/// 路由,两个都要,换算(snapshot 的 bounds)由调用方(driver)做;
/// *window_size* 用于投递前的越界检查。其余契约见模块文档与 REF `sky_click`
/// 的 docstring:失败折 [`ComputerUseError`](永不原生错误、永不 panic),不
/// 动指针,不改前台 —— 但**会**短暂把目标窗口标成合成聚焦,事后还原;还
/// 原在点击序列失败时也运行。
pub fn sky_click(
	pid: i32,
	window_id: u32,
	screen: (f64, f64),
	window: (f64, f64),
	window_size: (f64, f64),
	click_count: u8,
	button: MouseButton,
) -> Result<(), ComputerUseError> {
	let Some(bound) = bound_spi() else {
		return Err(ComputerUseError::Unsupported(unavailable_refusal()));
	};
	if window_id == 0 {
		return Err(ComputerUseError::Unsupported(REFUSAL_NO_WINDOW_ID.to_string()));
	}
	for value in [screen.0, screen.1, window.0, window.1] {
		if !value.is_finite() {
			return Err(ComputerUseError::Unsupported(REFUSAL_OUTSIDE_WINDOW.to_string()));
		}
	}
	let (width, height) = window_size;
	if width <= 0.0 || height <= 0.0 || !(0.0..=width).contains(&window.0) || !(0.0..=height).contains(&window.1) {
		return Err(ComputerUseError::Unsupported(REFUSAL_OUTSIDE_WINDOW.to_string()));
	}
	let recipe = click_recipe(click_count, button)?;
	// 串行化:合成聚焦翻转是全局窗口服务器状态(见 DISPATCH_LOCK 注释)。
	let _serial = DISPATCH_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
	if !window_is_current(window_id, pid) {
		return Err(ComputerUseError::StaleIndex(REFUSAL_STALE_WINDOW.to_string()));
	}
	let focused = begin_synthetic_focus(&bound, pid, window_id)?;
	let outcome = post_recipe(&bound, &recipe, pid, window_id, screen, window);
	if focused {
		// SkyLight 投递是异步的:过早撤聚焦,自做命中测试的渲染器永远看
		// 不到最后一个 mouse-up,点击登记成「按下无释放」。还原尽力而
		// 为(见 end_synthetic_focus),失败不覆盖点击结果。
		std::thread::sleep(std::time::Duration::from_secs_f64(DELAY_BEFORE_FOCUS_RELEASE));
		end_synthetic_focus(&bound, pid, window_id);
	}
	outcome
}

// ── 纯函数:点击配方 ──

/// 配方中的一个事件。见 [`click_recipe`]。
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SkyClickStep {
	/// `CGEventType`(按按钮枚举的 down/up/moved)。
	pub event_type: u32,
	/// 事件落在目标点还是底火点 (-1,-1)。
	pub at_target: bool,
	/// click-state 字段(双击是 state=2 的一对,不是两对)。
	pub click_state: u32,
	/// 私有 gesture-phase 字段。
	pub phase: i64,
	/// 本步之后等多少秒。
	pub delay_after: f64,
}

/// sky_click 的有序事件序列。
///
/// 纯函数、独立测试:**顺序与底火对是承重部分** —— 未来某次编辑丢掉底火、
/// 或把 move-before-down 排错,产出的是对**最前**窗口而非目标的点击:一次
/// 静默投错,而非一次失败。
///
/// *button* 只为了在**不是左键**时拒绝而存在。让它做显式参数使约束可检
/// 而非隐式:没有具名按钮,配方无论调用方要什么都会用左键码构造,把一次
/// 右键请求静默变成对操作者看不见的后台窗口的左键点击。拒绝优于降级的理
/// 由见 `ERR_SKY_CLICK_BUTTON`。
pub fn click_recipe(click_count: u8, button: MouseButton) -> Result<Vec<SkyClickStep>, ComputerUseError> {
	if !(MIN_SKY_CLICK_COUNT..=MAX_SKY_CLICK_COUNT).contains(&click_count) {
		return Err(ComputerUseError::Unsupported(fill(
			REFUSAL_COUNT,
			&[("{count}", click_count.to_string().as_str())],
		)));
	}
	if button != MouseButton::Left {
		return Err(ComputerUseError::Unsupported(fill(REFUSAL_BUTTON, &[("{button}", button.as_str())])));
	}
	let (_, down_type, up_type, _) = ffi::mouse_button_codes(MouseButton::Left);
	let mut steps = vec![
		SkyClickStep {
			event_type: ffi::K_CG_EVENT_MOUSE_MOVED,
			at_target: true,
			click_state: 0,
			phase: PHASE_MOVED,
			delay_after: DELAY_AFTER_MOVE,
		},
		SkyClickStep {
			event_type: down_type,
			at_target: false,
			click_state: 1,
			phase: PHASE_PRIMER_DOWN,
			delay_after: DELAY_AFTER_PRIMER_DOWN,
		},
		SkyClickStep {
			event_type: up_type,
			at_target: false,
			click_state: 1,
			phase: PHASE_PRIMER_UP,
			delay_after: DELAY_AFTER_PRIMER_UP,
		},
	];
	for pair in 1..=click_count as u32 {
		let last = pair == click_count as u32;
		steps.push(SkyClickStep {
			event_type: down_type,
			at_target: true,
			click_state: pair,
			phase: PHASE_TARGET,
			delay_after: DELAY_AFTER_TARGET_DOWN,
		});
		steps.push(SkyClickStep {
			event_type: up_type,
			at_target: true,
			click_state: pair,
			phase: PHASE_TARGET,
			delay_after: if last { 0.0 } else { DELAY_BETWEEN_CLICK_PAIRS },
		});
	}
	Ok(steps)
}

// ── 纯测试:字节与顺序(无窗口服务器)──────────────────────────

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn activation_record_pins_every_observed_offset() {
		let record = activation_record(0xA1B2C3D4, true);
		assert_eq!(record.len(), 0xF8);
		assert_eq!(record[0x04], 0xF8, "size field carries the record's own length");
		assert_eq!(record[0x08], 0x0D, "kind = activate");
		assert_eq!(record[0x3C..0x40], 0xA1B2C3D4u32.to_le_bytes(), "window id, little-endian, 4 bytes");
		assert_eq!(record[0x8A], 0x01, "focused = yes");
		// 其余字节为零:记录里没有我们不知道的字段被随手写进去(非零的
		// 恰是 size/kind/focused 三字节 + window id 的四字节,且本 id 四字
		// 节全非零)。
		let zeros = record.iter().filter(|b| **b == 0).count();
		assert_eq!(zeros, RECORD_SIZE - 3 - 4);
		// 去活分支 + 窗口 id 只取低 32 位(u32 本身就是这个宽度)。
		let off = activation_record(7, false);
		assert_eq!(off[0x8A], 0x02);
		assert_eq!(off[0x3C..0x40], 7u32.to_le_bytes());
	}

	#[test]
	fn click_recipe_single_click_is_five_ordered_steps() {
		let steps = click_recipe(1, MouseButton::Left).unwrap();
		assert_eq!(steps.len(), 5);
		// move(目标点, state 0)→ 底火 down/up(非目标, state 1)→ 真实对
		//(目标, state 1, phase 3)。
		assert_eq!(
			steps[0],
			SkyClickStep {
				event_type: ffi::K_CG_EVENT_MOUSE_MOVED,
				at_target: true,
				click_state: 0,
				phase: 2,
				delay_after: 0.015,
			}
		);
		assert!(!steps[1].at_target && !steps[2].at_target);
		assert_eq!(
			(steps[1].event_type, steps[2].event_type),
			(ffi::K_CG_EVENT_LEFT_MOUSE_DOWN, ffi::K_CG_EVENT_LEFT_MOUSE_UP)
		);
		assert_eq!((steps[1].click_state, steps[2].click_state), (1, 1));
		assert_eq!((steps[1].phase, steps[2].phase), (1, 2));
		assert!((steps[2].delay_after - 0.100).abs() < 1e-9, "focus settles after the primer pair");
		assert_eq!(
			(steps[3].event_type, steps[4].event_type),
			(ffi::K_CG_EVENT_LEFT_MOUSE_DOWN, ffi::K_CG_EVENT_LEFT_MOUSE_UP)
		);
		assert!(steps[3].at_target && steps[4].at_target);
		assert_eq!(steps[3].phase, 3);
		// 末对之后零延时:聚焦释放的延时属于投递序列,不属于配方步。
		assert_eq!(steps[4].delay_after, 0.0);
	}

	#[test]
	fn click_recipe_double_click_is_one_pair_with_state_two() {
		let steps = click_recipe(2, MouseButton::Left).unwrap();
		assert_eq!(steps.len(), 7);
		// 双击 = state 2 的一对,不是两对 state 1:AppKit 的 clickCount 读的
		// 就是这个字段。
		let target: Vec<&SkyClickStep> = steps.iter().skip(3).collect();
		assert!(target.iter().all(|s| s.at_target && s.phase == 3));
		assert_eq!(target[0].click_state, 1);
		assert_eq!(target[2].click_state, 2);
		// 对间延时 0.080,末对 0。
		assert!((target[1].delay_after - 0.080).abs() < 1e-9);
		assert_eq!(target[3].delay_after, 0.0);
	}

	#[test]
	fn click_recipe_refuses_unguessable_shapes() {
		for bad in [0u8, 3] {
			let err = click_recipe(bad, MouseButton::Left).unwrap_err().to_string();
			assert!(err.contains(&format!("click_count 1 or 2 (got {bad})")), "{err}");
			assert!(err.contains("app_post"), "{err}");
		}
		// 非左键:拒绝而非静默换成左键码 —— 对操作者看不见的窗口发一个不
		// 同的手势,比失败糟得多。
		for bad in [MouseButton::Right, MouseButton::Middle] {
			let err = click_recipe(1, bad).unwrap_err().to_string();
			assert!(err.contains("only the left mouse button"), "{err}");
		}
	}

	#[test]
	fn capability_report_is_internally_consistent() {
		// 真实 dlopen(本机是 macOS):要么全符号在场,要么点名缺席 —— 两种
		// 都是合法状态,不变量是「可用 ⇔ reason 为空」与「缺符号被引述」。
		let cap = available();
		assert_eq!(cap.is_available(), cap.reason().is_empty());
		if !cap.is_available() && cap.load_error.is_empty() {
			assert!(!cap.missing_symbols.is_empty());
			assert!(cap.reason().starts_with("missing private symbols:"));
		}
		// 单例:两次取到同一能力报告。
		assert_eq!(available().reason(), cap.reason());
	}

	#[test]
	fn click_group_ids_stay_in_the_observed_range_and_differ() {
		let first = click_group_id();
		let second = click_group_id();
		assert!(first < CLICK_GROUP_MODULUS, "{first}");
		assert!(second < CLICK_GROUP_MODULUS, "{second}");
		// 同一进程两次调用:纳秒分量必然推进(单调钟),相同值只意味着
		// group 字段不再每次点击唯一 —— 字段 58 的语义未知,唯一性是我们
		// 对它唯一敢做的假设。
		assert_ne!(first, second);
	}

	#[test]
	fn sky_click_refuses_before_touching_the_window_server() {
		// 三个前置拒绝都在任何窗口服务器往返**之前**:window_id=0、非有
		// 限坐标、窗口本地点越界。SPI 完整的机器上各自命中自己的文案;SPI
		// 缺席的精简系统上第一个调用就折 UNAVAILABLE —— 两种都是合法状
		// 态,断言只钉「拒绝 + 点名 sky_click + 点名 app_post」。
		let refusal = |window_id: u32, screen: (f64, f64), window: (f64, f64), size: (f64, f64)| {
			sky_click(1, window_id, screen, window, size, 1, MouseButton::Left).unwrap_err().to_string()
		};
		let zero = refusal(0, (10.0, 10.0), (5.0, 5.0), (100.0, 100.0));
		assert!(zero.contains("sky_click"), "{zero}");
		assert!(zero.contains("app_post"), "{zero}");
		if !available().is_available() {
			return;
		}
		assert!(zero.contains("needs a resolved window id"), "{zero}");
		let nan = refusal(7, (f64::NAN, 0.0), (0.0, 0.0), (100.0, 100.0));
		assert!(nan.contains("outside the target window's bounds"), "{nan}");
		let outside = refusal(7, (0.0, 0.0), (150.0, 0.0), (100.0, 100.0));
		assert!(outside.contains("outside the target window's bounds"), "{outside}");
		let degenerate = refusal(7, (0.0, 0.0), (0.0, 0.0), (0.0, 100.0));
		assert!(degenerate.contains("outside the target window's bounds"), "{degenerate}");
	}

	#[test]
	fn sky_click_refuses_a_window_the_server_does_not_know() {
		// window id 0xDFFD 越过全部前置检查后撞上 stale 复查:任何环境下
		// 这个 id 都不在屏(无头 CI 的窗口列表为空、桌面会话里也无此窗
		// 口),而 stale 分支按 StaleIndex 折 —— 语义正是「重新 get_state」。
		if !available().is_available() {
			return;
		}
		let err = sky_click(1, 0xDFFD, (10.0, 10.0), (5.0, 5.0), (100.0, 100.0), 1, MouseButton::Left)
			.unwrap_err()
			.to_string();
		assert!(err.contains("no longer on screen"), "{err}");
		assert!(err.contains("computer_get_state"), "{err}");
	}

	/// 冒烟:在真实 macOS 上 SPI 应当完整(缺了它 sky_click 全线降级,值得
	/// 在操作者的机器上显式看见)。
	#[test]
	#[ignore = "asserts this macOS still ships the private SkyLight symbols"]
	fn skylight_spi_available_smoke() {
		let cap = available();
		assert!(cap.is_available(), "sky_click degraded: {}", cap.reason());
	}
}
