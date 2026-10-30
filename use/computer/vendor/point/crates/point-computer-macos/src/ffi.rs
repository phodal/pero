//! 唯一触碰 macOS 原生符号的模块(REF `macos_ffi.py` 的移植)。本包其它
//! 一切代码经由这里的类型化助手到达系统;FFI 危害在此一处审计,而非散落
//! 在五个文件里。
//!
//! REF 的七条危害,以及各自在 Rust 里的归宿:
//!
//! 1. **缺 argtypes 截断指针 → SIGSEGV** —— 结构性消灭:extern 块的签名
//!    **就是** argtypes,类型系统在每个调用点强制;不存在「忘记声明」的
//!    绑定 pass。
//! 2. **`CFArrayGetValueAtIndex` 越界 → 不可捕获的 ObjC NSRangeException
//!    (进程 abort)** —— 保留缓解:一切数组读取走 [`cf_array_items`],先读
//!    count、永不越界;本模块不导出裸的按索引读取。
//! 3. **`CGEventCreateScrollWheelEvent` 变参尾在 arm64 上被错误编组** ——
//!    保留缓解:只声明固定四参原型(`wheelCount=1`),第二轴经
//!    `CGEventSetIntegerValueField` 设置(见 `sys` 块内注释)。
//! 4. **`kCFTypeDictionaryKeyCallBacks` 是结构体不是指针** —— 保留缓解:
//!    extern static 声明为不透明类型,取其地址(`addr_of!`)而非「读第一
//!    个字」。
//! 5. **合成键事件继承用户实时修饰键状态** —— 保留缓解:事件一律出自
//!    **私有** event source(`kCGEventSourceStatePrivate = -1`,见常量注释
//!    为何绝不可传 1),且每个事件显式 `CGEventSetFlags`。
//! 6. **CFString 泄漏是真实 RSS bug** —— 结构性消灭:[`CfRef`] 的
//!    `Drop→CFRelease` 让 Create Rule 的释放义务由类型携带;树走查的数千
//!    次属性读每次都走它。
//! 7. **`CGEventCreateMouseEvent` 按值收 `CGPoint`;鼠标事件类型按按钮枚
//!    举** —— 结构性消灭:`#[repr(C)]` 结构体按值出现在签名里(编译器编
//!    组,无手写裸 double 的余地);按按钮的三元组查表在常量区。
//!
//! 与 REF 的对应差异:REF 在运行时 `find_library` + 绑定 pass 并缓存框架
//! 句柄;Rust 的链接是编译期的,`sys` 模块的 extern 块即「一次绑定」——
//! 缺符号在链接期而非首次调用时失败。唯一运行时解析的符号是私有
//! `_AXUIElementGetWindow`(REF 的 `_OPTIONAL_FN_SPECS` 语义:缺席时降级
//! 而非失败),经 libSystem `dlsym` 查找,见 [`ax_window_id`]。
//!
//! **`CGEventPost`(全局 HID tap)与 `CGWarpMouseCursorPosition` 虽被绑
//! 定,但只能从 M6 driver 的 global 点击路径到达**(REF 用测试钉死调用点
//! 数为一;本移植以 driver 单文件内的唯一函数承载同一约束)。

use std::ffi::c_void;
use std::os::raw::{c_char, c_int, c_long};
use std::ptr::NonNull;
use std::sync::OnceLock;

use point_computer_core::types::{AX_PARENT, AX_POSITION, AX_SIZE, MouseButton};

/// C `int32_t`/`int64_t`:std 未导出这两个拼写;i32/i64 在全部 Rust 支持的
/// 目标上与之同宽同符号,别名只为让 extern 签名陈述 C 侧类型。
#[allow(non_camel_case_types)]
pub type c_int32_t = i32;
/// 见 [`c_int32_t`]。
#[allow(non_camel_case_types)]
pub type c_int64_t = i64;

// ── extern 块:签名即 argtypes(REF 的 `_FN_SPECS` 逐条转写) ──

pub(crate) mod sys {
	// 符号表是 REF `_FN_SPECS` 的**整体**转写;M5(观测)/M6(动作)落地
	// 前部分符号无人调用。不按符号逐个豁免/出入库 —— 那会让本表与 REF 逐
	// 条漂移,而这张表的价值恰在与 REF 一一对应可核对。
	#![allow(dead_code)]

	use std::ffi::c_void;
	use std::os::raw::{c_char, c_int, c_long, c_uchar};

	use super::{CGPoint, CGRect, c_int32_t, c_int64_t};

	#[link(name = "CoreFoundation", kind = "framework")]
	unsafe extern "C" {
		pub fn CFRelease(cf: *const c_void);
		pub fn CFRetain(cf: *const c_void) -> *const c_void;
		pub fn CFGetTypeID(cf: *const c_void) -> usize;
		// 身份而非指针相等:两个**不同**的 AXUIElement 引用可命名同一 UI 元素
		//(AXFocusedUIElement 与走 AXChildren 到达的同一节点是两次分配)。
		pub fn CFEqual(a: *const c_void, b: *const c_void) -> bool;

		pub fn CFStringCreateWithCString(alloc: *const c_void, c_str: *const c_char, encoding: u32) -> *const c_void;
		// CFIndex 是有符号 long(此处 64 位)。32 位 restype 会截断大 AXValue
		// 的长度、undersize 缓冲。
		pub fn CFStringGetLength(cf: *const c_void) -> c_long;
		pub fn CFStringGetCString(cf: *const c_void, buffer: *mut c_char, buffer_size: c_long, encoding: u32) -> bool;
		pub fn CFStringGetTypeID() -> usize;

		pub fn CFArrayGetTypeID() -> usize;
		pub fn CFArrayGetCount(array: *const c_void) -> c_long;
		pub fn CFArrayGetValueAtIndex(array: *const c_void, idx: c_long) -> *const c_void;

		pub fn CFDictionaryGetTypeID() -> usize;
		pub fn CFDictionaryGetValue(dict: *const c_void, key: *const c_void) -> *const c_void;
		pub fn CFDictionaryCreateMutable(
			alloc: *const c_void,
			capacity: c_long,
			key_callbacks: *const c_void,
			value_callbacks: *const c_void,
		) -> *const c_void;
		pub fn CFDictionarySetValue(dict: *const c_void, key: *const c_void, value: *const c_void);

		pub fn CFNumberGetTypeID() -> usize;
		pub fn CFNumberCreate(alloc: *const c_void, the_type: c_int, value_ptr: *const c_void) -> *const c_void;
		pub fn CFNumberGetValue(number: *const c_void, the_type: c_int, value_ptr: *mut c_void) -> bool;
		pub fn CFBooleanGetTypeID() -> usize;
		pub fn CFBooleanGetValue(boolean: *const c_void) -> bool;

		pub fn CFDataCreate(alloc: *const c_void, bytes: *const c_uchar, length: c_long) -> *const c_void;
		pub fn CFDataCreateMutable(alloc: *const c_void, capacity: c_long) -> *const c_void;
		pub fn CFDataGetLength(data: *const c_void) -> c_long;
		pub fn CFDataGetBytePtr(data: *const c_void) -> *const c_uchar;

		// Info.plist 的解析器:输入是我们自己已读好、已定容的 CFData
		//(apps.rs 的硬化读),输出 plist 对象。options=0 即不可变解析;
		// format/error 是可空 out-param。
		pub fn CFPropertyListCreateWithData(
			alloc: *const c_void,
			data: *const c_void,
			options: u64,
			format: *mut u64,
			error: *mut *const c_void,
		) -> *const c_void;

		// ── 外部静态量 ──
		// 不透明声明 + addr_of!(取地址):kCFBooleanTrue 是「指向共享单例的
		// 指针」(读 .value 正确);两个 callbacks 是**结构体**(必须给地
		// 址,给「第一个字」= 传 NULL = CF 既不 retain 也不 release 字典内
		// 容 —— REF 危害 4)。
		pub static kCFBooleanTrue: *const c_void;
		pub static kCFTypeDictionaryKeyCallBacks: CallbacksOpaque;
		pub static kCFTypeDictionaryValueCallBacks: CallbacksOpaque;
	}

	/// 回调结构体的不透明占位:只取地址,绝不声称布局。
	#[repr(C)]
	pub struct CallbacksOpaque {
		_priv: [u8; 0],
	}

	#[link(name = "ApplicationServices", kind = "framework")]
	unsafe extern "C" {
		pub fn AXIsProcessTrusted() -> bool;
		pub fn AXUIElementGetTypeID() -> usize;
		pub fn AXUIElementCreateApplication(pid: c_int32_t) -> *const c_void;
		pub fn AXUIElementCopyAttributeValue(
			element: *const c_void,
			attribute: *const c_void,
			value: *mut *const c_void,
		) -> c_int32_t;
		pub fn AXUIElementSetAttributeValue(
			element: *const c_void,
			attribute: *const c_void,
			value: *const c_void,
		) -> c_int32_t;
		// 命中测试的 x/y 是 **float**:double 走错寄存器类,命中永不生效
		//(与 SetMessagingTimeout 同一教训)。
		pub fn AXUIElementCopyElementAtPosition(
			element: *const c_void,
			x: f32,
			y: f32,
			found: *mut *const c_void,
		) -> c_int32_t;
		pub fn AXUIElementCopyParameterizedAttributeValue(
			element: *const c_void,
			attribute: *const c_void,
			parameter: *const c_void,
			value: *mut *const c_void,
		) -> c_int32_t;
		pub fn AXUIElementCreateSystemWide() -> *const c_void;
		pub fn AXUIElementGetPid(element: *const c_void, pid: *mut c_int32_t) -> c_int32_t;
		pub fn AXUIElementCopyActionNames(element: *const c_void, names: *mut *const c_void) -> c_int32_t;
		pub fn AXUIElementPerformAction(element: *const c_void, action: *const c_void) -> c_int32_t;
		pub fn AXValueGetTypeID() -> usize;
		pub fn AXValueGetType(value: *const c_void) -> c_int32_t;
		pub fn AXValueGetValue(value: *const c_void, the_type: c_int32_t, buffer: *mut c_void) -> bool;
		pub fn AXValueCreate(the_type: c_int32_t, value: *const c_void) -> *const c_void;
		// settability 是区分只读文本框与可编辑文本框的唯一可靠信号(禁用
		// 输入的 AXTextField 仍报 AXEnabled=true 且带可读 value)。
		pub fn AXUIElementIsAttributeSettable(
			element: *const c_void,
			attribute: *const c_void,
			settable: *mut bool,
		) -> c_int32_t;
		// 收 C float 而非 double:double 走错寄存器类,超时永不生效。
		pub fn AXUIElementSetMessagingTimeout(element: *const c_void, seconds: f32) -> c_int32_t;
	}

	#[link(name = "CoreGraphics", kind = "framework")]
	unsafe extern "C" {
		pub fn CGWindowListCopyWindowInfo(option: u32, relative_to: u32) -> *const c_void;
		pub fn CGWindowListCreateImage(
			screen_rect: CGRect,
			list_option: u32,
			window_id: u32,
			image_option: u32,
		) -> *const c_void;
		pub fn CGImageGetWidth(image: *const c_void) -> usize;
		pub fn CGImageGetHeight(image: *const c_void) -> usize;
		pub fn CGImageRelease(image: *const c_void);
		// 只做 preflight。CGRequestScreenCaptureAccess 会从调用进程弹系统对
		// 话框 —— 后台 sidecar 里的提示操作者无从归因;永不调用(未绑定)。
		pub fn CGPreflightScreenCaptureAccess() -> bool;

		pub fn CGEventSourceCreate(state_id: c_int32_t) -> *const c_void;
		pub fn CGEventCreateKeyboardEvent(source: *const c_void, key_code: u16, key_down: bool) -> *const c_void;
		pub fn CGEventKeyboardSetUnicodeString(event: *const c_void, length: c_long, chars: *const u16);
		// **只声明固定四参原型**(wheelCount 恒 1):变参尾在 arm64 上被错
		// 误编组(REF 实测 axis2=30416 的垃圾值)。Darwin arm64 的变参函数
		// 其命名前缀走与普通调用一致的寄存器约定,故按 4 参调用变参符号的
		// 前四个参数是 ABI 相容的;第二轴经 CGEventSetIntegerValueField 补
		//(REF 对每个输入核验过)。
		pub fn CGEventCreateScrollWheelEvent(
			source: *const c_void,
			units: u32,
			wheel_count: u32,
			wheel1: c_int32_t,
		) -> *const c_void;
		pub fn CGEventSetIntegerValueField(event: *const c_void, field: u32, value: c_int64_t);
		pub fn CGEventSetFlags(event: *const c_void, flags: u64);
		pub fn CGEventPostToPid(pid: c_int32_t, event: *const c_void);
		// CGPoint 按值:两个裸 double 会在 AArch64 约定下编组错整个调用
		//(button 落错寄存器 → 任意按钮任意点)。签名里是 #[repr(C)] 结构
		// 体,编译器编组,无手写余地。
		pub fn CGEventCreateMouseEvent(
			source: *const c_void,
			mouse_type: u32,
			mouse_position: CGPoint,
			mouse_button: u32,
		) -> *const c_void;
		// 全局 HID tap:仅 global 点击路径(M6 driver 的唯一函数);auto 在
		// chokepoint 上游解析、永不解析到 global。
		pub fn CGEventPost(tap: u32, event: *const c_void);
		// 弯折操作者**物理**光标;同一唯一调用点。
		pub fn CGWarpMouseCursorPosition(point: CGPoint) -> c_int;
	}

	#[link(name = "ImageIO", kind = "framework")]
	unsafe extern "C" {
		pub fn CGImageDestinationCreateWithData(
			data: *const c_void,
			uti: *const c_void,
			count: usize,
			options: *const c_void,
		) -> *const c_void;
		pub fn CGImageDestinationAddImage(dest: *const c_void, image: *const c_void, properties: *const c_void);
		pub fn CGImageDestinationFinalize(dest: *const c_void) -> bool;

		// 两个选项键是 ImageIO 导出的 CFStringRef **静态量**(共享单例,
		// 读 .value 即指针本身),不是要自己构造的字符串。
		pub static kCGImageDestinationImageMaxPixelSize: *const c_void;
		pub static kCGImageDestinationLossyCompressionQuality: *const c_void;
	}

	// link 名是 `proc`(-lproc → libproc.tbd);写 `libproc` 会展开成
	// -llibproc → liblibproc,不存在。
	#[link(name = "proc")]
	unsafe extern "C" {
		// PROC_PIDPATHINFO_MAXSIZE = 4 * MAXPATHLEN。
		pub fn proc_pidpath(pid: c_int, buffer: *mut c_char, buffer_size: u32) -> c_int;
		// flavor=PROC_PIDTBSDINFO(3) 填 struct proc_bsdinfo;无需 entitlement。
		pub fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, buffersize: c_int) -> c_int;
	}

	// ── libSystem:动态符号解析(供 skylight 的 dlopen 与 REF 的
	//    _OPTIONAL_FN_SPECS 语义)────────────────────────────────
	// libSystem 是 macOS 的默认链接库,无需 link 属性。
	unsafe extern "C" {
		pub fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
		pub fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
		// POSIX:launch 的可写性探针(geteuid 的 restype 是 uid_t = u32)。
		pub fn geteuid() -> u32;
		pub fn access(path: *const c_char, mode: c_int) -> c_int;
	}

	/// POSIX `W_OK`(access 的写模式)。
	pub const W_OK: c_int = 2;
	/// darwin:`RTLD_LAZY | RTLD_LOCAL` —— 只解析、不做全局符号注入。
	pub const RTLD_LAZY_LOCAL: c_int = 0x1 | 0x4;
	/// darwin:`RTLD_DEFAULT`(以「任一已加载镜像」为句柄查符号)。
	pub const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;
}

// ── repr(C) 几何结构体 ──

/// CoreGraphics `CGPoint`。结构体,永不写成两个裸 double。
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CGPoint {
	pub x: f64,
	pub y: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CGSize {
	pub width: f64,
	pub height: f64,
}

/// 传四个裸 double 会在 arm64 与 x86_64 上都编组错(嵌套结构体参数的寄存
/// 器/栈布局 ≠ 扁平成员的布局)。
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CGRect {
	pub origin: CGPoint,
	pub size: CGSize,
}

/// CoreFoundation `CFRange`(`AXSelectedTextRange` 等文本属性的载荷类型)。
/// `location`/`length` 是 `CFIndex`(isize),不是 f64。
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct CFRange {
	pub location: isize,
	pub length: isize,
}

// ── ABI 常量(数字住在调用旁边 —— REF 同) ──

/// `kCFStringEncodingUTF8`。
pub const K_CF_STRING_ENCODING_UTF8: u32 = 0x0800_0100;
/// `kCFNumberSInt32Type`(选 sized 变体:名字陈述我们实际传的 C 缓冲类型)。
pub const K_CF_NUMBER_SINT32: c_int = 3;
/// `kCFNumberDoubleType`。
pub const K_CF_NUMBER_DOUBLE: c_int = 13;

/// `AXValueType` 判别式。AXValue 只肯解箱进**它实际持有**的类型缓冲:
/// 把 CGPoint(AXPosition)读进 CGSize 缓冲是静默的字段转置(y 读成
/// width)—— 坐标是点击要瞄准的东西,最坏的失败形态。
pub const K_AX_VALUE_CG_POINT: c_int32_t = 1;
pub const K_AX_VALUE_CG_SIZE: c_int32_t = 2;
pub const K_AX_VALUE_CG_RECT: c_int32_t = 3;
/// `kAXValueCFRangeType` —— `AXSelectedTextRange` 的箱类型。
pub const K_AX_VALUE_CF_RANGE: c_int32_t = 4;

// ── AX 错误码 ──
pub const AX_ERR_SUCCESS: c_int32_t = 0;
/// `kAXErrorCannotComplete`。Electron/Chromium 在 AXManualAccessibility 设置
/// 前对**每个**属性读都答这个 —— 重试信号,非致命。
pub const AX_ERR_CANNOT_COMPLETE: c_int32_t = -25204;
/// `kAXErrorActionUnsupported`:元素**宣告过**该动作却拒绝执行(真实的
/// AXScrollArea 列出 AXScrollDownByPage 然后拒绝它)。宣告列表是提示,
/// 永远不是契约。
pub const AX_ERR_ACTION_UNSUPPORTED: c_int32_t = -25206;
/// `kAXErrorAttributeUnsupported`:极常见且完全无害 —— window 元素对
/// AXValue/AXEnabled 答它;本 macOS 上每个 application 元素对
/// AXBundleIdentifier 也答它。
pub const AX_ERR_ATTRIBUTE_UNSUPPORTED: c_int32_t = -25205;
pub const AX_ERR_NO_VALUE: c_int32_t = -25212;

/// Electron/Chromium 的无障碍自选加入开关。
pub const AX_MANUAL_ACCESSIBILITY: &str = "AXManualAccessibility";
pub const ELECTRON_OPT_IN_WAIT_SECS: f64 = 2.0;
pub const ELECTRON_OPT_IN_POLL_SECS: f64 = 0.25;
/// 创建 application 元素后**立即**设置:无障碍往返的挂起上限。没有它,一
/// 个无响应的目标应用会无限期停住调用线程。
pub const AX_MESSAGING_TIMEOUT_SECS: f32 = 2.0;

// ── CoreGraphics 窗口列表 ABI ──
pub const K_CG_WINDOW_LIST_ON_SCREEN_ONLY: u32 = 1;
pub const K_CG_WINDOW_LIST_EXCLUDE_DESKTOP: u32 = 16;
/// `kCGWindowListOptionIncludingWindow`:与 window id 配对时把列表收窄为
/// 「恰好这一个窗口」—— 配合全零 CGRect(「窗口自身 bounds」)就是
/// per-window 截图的全部秘密;没有它 CGWindowListCreateImage 会截整屏。
pub const K_CG_WINDOW_LIST_INCLUDING_WINDOW: u32 = 8;
pub const K_CG_WINDOW_IMAGE_BOUNDS_IGNORE_FRAMING: u32 = 1;
pub const K_CG_NULL_WINDOW_ID: u32 = 0;
pub const CG_WINDOW_NUMBER: &str = "kCGWindowNumber";
pub const CG_WINDOW_OWNER_PID: &str = "kCGWindowOwnerPID";
pub const CG_WINDOW_OWNER_NAME: &str = "kCGWindowOwnerName";
pub const CG_WINDOW_NAME: &str = "kCGWindowName";
pub const CG_WINDOW_LAYER: &str = "kCGWindowLayer";
/// 窗口矩形(左上坐标系,CFDictionary of {X, Y, Width, Height})。
pub const CG_WINDOW_BOUNDS: &str = "kCGWindowBounds";
pub const CG_BOUNDS_X: &str = "X";
pub const CG_BOUNDS_Y: &str = "Y";
pub const CG_BOUNDS_W: &str = "Width";
pub const CG_BOUNDS_H: &str = "Height";
/// 只有 layer 0 是真应用窗口;菜单栏、Dock、tooltip、阴影在别的层。
pub const CG_WINDOW_LAYER_NORMAL: i64 = 0;

// ── CoreGraphics 事件 ABI ──
/// `kCGEventSourceStatePrivate`。**绝不传 NULL 或 1**:HID 源的事件继承
/// 用户实时修饰键状态(实测 "a","b","c" 变 ' I Abc');枚举是
/// `{Private=-1, CombinedSessionState=0, HIDSystemState=1}` —— 曾把 1 当
/// 私有源传,实际选中了共享 HID 表,只靠每条路径都 `CGEventSetFlags(0)`
/// 才掩盖。有符号:i32 枚举。
pub const K_CG_EVENT_SOURCE_STATE_PRIVATE: c_int32_t = -1;
/// `kCGScrollEventUnitLine`。枚举只有 Pixel(0)/Line(1) 两员 —— 没有页
/// 单位,「一页」以行数进 delta,不由单位转换。
pub const K_CG_SCROLL_EVENT_UNIT_LINE: u32 = 1;
/// 一个「页」折算的行数(AX 页动作被拒时的 wheel 近似;REF 同值)。
pub const CG_SCROLL_LINES_PER_PAGE: i32 = 10;
/// `kCGScrollWheelEventDeltaAxis1`(竖)/ Axis2(横);变参构造器之外的
/// 第二轴设置通道。
pub const K_CG_SCROLL_DELTA_AXIS_1: u32 = 11;
pub const K_CG_SCROLL_DELTA_AXIS_2: u32 = 12;

/// `CGEventType` 成员。没有通用「mouse down」—— 类型**按按钮**枚举;把
/// 右键按 `kCGEventLeftMouseDown` + button=1 投递会被当作左键(AppKit 按
/// 类型而非 button 号数判定)。
pub const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
pub const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
pub const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
pub const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
pub const K_CG_EVENT_MOUSE_MOVED: u32 = 5;
pub const K_CG_EVENT_LEFT_MOUSE_DRAGGED: u32 = 6;
pub const K_CG_EVENT_RIGHT_MOUSE_DRAGGED: u32 = 7;
pub const K_CG_EVENT_OTHER_MOUSE_DOWN: u32 = 25;
pub const K_CG_EVENT_OTHER_MOUSE_UP: u32 = 26;
pub const K_CG_EVENT_OTHER_MOUSE_DRAGGED: u32 = 27;

/// `CGMouseButton` 成员。
pub const K_CG_MOUSE_BUTTON_LEFT: u32 = 0;
pub const K_CG_MOUSE_BUTTON_RIGHT: u32 = 1;
pub const K_CG_MOUSE_BUTTON_CENTER: u32 = 2;

/// `kCGMouseEventClickState`。双击**不是**两对 down/up —— 是 click state
/// 为 2 的一对;AppKit 的 `NSEvent.clickCount` 读的就是这个字段。
pub const K_CG_MOUSE_EVENT_CLICK_STATE: u32 = 1;

/// `kCGHIDEventTap`:`CGEventPost` 的投递目标,仅 global 路径。
pub const K_CG_HID_EVENT_TAP: u32 = 0;

/// `(button_number, down_type, up_type, dragged_type)`(REF `MOUSE_EVENT_TYPES`)。
///
/// 事件类型按按钮枚举:AppKit 按**类型**而非 button 号数判定手势,把右键
/// 按 LeftDown+button=1 投递会被当作左键。中间键走 OtherMouse 族,正是这
/// 张表存在的理由。
pub fn mouse_button_codes(button: MouseButton) -> (u32, u32, u32, u32) {
	match button {
		MouseButton::Left => (
			K_CG_MOUSE_BUTTON_LEFT,
			K_CG_EVENT_LEFT_MOUSE_DOWN,
			K_CG_EVENT_LEFT_MOUSE_UP,
			K_CG_EVENT_LEFT_MOUSE_DRAGGED,
		),
		MouseButton::Right => (
			K_CG_MOUSE_BUTTON_RIGHT,
			K_CG_EVENT_RIGHT_MOUSE_DOWN,
			K_CG_EVENT_RIGHT_MOUSE_UP,
			K_CG_EVENT_RIGHT_MOUSE_DRAGGED,
		),
		MouseButton::Middle => (
			K_CG_MOUSE_BUTTON_CENTER,
			K_CG_EVENT_OTHER_MOUSE_DOWN,
			K_CG_EVENT_OTHER_MOUSE_UP,
			K_CG_EVENT_OTHER_MOUSE_DRAGGED,
		),
	}
}

// ── ImageIO ──
pub const UTI_JPEG: &str = "public.jpeg";

/// `proc_pidpath` 缓冲上限(PROC_PIDPATHINFO_MAXSIZE)。
pub const PROC_PIDPATH_MAX: u32 = 4096;

/// 清洗后动作名的界。真实标识符很短(AXPress/AXShowMenu);上限只咬住下
/// 面这类应用自生成的描述。
pub const MAX_ACTION_NAME_LEN: usize = 48;

/// 动作名清洗(REF `_sanitize_action`):
///
/// **一条真实数据发现,且是真实注入向量。** 动作名不保证是 `AX*` 标识符
/// —— macOS Notes 在表格行上宣告过 `'Name:remove pin\nTarget:0x0\nSelector:
/// (null)'`,即带**内嵌换行**的应用自生成描述。渲染树的缩进就是它的结构,
/// 而渲染器把动作名拼进元素行 —— 内嵌换行让应用内容伪造额外的树行(连
/// 同模型随后会去寻址的索引)。在这里、产生数据的边界上折叠,下游渲染器
/// 无须记得。
pub fn sanitize_action(name: &str) -> String {
	let flat = name.split_whitespace().collect::<Vec<&str>>().join(" ");
	flat.chars().take(MAX_ACTION_NAME_LEN).collect()
}

// ── CfRef:Create Rule 的 RAII ──

/// 一个按 Create Rule 持有的 CF 引用:`Drop` 调 `CFRelease`。
///
/// REF 危害 6 的结构性消灭:树走查一次做数千次 Copy 调用,测得未释放时
/// 每次走查 ~400KB 永久增长;context manager 的释放义务在这里由类型的析构
/// 携带,调用方「忘记」在类型上不可表达。
pub struct CfRef(NonNull<c_void>);

impl CfRef {
	/// 接管一个 Create-Rule(+1)返回的指针。
	///
	/// # Safety
	/// *ptr 必须来自一条 CF Create/Copy 调用且调用方让渡所有权;非空。
	pub unsafe fn from_created(ptr: *mut c_void) -> Option<Self> {
		NonNull::new(ptr).map(CfRef)
	}

	pub fn as_ptr(&self) -> *mut c_void {
		self.0.as_ptr()
	}

	/// `CFRetain` 并返回新的所有权句柄:引用需要活过其当前 owner(数组析
	/// 构时元素随死 —— 不 retain 的持有是 use-after-free)。
	pub fn retain(&self) -> CfRef {
		let retained = unsafe { sys::CFRetain(self.0.as_ptr()) };
		// SAFETY:CFRetain 按定义返回同一非空对象。
		unsafe { Self::from_created(retained as *mut c_void) }.expect("CFRetain returned NULL")
	}
}

impl Drop for CfRef {
	fn drop(&mut self) {
		// SAFETY:本类型只在 from_created/retain 的 +1 上构造,正好一次
		// CFRelease。
		unsafe { sys::CFRelease(self.0.as_ptr()) };
	}
}

// SAFETY:CF 对象跨线程使用是安全的(CF 是线程保持 thread-safe 的);本
// crate 不依赖线程亲和的 CF 子系统(无 runloop/observer)。
unsafe impl Send for CfRef {}
unsafe impl Sync for CfRef {}

/// 缓存的 `CFTypeID`(每次属性读都要比对;树走查做数千次)。
pub struct TypeIds {
	pub string: usize,
	pub array: usize,
	pub dictionary: usize,
	pub number: usize,
	pub boolean: usize,
	pub ax_element: usize,
	/// AXValue:AXPosition/AXSize 装箱。与 ax_element 分开 —— 把 AXValue
	/// 递给期待元素的调用(或反向)是 segfault 而非类型错误。
	pub ax_value: usize,
}

static TYPE_IDS: OnceLock<TypeIds> = OnceLock::new();

/// 首次调用触发解析并缓存(REF 的 `_frameworks()` 一次绑定 pass 在 Rust
/// 里由链接期承担,这里只剩 type id 的运行时读取)。
pub fn type_ids() -> &'static TypeIds {
	TYPE_IDS.get_or_init(|| TypeIds {
		string: unsafe { sys::CFStringGetTypeID() },
		array: unsafe { sys::CFArrayGetTypeID() },
		dictionary: unsafe { sys::CFDictionaryGetTypeID() },
		number: unsafe { sys::CFNumberGetTypeID() },
		boolean: unsafe { sys::CFBooleanGetTypeID() },
		ax_element: unsafe { sys::AXUIElementGetTypeID() },
		ax_value: unsafe { sys::AXValueGetTypeID() },
	})
}

// ── CoreFoundation 助手 ──

/// 为 *text* 创建 CFString(失败 → `None`,调用方按「属性不可用」处理)。
///
/// `CString` 构造失败(内嵌 NUL)只发生在属性名携带 NUL 的敌意输入上,
/// `None` 让调用方按「属性不可用」走 —— 一个名字里带 NUL 的属性本来就不
/// 是我们能寻址的属性。
pub fn cf_string(text: &str) -> Option<CfRef> {
	let c_text = std::ffi::CString::new(text).ok()?;
	// SAFETY:空指针 alloc 合法(默认分配器);c_text NUL 结尾且在调用期间
	// 存活;K_CF_STRING_ENCODING_UTF8 是编码常量。
	let ptr = unsafe { sys::CFStringCreateWithCString(std::ptr::null(), c_text.as_ptr(), K_CF_STRING_ENCODING_UTF8) };
	// SAFETY:Create-Rule +1,缺失 → None。
	unsafe { CfRef::from_created(ptr as *mut c_void) }
}

/// 解码 CFString 为 `String`;非字符串/空 → `""`。
///
/// **类型检查是崩溃防线,不是讲究。** 对非 CFString 调 `CFStringGetLength`
/// 抛 ObjC NSInvalidArgumentException(实测 exit 134,`libc++abi:
/// terminating`)—— 不可捕获的进程 abort。AX 数组的内容是任意的应用受控
/// 数据,忘检的调用方是一台远程崩溃原语;集中在此,未来的读者无法重引入。
pub(crate) fn cf_string_value(ptr: *const c_void) -> String {
	if ptr.is_null() || !cf_is(ptr, type_ids().string) {
		return String::new();
	}
	// SAFETY:ptr 已验为非空 CFString;后续调用按其长度定缓冲。
	unsafe {
		let length = sys::CFStringGetLength(ptr);
		if length <= 0 {
			return String::new();
		}
		// 长度单位是 UTF-16 code unit,一个 unit 至多展开 4 字节 UTF-8
		//(代理对算两个 unit,故这是安全上界)。undersize 会让
		// CFStringGetCString 失败、静默丢值。
		let size = length as usize * 4 + 1;
		let mut buffer = vec![0u8; size];
		if !sys::CFStringGetCString(ptr, buffer.as_mut_ptr() as *mut c_char, size as c_long, K_CF_STRING_ENCODING_UTF8)
		{
			return String::new();
		}
		let end = buffer.iter().position(|b| *b == 0).unwrap_or(size);
		String::from_utf8_lossy(&buffer[..end]).into_owned()
	}
}

/// *ptr* 非空且 `CFTypeID` 等于 *type_id*。每次使用 AX 返回值之前调用:
/// AX 属性多态(AXValue 可以是字符串、数字、结构箱或元素),把 CFNumber
/// 递给 CFStringGetCString 是 segfault 而非 TypeError。
pub(crate) fn cf_is(ptr: *const c_void, type_id: usize) -> bool {
	!ptr.is_null() && unsafe { sys::CFGetTypeID(ptr) } == type_id
}

/// CFArray 的元素为裸借用指针(**属数组所有**,数组释放后失效)。
/// count 先读、永不越界(危害 2 的缓解);*limit* 帽住物化数量。
pub(crate) fn cf_array_items(array: *const c_void, limit: usize) -> Vec<*const c_void> {
	if !cf_is(array, type_ids().array) {
		return Vec::new();
	}
	// SAFETY:array 已验为 CFArray;索引严格 < count。
	let count = unsafe { sys::CFArrayGetCount(array) };
	if count <= 0 {
		return Vec::new();
	}
	let count = count.min(if limit > 0 { limit as c_long } else { count } as c_long);
	(0..count).map(|i| unsafe { sys::CFArrayGetValueAtIndex(array, i) }).collect()
}

/// CFNumber → i32;非数字 → `None`。
pub(crate) fn cf_number_int(ptr: *const c_void) -> Option<i32> {
	if !cf_is(ptr, type_ids().number) {
		return None;
	}
	let mut out: i32 = 0;
	// SAFETY:ptr 已验为 CFNumber;out 是匹配 K_CF_NUMBER_SINT32 的缓冲。
	if !unsafe { sys::CFNumberGetValue(ptr, K_CF_NUMBER_SINT32, &mut out as *mut i32 as *mut c_void) } {
		return None;
	}
	Some(out)
}

/// CFNumber → f64。与 [`cf_number_int`] 分开:窗口列表的 kCGWindowBounds
/// 分量是 CGFloat —— SInt32 路径会截断分数原点(Retina 窗口常落在半像素
/// 边界),而这条矩形决定一个点击是否在获准应用的窗口内。
pub(crate) fn cf_number_double(ptr: *const c_void) -> Option<f64> {
	if !cf_is(ptr, type_ids().number) {
		return None;
	}
	let mut out: f64 = 0.0;
	// SAFETY:同上,double 缓冲。
	if !unsafe { sys::CFNumberGetValue(ptr, K_CF_NUMBER_DOUBLE, &mut out as *mut f64 as *mut c_void) } {
		return None;
	}
	Some(out)
}

/// CFBoolean → bool;非布尔 → `None`。
pub(crate) fn cf_bool_value(ptr: *const c_void) -> Option<bool> {
	if !cf_is(ptr, type_ids().boolean) {
		return None;
	}
	Some(unsafe { sys::CFBooleanGetValue(ptr) })
}

/// `kCFBooleanTrue`(共享单例,只读不拥有)。
pub fn cf_true() -> *const c_void {
	// SAFETY:读 extern static 的值 —— 它本身是指针常量。
	unsafe { sys::kCFBooleanTrue }
}

/// 空的 mutable CFDictionary,标准 CFType callbacks(**地址**,不是「第一
/// 个字」;见 `sys` 块内注释)。
pub fn cf_type_dict() -> Option<CfRef> {
	// SAFETY:两个 static 是框架自有的静态存储,进程期内有效;这正是该
	// API 要的地址。
	let ptr = unsafe {
		sys::CFDictionaryCreateMutable(
			std::ptr::null(),
			0,
			std::ptr::addr_of!(sys::kCFTypeDictionaryKeyCallBacks) as *const c_void,
			std::ptr::addr_of!(sys::kCFTypeDictionaryValueCallBacks) as *const c_void,
		)
	};
	unsafe { CfRef::from_created(ptr as *mut c_void) }
}

mod accessibility;
pub use accessibility::*;

// ── CoreGraphics:窗口列表 ──

/// CoreGraphics 在屏窗口列表的一项。
#[derive(Clone, Debug)]
pub struct WindowInfo {
	pub window_id: u32,
	pub pid: i32,
	pub owner_name: String,
	pub title: String,
	pub layer: i64,
	/// 左上坐标系的屏幕矩形;不可用时 `None`(无 kCGWindowBounds 不是
	/// 「原点的矩形」—— 那会无声认领屏幕左上角)。
	pub bounds: Option<(f64, f64, f64, f64)>,
}

/// 枚举在屏窗口(排除桌面元素)。本包**唯一**的应用/pid 解析机制:进程
/// 名搜索返回短命 helper(实测 pgrep -n "Google Chrome" 答的是随即退出的
/// helper,真浏览器在另一个 pid)—— 拥有可见 layer-0 窗口的 pid 才有已
/// 填充的无障碍树。
pub fn window_list() -> Vec<WindowInfo> {
	// SAFETY:常量参数的纯 Copy 调用。
	let info = unsafe {
		sys::CGWindowListCopyWindowInfo(
			K_CG_WINDOW_LIST_ON_SCREEN_ONLY | K_CG_WINDOW_LIST_EXCLUDE_DESKTOP,
			K_CG_NULL_WINDOW_ID,
		)
	};
	// SAFETY:Copy-Rule +1。
	let Some(array) = (unsafe { CfRef::from_created(info as *mut c_void) }) else {
		return Vec::new();
	};
	let dict_type = type_ids().dictionary;
	let mut out = Vec::new();
	for entry in cf_array_items(array.as_ptr(), 0) {
		if !cf_is(entry, dict_type) {
			continue;
		}
		let (Some(window_id), Some(pid)) = (dict_int(entry, CG_WINDOW_NUMBER), dict_int(entry, CG_WINDOW_OWNER_PID))
		else {
			continue;
		};
		out.push(WindowInfo {
			window_id: window_id as u32,
			pid,
			owner_name: dict_str(entry, CG_WINDOW_OWNER_NAME),
			title: dict_str(entry, CG_WINDOW_NAME),
			layer: dict_int(entry, CG_WINDOW_LAYER).unwrap_or(0) as i64,
			bounds: dict_bounds(entry),
		});
	}
	out
}

fn dict_int(entry: *const c_void, key: &str) -> Option<i32> {
	let key = cf_string(key)?;
	// SAFETY:entry 已验为 CFDictionary;key 合法。
	let value = unsafe { sys::CFDictionaryGetValue(entry, key.as_ptr()) };
	cf_number_int(value)
}

/// CFDictionary → String(缺失/非字符串 → "")。窗口列表字典与 Info.plist
/// 共用。
pub(crate) fn dict_str(entry: *const c_void, key: &str) -> String {
	let Some(key) = cf_string(key) else { return String::new() };
	// SAFETY:同上。
	let value = unsafe { sys::CFDictionaryGetValue(entry, key.as_ptr()) };
	cf_string_value(value)
}

fn dict_float(dict: *const c_void, key: &str) -> Option<f64> {
	let key = cf_string(key)?;
	// SAFETY:同上。
	let value = unsafe { sys::CFDictionaryGetValue(dict, key.as_ptr()) };
	cf_number_double(value)
}

fn dict_bounds(entry: *const c_void) -> Option<(f64, f64, f64, f64)> {
	let key = cf_string(CG_WINDOW_BOUNDS)?;
	// SAFETY:同上。
	let raw = unsafe { sys::CFDictionaryGetValue(entry, key.as_ptr()) };
	if !cf_is(raw, type_ids().dictionary) {
		return None;
	}
	let (x, y, w, h) = (
		dict_float(raw, CG_BOUNDS_X)?,
		dict_float(raw, CG_BOUNDS_Y)?,
		dict_float(raw, CG_BOUNDS_W)?,
		dict_float(raw, CG_BOUNDS_H)?,
	);
	if w <= 0.0 || h <= 0.0 {
		return None;
	}
	Some((x, y, w, h))
}

// ── libproc ──

/// *pid* 的可执行路径(proc_pidpath),或 `""`。
pub fn pid_path(pid: i32) -> String {
	let mut buffer = vec![0u8; PROC_PIDPATH_MAX as usize];
	// SAFETY:缓冲按符号契约定容;pid 为进程 id。
	let written = unsafe { sys::proc_pidpath(pid, buffer.as_mut_ptr() as *mut c_char, PROC_PIDPATH_MAX) };
	if written <= 0 {
		return String::new();
	}
	let end = buffer.iter().position(|b| *b == 0).unwrap_or(written as usize);
	String::from_utf8_lossy(&buffer[..end]).into_owned()
}

/// `PROC_PIDTBSDINFO` flavor 值。
const PROC_PIDTBSDINFO: c_int = 3;
/// `sizeof(struct proc_bsdinfo)`(SDK sys/proc_info.h)。
const PROC_BSDINFO_SIZE: usize = 136;
/// `pbi_ppid` 的偏移。**以本机 SDK 头为准**(:59 起 flags=0/status=4/
/// xstatus=8/pid=12/**ppid=16**/uid=20)—— 老布局把它放 4,不核对就抄旧
/// 值会静默读到 uid。
const PROC_BSDINFO_OFF_PPID: usize = 16;

/// *pid* 的父 pid(proc_pidinfo + PROC_PIDTBSDINFO,无需 entitlement),失败
/// `-1`。给 permissions 的有界祖先走查用。
pub fn ppid_of(pid: i32) -> i32 {
	let mut buffer = [0u8; PROC_BSDINFO_SIZE];
	// SAFETY:缓冲与 flavor 声明的结构体同大;pid 为进程 id。
	let written = unsafe {
		sys::proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, buffer.as_mut_ptr() as *mut c_void, buffer.len() as c_int)
	};
	if written <= 0 {
		return -1;
	}
	u32::from_le_bytes(buffer[PROC_BSDINFO_OFF_PPID..PROC_BSDINFO_OFF_PPID + 4].try_into().expect("4-byte slice"))
		as i32
}

// ── POSIX:launch 的可写性探针(libc;REF `os.geteuid`/`os.access`) ──

/// 本进程的 effective uid(`geteuid`)。launch 的 replaceable 检查用:owner
/// 可随时 chmod,所以**属主**才是「此文件可被谁重写」的持久答案,mode 不
/// 是(REF `_file_is_replaceable` 的核心论证)。
pub fn effective_uid() -> u32 {
	// SAFETY:无参纯查询。
	unsafe { sys::geteuid() }
}

/// `access(path, W_OK)`:内核对 effective 凭据(含组与 ACL)的写权限答
/// 案。路径含内嵌 NUL 时 false —— 那不是我们能寻址的路径。
pub fn access_w_ok(path: &std::path::Path) -> bool {
	let Ok(c_path) = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()) else {
		return false;
	};
	// SAFETY:c_path NUL 结尾且在调用期间存活;W_OK 是模式常量。
	unsafe { sys::access(c_path.as_ptr(), sys::W_OK) == 0 }
}

mod input;
pub use input::*;

mod image;
pub use image::*;

// ── Info.plist 解析(apps.rs 的硬化读出 CF 对象的最后一步) ──

/// 把**已读好、已定容**的 plist 字节解析为顶层 CFDictionary;空/畸形 →
/// `None`。解析器是 CoreFoundation 自带(二进制与 XML 两种格式都吃,等价
/// REF 的 `plistlib.loads`);大小与符号链接的防线在调用方读文件时。
pub(crate) fn parse_plist_dict(bytes: &[u8]) -> Option<CfRef> {
	if bytes.is_empty() {
		return None;
	}
	// SAFETY:纯 Create 调用;bytes 指向 len 个有效字节,生命周期覆盖调用。
	let data = unsafe { sys::CFDataCreate(std::ptr::null(), bytes.as_ptr(), bytes.len() as c_long) };
	// SAFETY:Create-Rule +1。
	let data = unsafe { CfRef::from_created(data as *mut c_void) }?;
	// SAFETY:data 合法;options=0(不可变解析);format/error 置空。
	let parsed = unsafe {
		sys::CFPropertyListCreateWithData(
			std::ptr::null(),
			data.as_ptr(),
			0,
			std::ptr::null_mut(),
			std::ptr::null_mut(),
		)
	};
	// SAFETY:Create-Rule +1。
	let parsed = unsafe { CfRef::from_created(parsed as *mut c_void) }?;
	if cf_is(parsed.as_ptr(), type_ids().dictionary) { Some(parsed) } else { None }
}

// ── 纯 FFI 级测试(无障碍树/截图不在内;窗口服务器与授权相关的在
//    `#[ignore]` 冒烟里)──────────────────────────────────────────

#[cfg(test)]
mod tests {
	use super::*;
	use point_computer_core::types::{PERMISSION_GRANTED, PERMISSION_MISSING, PermissionProbe};

	#[test]
	fn cf_string_round_trips_and_rejects_wrong_types() {
		let s = cf_string("héllo → point").expect("CFString creation succeeds");
		assert_eq!(cf_string_value(s.as_ptr()), "héllo → point");
		// 数字不是字符串:类型检查读作 "",而非崩溃。
		let key = cf_string("n").unwrap();
		let mut forty_two: i32 = 42;
		// SAFETY:缓冲与 K_CF_NUMBER_SINT32 匹配。
		let num = unsafe {
			CfRef::from_created(sys::CFNumberCreate(
				std::ptr::null(),
				K_CF_NUMBER_SINT32,
				&mut forty_two as *mut i32 as *const c_void,
			) as *mut c_void)
		}
		.unwrap();
		assert_eq!(cf_string_value(num.as_ptr()), "");
		assert_eq!(cf_number_int(num.as_ptr()), Some(42));
		assert_eq!(cf_string_value(key.as_ptr()), "n");
	}

	#[test]
	fn cf_type_dict_accepts_values() {
		let dict = cf_type_dict().expect("dictionary creation succeeds");
		let key = cf_string("k").unwrap();
		// SAFETY:合法 CF 对象三枚。
		unsafe { sys::CFDictionarySetValue(dict.as_ptr(), key.as_ptr(), cf_true()) };
		// SAFETY:同上。
		let value = unsafe { sys::CFDictionaryGetValue(dict.as_ptr(), key.as_ptr()) };
		assert_eq!(cf_bool_value(value), Some(true));
	}

	#[test]
	fn same_element_uses_identity_not_addresses() {
		let a = cf_string("x").unwrap();
		let retained = a.retain();
		// 不同分配、同一对象:CFEqual 说同一。
		assert!(same_element(a.as_ptr(), retained.as_ptr()));
		let b = cf_string("x").unwrap();
		// 同值、不同对象:相等值但…… CFString 的 CFEqual 按内容;此处只
		// 验证双 NULL 语义与函数可用性,内容比较不是本测的主题。
		assert!(!same_element(std::ptr::null(), std::ptr::null()));
		assert!(!same_element(std::ptr::null(), b.as_ptr()));
	}

	#[test]
	fn sanitize_action_collapses_and_clips() {
		// Notes 实测的注入形态:内嵌换行的应用自生成描述。
		assert_eq!(
			sanitize_action("Name:remove pin\nTarget:0x0\nSelector:(null)"),
			"Name:remove pin Target:0x0 Selector:(null)"
		);
		// 48 字符裁剪(字符数,不是字节数 —— 多字节标题不被劈开)。
		let long = "a".repeat(200);
		assert_eq!(sanitize_action(&long).chars().count(), MAX_ACTION_NAME_LEN);
		assert_eq!(sanitize_action("  AX\tPress\n"), "AX Press");
	}

	#[test]
	fn pid_path_of_self_is_nonempty() {
		let path = pid_path(std::process::id() as i32);
		assert!(path.contains('/'), "proc_pidpath should name our own binary: {path}");
	}

	#[test]
	fn ppid_of_self_and_of_the_dead() {
		let me = std::process::id() as i32;
		// 结构体布局若错(老偏移 4 读到的是自 pid),这里会读到 pid 本身。
		let ppid = ppid_of(me);
		assert_ne!(ppid, me, "offset must not read back our own pid");
		assert!(ppid >= 0);
		// 不存在的 pid:-1,而非垃圾。
		assert_eq!(ppid_of(999_999), -1);
	}

	#[test]
	fn type_ids_are_distinct_and_cached() {
		let ids = type_ids();
		// 保存第一次的地址 —— OnceLock 保证同一实例。
		assert_eq!(ids as *const TypeIds, type_ids() as *const TypeIds);
		assert_ne!(ids.string, ids.number);
		assert_ne!(ids.ax_element, ids.ax_value);
	}

	/// 冒烟:窗口服务器真实往返(不需要辅助功能授权;无屏会话会空)。
	#[test]
	#[ignore = "needs a desktop window server session"]
	fn window_list_smoke() {
		let windows = window_list();
		assert!(!windows.is_empty(), "an interactive macOS session has on-screen windows");
		assert!(windows.iter().all(|w| w.pid > 0));
	}

	/// 冒烟:AX 与屏幕录制探针(仅诊断,不设门)。
	#[test]
	#[ignore = "needs a desktop session; prints the advisory readings"]
	fn permission_probes_smoke() {
		let probe = PermissionProbe {
			accessibility: if ax_is_process_trusted() { PERMISSION_GRANTED } else { PERMISSION_MISSING },
			screen_recording: if preflight_screen_capture() { PERMISSION_GRANTED } else { PERMISSION_MISSING },
			responsible_hint: String::new(),
		};
		println!("probe = {:?}", probe);
	}
}
