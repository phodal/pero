//! 数据类型与常量 —— REF `types.py` 的移植(单一居所原则:业务逻辑里
//! 不出现硬编码字符串/数值)。刻意平台无关、零依赖,与 REF 相同地在
//! macOS/Linux/Windows/CI 上以同一行为加载。
//!
//! 异常 → [`ComputerUseError`] 枚举(REF 把异常放在 types.py 的同一理由:
//! 它们是 backend 契约的一部分)。

use std::fmt;
use std::str::FromStr;

use crate::json::Json;

// ── 平台标识(稳定字符串:出现在拒绝文案/审计中,测试钉住) ──
pub const PLATFORM_MACOS: &str = "macos";
pub const PLATFORM_WINDOWS: &str = "windows";
pub const PLATFORM_LINUX: &str = "linux";
pub const PLATFORM_FAKE: &str = "fake";
pub const PLATFORM_UNSUPPORTED: &str = "unsupported";

// ── 工具名(全部 computer_ 前缀,避免与浏览器工具在共享白名单中碰撞) ──
pub const TOOL_LIST_APPS: &str = "computer_list_apps";
pub const TOOL_LAUNCH_APP: &str = "computer_launch_app";
pub const TOOL_GET_STATE: &str = "computer_get_state";
pub const TOOL_CLICK: &str = "computer_click";
pub const TOOL_DRAG: &str = "computer_drag";
pub const TOOL_TYPE_TEXT: &str = "computer_type_text";
pub const TOOL_PRESS_KEY: &str = "computer_press_key";
pub const TOOL_SET_VALUE: &str = "computer_set_value";
pub const TOOL_SCROLL: &str = "computer_scroll";
pub const TOOL_PERFORM_ACTION: &str = "computer_perform_action";
pub const TOOL_END_TURN: &str = "computer_end_turn";

/// 全部工具,固定顺序。
pub const ALL_TOOLS: &[&str] = &[
	TOOL_LIST_APPS,
	TOOL_LAUNCH_APP,
	TOOL_GET_STATE,
	TOOL_CLICK,
	TOOL_DRAG,
	TOOL_TYPE_TEXT,
	TOOL_PRESS_KEY,
	TOOL_SET_VALUE,
	TOOL_SCROLL,
	TOOL_PERFORM_ACTION,
	TOOL_END_TURN,
];

/// 只读工具(仅观测,不合成输入)。`computer_end_turn` 是控制面
/// (丢弃缓存快照),既非读也非写。`computer_launch_app` 刻意不在:
/// 启动进程是这套工具里后果最重的动作,与只读相反。
pub const READ_ONLY_TOOLS: &[&str] = &[TOOL_LIST_APPS, TOOL_GET_STATE];

/// 所有向其他应用窗口合成输入的工具 —— PreToolUse 门绝不自动批准的集合。
/// `computer_launch_app` 虽不合成输入也在内:这个分类的目的是「改变
/// KiroCrew/Point 之外世界的动词」,而启动进程是其中最大者。
pub const MUTATING_TOOLS: &[&str] = &[
	TOOL_LAUNCH_APP,
	TOOL_CLICK,
	TOOL_DRAG,
	TOOL_TYPE_TEXT,
	TOOL_PRESS_KEY,
	TOOL_SET_VALUE,
	TOOL_SCROLL,
	TOOL_PERFORM_ACTION,
];

// ── 点击方法(click_method 词表) ──
// 四个建立在公开 API 上;唯独 sky_click 需要私有 SkyLight 框架,隔离在
// macos/skylight.rs。与 global 一样必须显式点名 —— auto 永不解析到它:
// 私有 API 路径不该被未点名的模型走到。
pub const CLICK_METHOD_AUTO: &str = "auto";
pub const CLICK_METHOD_ACCESSIBILITY: &str = "accessibility";
pub const CLICK_METHOD_APP_POST: &str = "app_post";
pub const CLICK_METHOD_SKY_CLICK: &str = "sky_click";
pub const CLICK_METHOD_GLOBAL: &str = "global";

pub const CLICK_METHODS: &[&str] = &[
	CLICK_METHOD_AUTO,
	CLICK_METHOD_ACCESSIBILITY,
	CLICK_METHOD_APP_POST,
	CLICK_METHOD_SKY_CLICK,
	CLICK_METHOD_GLOBAL,
];

pub const DEFAULT_CLICK_METHOD: ClickMethod = ClickMethod::Auto;

/// 移动操作者真实指针的方法(`CGWarpMouseCursorPosition` + 全局
/// `CGEventPost`)。**auto 刻意缺席且永远不许加入**:模型必须「点名」一个
/// 会移动指针的方法,指针才可能动 —— 隐式解析到它等于没问就抢走鼠标。
pub fn pointer_moving(method: ClickMethod) -> bool {
	matches!(method, ClickMethod::Global)
}

/// 点击方法。字符串词表的类型化化身:无效方法不可表示,`as_str` 与
/// `FromStr` 是与 JSON/文案的仅有边界。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ClickMethod {
	Auto,
	Accessibility,
	AppPost,
	SkyClick,
	Global,
}

impl ClickMethod {
	pub const fn as_str(self) -> &'static str {
		match self {
			ClickMethod::Auto => CLICK_METHOD_AUTO,
			ClickMethod::Accessibility => CLICK_METHOD_ACCESSIBILITY,
			ClickMethod::AppPost => CLICK_METHOD_APP_POST,
			ClickMethod::SkyClick => CLICK_METHOD_SKY_CLICK,
			ClickMethod::Global => CLICK_METHOD_GLOBAL,
		}
	}

	/// 该方法是否移动操作者的真实指针(唯一判定点,见 [`pointer_moving`])。
	pub fn moves_pointer(self) -> bool {
		pointer_moving(self)
	}
}

impl fmt::Display for ClickMethod {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for ClickMethod {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			CLICK_METHOD_AUTO => Ok(ClickMethod::Auto),
			CLICK_METHOD_ACCESSIBILITY => Ok(ClickMethod::Accessibility),
			CLICK_METHOD_APP_POST => Ok(ClickMethod::AppPost),
			CLICK_METHOD_SKY_CLICK => Ok(ClickMethod::SkyClick),
			CLICK_METHOD_GLOBAL => Ok(ClickMethod::Global),
			other => Err(format!("unknown click_method '{other}'")),
		}
	}
}

// ── 鼠标按钮(值为 CGMouseButton 语义;每按钮事件类型三元组在 macos/ffi) ──
pub const MOUSE_BUTTON_LEFT: &str = "left";
pub const MOUSE_BUTTON_RIGHT: &str = "right";
pub const MOUSE_BUTTON_MIDDLE: &str = "middle";
pub const MOUSE_BUTTONS: &[&str] = &[MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE];

/// 鼠标按钮。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum MouseButton {
	#[default]
	Left,
	Right,
	Middle,
}

impl MouseButton {
	pub const fn as_str(self) -> &'static str {
		match self {
			MouseButton::Left => MOUSE_BUTTON_LEFT,
			MouseButton::Right => MOUSE_BUTTON_RIGHT,
			MouseButton::Middle => MOUSE_BUTTON_MIDDLE,
		}
	}
}

impl fmt::Display for MouseButton {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for MouseButton {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			MOUSE_BUTTON_LEFT => Ok(MouseButton::Left),
			MOUSE_BUTTON_RIGHT => Ok(MouseButton::Right),
			MOUSE_BUTTON_MIDDLE => Ok(MouseButton::Middle),
			other => Err(format!("unknown mouse_button '{other}'")),
		}
	}
}

// ── Windows 命名动作(封闭集合;两端共用,故在契约层) ──
pub const WINDOWS_ACTION_PRESS: &str = "press";
pub const WINDOWS_ACTION_TOGGLE: &str = "toggle";
pub const WINDOWS_ACTION_SELECT: &str = "select";
pub const WINDOWS_ACTION_EXPAND: &str = "expand";
pub const WINDOWS_ACTION_COLLAPSE: &str = "collapse";
pub const WINDOWS_SUPPORTED_ACTIONS: &[&str] = &[
	WINDOWS_ACTION_PRESS,
	WINDOWS_ACTION_TOGGLE,
	WINDOWS_ACTION_SELECT,
	WINDOWS_ACTION_EXPAND,
	WINDOWS_ACTION_COLLAPSE,
];

// ── 启动应用 ──
// 目录是安全边界,不是参数:启动只对 OS 自有的已安装应用目录解析,拒绝
// 一切路径/argv/PATH 解析(Windows 实测:HKCU App Paths 与
// %LOCALAPPDATA%\WindowsApps 均为同权限用户可写)。
pub const MAX_LAUNCH_QUERY_LEN: usize = 128;
/// 拒绝文案里列出的应用名数(歧义查询与未命中建议共用;展示上界)。
pub const MAX_LAUNCH_SUGGESTIONS: usize = 6;
/// 等待被启动应用出窗的时长/轮询间隔(实测冷启动 ~9.9s,30s 为三倍余量)。
pub const LAUNCH_WINDOW_TIMEOUT_SECS: f64 = 30.0;
pub const LAUNCH_POLL_INTERVAL_SECS: f64 = 0.25;

/// 拖拽路径形状。`curved` 复用 cursor_motion 的 Bezier + 垂直弧。
pub const DRAG_PATH_STRAIGHT: &str = "straight";
pub const DRAG_PATH_CURVED: &str = "curved";
pub const DRAG_PATHS: &[&str] = &[DRAG_PATH_STRAIGHT, DRAG_PATH_CURVED];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum DragPath {
	#[default]
	Straight,
	Curved,
}

impl DragPath {
	pub const fn as_str(self) -> &'static str {
		match self {
			DragPath::Straight => DRAG_PATH_STRAIGHT,
			DragPath::Curved => DRAG_PATH_CURVED,
		}
	}
}

impl fmt::Display for DragPath {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for DragPath {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			DRAG_PATH_STRAIGHT => Ok(DragPath::Straight),
			DRAG_PATH_CURVED => Ok(DragPath::Curved),
			other => Err(format!("unknown drag path '{other}'. Supported: straight, curved")),
		}
	}
}

/// 拖拽的中间点数(段数;结果为 steps+1 个点)。默认 1 = 仅端点(滑条/
/// 选区要的直线手势);上限是时长界,非保真界(见 REF types.py 论证)。
pub const DEFAULT_DRAG_STEPS: u16 = 1;
pub const MIN_DRAG_STEPS: u16 = 1;
pub const MAX_DRAG_STEPS: u16 = 512;

/// 变更动作与其后刷新走查之间的停顿。不是礼貌延迟:没有它走查可能读到
/// 动作前的树,模型看到未变的结果就会重试已落地的动作(双击、删两行)。
pub const POST_ACTION_SETTLE_SECS: f64 = 0.15;

// ── 屏幕坐标范围(多显示器可以远超单屏;此界只挡传给 FFI 的胡话) ──
pub const MAX_SCREEN_COORD: f64 = 32767.0;
pub const MIN_SCREEN_COORD: f64 = -32768.0;
pub const DEFAULT_CLICK_COUNT: u8 = 1;
pub const MIN_CLICK_COUNT: u8 = 1;
pub const MAX_CLICK_COUNT: u8 = 3;

// ── 观测通道(门返回全部;renderer 与截图中继共用的名字) ──
pub const OBS_A11Y_TREE: &str = "a11y_tree";
pub const OBS_SCREENSHOT: &str = "screenshot";
pub const OBS_OCR: &str = "ocr";
pub const OBS_WINDOW_TITLES: &str = "window_titles";
pub const OBS_FILE_PATHS: &str = "file_paths";
pub const OBS_ELEMENT_VALUES: &str = "element_values";
pub const ALL_OBSERVATION_CHANNELS: &[&str] =
	&[OBS_A11Y_TREE, OBS_SCREENSHOT, OBS_OCR, OBS_WINDOW_TITLES, OBS_FILE_PATHS, OBS_ELEMENT_VALUES];

pub const OBS_SUPPRESSED_KEY: &str = "screenshot_suppressed_by";
pub const OBS_SUPPRESSED_BY_POLICY: &str = "policy";
pub const OBS_SUPPRESSED_NOTE: &str = "Screenshot suppressed: your organization's security policy does not permit screen capture. The accessibility tree above is the full available detail.";
pub const GOVERNED_VALUE_PLACEHOLDER: &str = "<redacted:policy>";

// ── Keystone 主开关状态文件 ──
// 不放 config.json:完整桌面观测 + 输入合成的主开关是安全上限,放在
// agent 可写的文件里会被 prompt injection 翻转。
pub const STATE_FILE_NAME: &str = "computer_use.json";
pub const STATE_KEY_ENABLED: &str = "enabled";
pub const STATE_KEY_ALLOWED_APPS: &str = "allowed_apps";
pub const STATE_KEY_EXTRA_DENIED_APPS: &str = "extra_denied_apps";
/// 状态文件环境变量覆盖(测试缝;也是 CLI 的显式指向口)。
pub const STATE_FILE_ENV: &str = "POINT_COMPUTER_USE_STATE";

// ── 快照/树预算(默认即发布值;*_LIMIT 是 schema 校验的硬顶) ──
pub const DEFAULT_MAX_TREE_NODES: usize = 1200;
pub const MAX_TREE_NODES_LIMIT: usize = 5000;
pub const DEFAULT_MAX_TREE_DEPTH: usize = 64;
pub const MAX_TREE_DEPTH_LIMIT: usize = 128;
pub const DEFAULT_TEXT_LIMIT: usize = 500;
pub const MAX_TEXT_LIMIT: usize = 20000;
pub const MAX_ELEMENT_INDEX: u32 = 5000;
pub const MAX_TYPE_TEXT_LEN: usize = 10000;
pub const MAX_KEY_LEN: usize = 64;
pub const MAX_ACTION_LEN: usize = 64;
/// 单节点合并子集合上限(AXChildren+AXRows+AXVisibleChildren 去重后)。
pub const MAX_CHILDREN_PER_NODE: usize = 512;
/// 单节点宣告动作数上限(超出部分丢弃,不截断字符串)。
pub const MAX_ACTIONS_PER_NODE: usize = 16;

// ── 快照索引生命周期 ──
/// 元素索引寻址的是活 UI,缓存只在短窗口内可用。90s 够模型在两次工具
/// 调用之间推理,又短到过期树被拒绝而非被操作。
pub const SNAPSHOT_TTL_SECS: f64 = 90.0;
pub const MAX_INDEXED_APPS: usize = 8;

// ── 滚动 ──
pub const SCROLL_UP: &str = "up";
pub const SCROLL_DOWN: &str = "down";
pub const SCROLL_LEFT: &str = "left";
pub const SCROLL_RIGHT: &str = "right";
pub const SCROLL_DIRECTIONS: &[&str] = &[SCROLL_UP, SCROLL_DOWN, SCROLL_LEFT, SCROLL_RIGHT];
pub const DEFAULT_SCROLL_PAGES: f64 = 1.0;
pub const MIN_SCROLL_PAGES: f64 = 0.1;
pub const MAX_SCROLL_PAGES: f64 = 20.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ScrollDirection {
	Up,
	Down,
	Left,
	Right,
}

impl ScrollDirection {
	pub const fn as_str(self) -> &'static str {
		match self {
			ScrollDirection::Up => SCROLL_UP,
			ScrollDirection::Down => SCROLL_DOWN,
			ScrollDirection::Left => SCROLL_LEFT,
			ScrollDirection::Right => SCROLL_RIGHT,
		}
	}
}

impl fmt::Display for ScrollDirection {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		f.write_str(self.as_str())
	}
}

impl FromStr for ScrollDirection {
	type Err = String;

	fn from_str(s: &str) -> Result<Self, Self::Err> {
		match s {
			SCROLL_UP => Ok(ScrollDirection::Up),
			SCROLL_DOWN => Ok(ScrollDirection::Down),
			SCROLL_LEFT => Ok(ScrollDirection::Left),
			SCROLL_RIGHT => Ok(ScrollDirection::Right),
			other => Err(format!("unknown scroll direction '{other}'")),
		}
	}
}

// ── 截图(树是主通道,图是佐证:1280/q55 全可读,~8.3k tokens) ──
pub const DEFAULT_ATTACH_SCREENSHOT: bool = true;
pub const DEFAULT_SCREENSHOT_MAX_PX: u32 = 1280;
pub const DEFAULT_SCREENSHOT_JPEG_QUALITY: u8 = 55;
pub const MIN_SCREENSHOT_MAX_PX: u32 = 320;
/// 刻意等于内联图上限而非任何显示器分辨率(REF 论证:超过上限的图会在
/// 多图会话里让整个请求被拒,且因历史重放,之后每一轮都被卡)。
pub const MAX_SCREENSHOT_MAX_PX: u32 = 2000;
pub const SCREENSHOT_DIR_NAME: &str = "point-computer-shots";
pub const SCREENSHOT_FILE_PREFIX: &str = "shot-";
pub const SCREENSHOT_FILE_SUFFIX: &str = ".jpeg";
/// 环形修剪:目录是缓存不是归档,长会话不能填满临时卷。
pub const SCREENSHOT_KEEP: usize = 200;

// ── AX 属性/角色名 ──
pub const AX_ROLE: &str = "AXRole";
pub const AX_SUBROLE: &str = "AXSubrole";
pub const AX_TITLE: &str = "AXTitle";
pub const AX_VALUE: &str = "AXValue";
pub const AX_DESCRIPTION: &str = "AXDescription";
pub const AX_CHILDREN: &str = "AXChildren";
pub const AX_WINDOWS: &str = "AXWindows";
/// 备用子集合:表格/大纲/列表常只在 AXRows 暴露行,只读 AXChildren 会把
/// 电子表格渲染成空容器。
pub const AX_ROWS: &str = "AXRows";
pub const AX_VISIBLE_CHILDREN: &str = "AXVisibleChildren";
/// 每节点读取的子属性及合并顺序(跨集合去重,重复只加覆盖不加节点)。
pub const AX_CHILD_ATTRIBUTES: &[&str] = &[AX_CHILDREN, AX_ROWS, AX_VISIBLE_CHILDREN];
/// 行承载角色:备用集合先行,保行拿低索引。
pub const ROW_BEARING_ROLES: &[&str] = &["AXTable", "AXOutline", "AXList", "AXBrowser"];
pub const AX_ENABLED: &str = "AXEnabled";
pub const AX_POSITION: &str = "AXPosition";
pub const AX_SIZE: &str = "AXSize";
/// 三态读取(absent ≠ false):absent 是「此处无选择概念」,false 是
/// 「可选而未选」。
pub const AX_SELECTED: &str = "AXSelected";
pub const AX_EXPANDED: &str = "AXExpanded";
/// 整个应用子树的焦点元素:每走查读一次(应用元素上),非每节点。
pub const AX_FOCUSED_UI_ELEMENT: &str = "AXFocusedUIElement";
/// 焦点元素内用户当前文本选区;每走查读一次,secure 元素永不读
/// (选中的密码仍是密码)。
pub const AX_SELECTED_TEXT: &str = "AXSelectedText";
pub const AX_PRESS_ACTION: &str = "AXPress";
pub const AX_CONFIRM_ACTION: &str = "AXConfirm";
pub const AX_OPEN_ACTION: &str = "AXOpen";
pub const AX_SHOW_MENU_ACTION: &str = "AXShowMenu";
/// 左键按压阶梯(最具体优先;-25206 最常见且可恢复:三角答 AXConfirm、
/// Finder 行与链接答 AXOpen)。
pub const AX_PRESS_LADDER: &[&str] = &[AX_PRESS_ACTION, AX_CONFIRM_ACTION, AX_OPEN_ACTION];
/// 右键是不同手势,只有 AXShowMenu 表达;绝不回退 AXPress(那会把
/// 「打开菜单」变成「激活控件」)。
pub const AX_MENU_LADDER: &[&str] = &[AX_SHOW_MENU_ACTION];
pub const AX_PARENT: &str = "AXParent";
/// 点击阶梯向上找可压容器的祖先跳数上限(Web 内容常把可点行渲染成
/// 无动作文本节点,但四层之上更可能是页面而非行)。
pub const MAX_ANCESTOR_PRESS_HOPS: usize = 3;
/// 祖先/目标面积比上限:数倍大的容器是布局包装(滚动区/页体),不是行。
pub const MAX_ANCESTOR_AREA_RATIO: f64 = 8.0;

/// **安全关键常量**:真实 macOS 密码框报 `AXRole == "AXTextField"`(无害)
/// 加 `AXSubrole == "AXSecureTextField"` 且值可读 —— 只查 role 会漏掉
/// 每一个密码框。role 与 subrole 都与它比对。
pub const SECURE_SUBROLE: &str = "AXSecureTextField";

/// 无自身信息的结构容器:无标题/值时从渲染树省略,且**不占元素索引**
/// (模型看到的编号保持稠密)。
pub const ELIDABLE_ROLES: &[&str] = &["AXGroup", "AXUnknown", "AXSplitGroup"];

// ── 特质词(括号内渲染;模型动作的是 editable,不是 AXValue is settable) ──
pub const TRAIT_SELECTED: &str = "selected";
pub const TRAIT_EXPANDED: &str = "expanded";
pub const TRAIT_EDITABLE: &str = "editable";
pub const FOCUS_MARKER: &str = "<focused>";
pub const FOCUS_NOTE: &str = "Focus: element {index} ({label}).";
pub const SELECTION_NOTE: &str = "Selected text: [{text}]";
/// 窗口原点注:元素 frame 是窗口本地坐标,坐标点击(屏幕坐标)需要它换算。
pub const WINDOW_ORIGIN_NOTE: &str = "Window origin on screen: x={x},y={y} ({width}x{height}). Element frames above are relative to it — add the origin for a screen point.";

// ── 渲染 ──
/// secure 字段的值永不渲染;占位符顶替(无值、无标题、无特质、无 frame)。
pub const SECURE_PLACEHOLDER: &str = "<secure>";
pub const TREE_INDENT: &str = "  ";
pub const TRUNCATED_NOTE: &str = "[tree truncated at {count} nodes]";
pub const DEPTH_NOTE: &str = "[subtree elided below depth {depth}]";
/// 图片被降采样:上面打印了窗口自身尺寸,读者若以为两者匹配,会把图像
/// 像素当窗口像素(实测差 374-383px,足以点中另一窗格)。
pub const SCREENSHOT_NOTE: &str = "Screenshot: {path}\n  ({width}x{height} jpeg, {size}) — DOWNSCALED from the window size printed above, so image pixels are not window coordinates. Take coordinates from an element's own frame. Read the file with the fs_read tool only if the tree is insufficient.";
/// 已知比例时的显式换算公式(而非裸比率:方向搞反就点到屏幕另一半)。
pub const SCREENSHOT_SCALE_NOTE: &str = "  Image-pixel to screen-point conversion: screen_x = {x} + image_x / {scale}, screen_y = {y} + image_y / {scale} (the image is {scale}x the window's {win_width}x{win_height} pixels). Use this ONLY for a surface with no addressable element — a canvas, a map, a chart. An element's own frame is exact; this is a measurement off a downscaled image and carries its rounding.";
pub const SECURE_WINDOW_NOTE: &str =
	"Screenshot suppressed: this window contains a secure (password) field, so its pixels are not captured.";
/// 截断走查不能证明窗口无密码框,「未知」按「存在」处理 → 不采图。浏览器
/// (Chrome 实测 1475 节点对 1200 默认)截断是常态,不说明原因模型会死循环。
pub const TRUNCATED_WINDOW_NOTE: &str = "Screenshot suppressed: the accessibility tree was truncated, so this window cannot be confirmed free of a secure (password) field. Re-run with a higher max_tree_nodes / max_tree_depth to capture it.";
pub const NO_APPS_NOTE: &str = "No applications with on-screen windows were found.";

// ── 权限探测态(仅建议,绝非硬门:macOS 把 TCC 授予归因于 responsible
//    parent,探针报 missing 时全保真捕获可能照样成功) ──
pub const PERMISSION_GRANTED: &str = "granted";
pub const PERMISSION_MISSING: &str = "missing";
pub const PERMISSION_UNKNOWN: &str = "unknown";
pub const PERMISSION_UNSUPPORTED: &str = "unsupported";

// ── 拒绝/错误文案 ──
// 每个工具结果都是纯文本,错误是字面 "Error: ..." —— 前缀是承重的
// (调用方按它分类失败结局),由 dispatch 恰好加一次。
pub const ERROR_PREFIX: &str = "Error: ";
pub const REFUSAL_UNSUPPORTED: &str = "computer use is not supported on this platform ({platform}): {reason}";
/// Point 适配:REF 指向 KiroCrew dashboard;这里指向 keystone 文件本身。
pub const REFUSAL_DISABLED: &str = "computer use is disabled. Enable it by writing {\"enabled\": true} to the keystone file (~/.point/computer_use.json); it cannot be enabled by an agent.";
pub const REFUSAL_DENIED_APP: &str = "'{app}' is a blocked target for computer use ({reason}).";
pub const REFUSAL_SECURE_TARGET: &str =
	"refusing to send input to a secure (password) field: element {index} of '{app}' has subrole {subrole}.";
pub const REFUSAL_TEXT_SENSITIVE: &str = "refusing to type this text into '{app}': {reason}";

/// 真指针路径:进程内调用方显式 `pointer_enabled=false` 时拒绝(audit 桩
/// 之外唯一可达的本地退出)。
pub const REFUSAL_POINTER_NOT_ENABLED: &str = "Blocked: moving the real mouse pointer is switched off for this caller. Use click_method 'accessibility' or 'app_post' instead — neither moves the pointer.";
/// accessibility 无索引:AXPress 寻址元素,没有坐标形态。不推荐 app_post
/// (Windows 按名拒绝它,一句共享文案不能推荐一个平台没有的路)。
pub const REFUSAL_ACCESSIBILITY_NEEDS_INDEX: &str = "click_method 'accessibility' presses a specific control, so it needs an element_index — there is no coordinate form of an accessibility action. Pass an element_index from computer_get_state. To click a POINT instead, omit click_method and pass x + y, and the platform's own coordinate route is chosen (on Windows that route moves the real cursor, so it must be named explicitly as click_method 'global').";
pub const REFUSAL_CLICK_TARGET_AMBIGUOUS: &str = "give either element_index or both x and y, not both forms — they name different targets and there is no rule for which should win";
pub const REFUSAL_CLICK_TARGET_MISSING: &str =
	"give either element_index (from computer_get_state) or both x and y screen coordinates";
/// 每个移动指针的动作都按 METHOD 审计(允许路径同样):操作者日后要能
/// 回答「agent 是否动过我的鼠标」。
pub const AUDIT_POINTER_ITEM: &str = "click_method={method}";
pub const AUDIT_TOOL_PREFIX: &str = "computer_use:";
pub const ERR_NO_STATE: &str = "no state for '{app}'. Call {tool} first.";
pub const ERR_STALE_STATE: &str = "state for '{app}' is {age}s old. Call {tool} again.";
pub const ERR_UNKNOWN_INDEX: &str = "element_index {index} is not in the last state for '{app}' ({count} elements).";
pub const ERR_INDEX_DRIFT: &str =
	"element_index {index} changed since the last {tool} (was {before}, now {after}). Call {tool} again.";
pub const ERR_APP_NOT_FOUND: &str =
	"no application with an on-screen window matches '{query}'. Call {tool} to see what is available.";
pub const ERR_UNKNOWN_KEY: &str = "unknown key '{key}'.";
pub const ERR_ACTION_FAILED: &str = "{action} on element {index} of '{app}' failed ({detail}).";
pub const ERR_UNKNOWN_CLICK_METHOD: &str = "unknown click_method '{method}'.";
/// 真指针限制拒绝:global 事件不带 pid,点必须证明属于获批应用,否则
/// 「允许的应用 + 覆盖在拒绝应用上的坐标」会点到拒绝应用。
pub const ERR_POINT_NOT_OWNED: &str = "refusing a real-pointer action at ({x}, {y}): that point is not inside the '{app}' window, and a pointer-moving click lands on whatever application is there. Use click_method 'app_post' (or 'accessibility' with an element_index), which deliver to '{app}' directly.";
pub const ERR_UNKNOWN_MOUSE_BUTTON: &str = "unknown mouse_button '{button}'.";
/// 未知拖拽形状:拒绝而非默认直行(替换的形状画出的是**不同**手势)。
pub const ERR_UNKNOWN_DRAG_PATH: &str = "unknown drag path '{path}'. Supported: {supported}";
/// 真驱动与 fake 都发出的形状注(两点拖拽省略:那是历史手势不是新形状)。
pub const DRAG_SHAPE_NOTE: &str = " via {count} {path} points";
/// app_post/global 需要点;auto 解析到 app_post 的分支必有坐标,此条
/// 只对显式点名的方法触发。
pub const ERR_POINT_REQUIRED: &str = "click_method '{method}' clicks a screen point, so it needs both x and y.";
/// sky_click 是左键配方(九个字段之一是按钮号,无证据其余字段与按钮
/// 无关);拒绝而非降级(降级 = 在操作者看不见的后台窗口做另一个手势)。
pub const ERR_SKY_CLICK_BUTTON: &str = "click_method 'sky_click' supports only the left mouse button (got '{button}'). Use click_method 'app_post' for a '{button}' click — it delivers to the same application through a public API.";

// ── 光标运动曲线常量(REF 的「手感」本体) ──
pub const CURVE_DISTANCE_RATIO: f64 = 0.22;
pub const CURVE_AMOUNT_MIN: f64 = 28.0;
pub const CURVE_AMOUNT_MAX: f64 = 110.0;
pub const DEFAULT_CURVE_SCALE: f64 = 1.0;
pub const MAX_CURVE_SCALE: f64 = 4.0;
/// 控制点沿弦放置:前把快出、后把慢收;curve_scale==0 退化为三分点直线。
pub const CURVE_C1_ALONG: f64 = 0.18;
pub const CURVE_C1_ACROSS: f64 = 0.10;
pub const CURVE_C2_ALONG: f64 = 0.80;
pub const CURVE_C2_ACROSS: f64 = 0.96;
pub const STRAIGHT_C1_FRACTION: f64 = 1.0 / 3.0;
pub const STRAIGHT_C2_FRACTION: f64 = 2.0 / 3.0;
/// 第二控制点的弧偏移少于第一把的一半:弓向目标衰减,末段几乎贴弦。
pub const CURVE_C2_OFFSET_RATIO: f64 = 0.48;
/// 退化输入下限:零长度位移无方向无法线,朴素归一会除零出 NaN。
pub const MOTION_EPSILON: f64 = 1e-9;
pub const MIN_MOTION_DISTANCE: f64 = 1.0;

// ── 光标运动:settle 弹簧 ──
/// 临界阻尼弹簧作用于**进度**(0→1)再喂给 Bezier:快出、巡航、无位置
/// 过冲地落定。response/damping 是仅有的两个旋钮,刚度与阻力由它们推导。
pub const SPRING_RESPONSE: f64 = 1.4;
pub const SPRING_DAMPING_FRACTION: f64 = 0.9;
pub const SPRING_DT: f64 = 1.0 / 240.0;
/// 推导刚度上限:近零 response 不能造成无穷弹簧常数(首步即 NaN)。
pub const SPRING_MAX_STIFFNESS: f64 = 28800.0;
pub const SPRING_SETTLE_DISTANCE: f64 = 0.01;
pub const SPRING_MAX_STEPS: usize = 4096;
pub const SPRING_FALLBACK_SETTLE_SECS: f64 = 1.43;

// ── 光标运动:采样 ──
pub const DEFAULT_PATH_SAMPLES: usize = 96;
pub const MIN_PATH_SAMPLES: usize = 2;
pub const MAX_PATH_SAMPLES: usize = 600;
pub const MIN_MOVE_DURATION_MS: u64 = 100;
pub const MAX_MOVE_DURATION_MS: u64 = 2000;
/// 距离达此值以上用弹簧完整 settle 时间;以下线性缩减(弹簧 settle 点与
/// 距离无关,不缩的话 1px 微动与 600px 横扫同为 ~1.4s,读作卡死)。
pub const FULL_SPEED_DISTANCE: f64 = 400.0;
/// 低于此距离完全弃弧(弧下限 28px,1-3px 微动弓出 28px 是看得见的卷曲)。
pub const STRAIGHT_MOVE_DISTANCE: f64 = 24.0;

// ── 启动文案 ──
pub const LAUNCH_RESULT: &str = "launched {app}; its window '{title}' is on screen after {secs:.1}s";
/// `{secs:.0}`(REF `{secs:.0f}`):无窗口是带告白的成功,整秒粒度足够 ——
/// 这个数的读者在决定「要不要再启动一次」,答案是不要,与 0.3 还是 0.9 无关。
pub const LAUNCH_RESULT_NO_WINDOW: &str = "launched {app}, but no window appeared within {secs:.0}s. The process did start — it may still be loading, or it may open no window of its own. Call {tool} to see what is on screen; do NOT launch it again";
pub const ERR_LAUNCH_NOT_INSTALLED: &str = "no installed application matches '{query}'. Launching resolves names against the operating system's own list of installed applications — a filesystem path or a command line is never accepted — so try the name as it appears in the Start menu / Applications folder, or call {tool} if the app is already running";
pub const ERR_LAUNCH_NOT_INSTALLED_NEAR: &str = "no installed application is named '{query}'. Did you mean: {near}? Launching matches the START of an application's name against the operating system's own list of installed applications — a filesystem path or a command line is never accepted";
pub const ERR_LAUNCH_AMBIGUOUS: &str = "'{query}' matches {count} installed applications ({names}). Name one exactly — launching the wrong application is not something you can undo";
pub const ERR_LAUNCH_ALREADY_RUNNING: &str =
	"'{app}' already has a window on screen ('{title}'), so it was NOT launched again. Call {tool} to read it";
pub const ERR_LAUNCH_FAILED: &str = "could not launch '{app}': {detail}";
// 被拒的启动目标没有自己的文案:复用 REFUSAL_DENIED_APP(经 policy.check_app,
// 与其他所有动词同一句拒绝 —— 分开的拼写只会造出绕开操作者名单的分支)。

// ── 异常(REF 异常层级 → 枚举) ──

/// computer-use 的全部失败形态。纯层用 `Result<_, ComputerUseError>`;
/// driver trait 返回 DriverResult(永不 Err),tools 在 chokepoint 把
/// 错误映射为文案。
#[derive(Debug, Clone, PartialEq)]
pub enum ComputerUseError {
	/// 当前平台(或进程)完全无法驱动 computer use。
	Unsupported(String),
	/// 策略/上限/主开关拒绝。
	Denied(String),
	/// press_key 的 spec 命名了未知键或修饰键。
	KeyParse(String),
	/// present-but-malformed 的策略字段(只会 fail-open 的字段;
	/// 见 [`crate::types::PolicyConfig::from_state`] 的 strict 语义)。
	PolicyState(String),
	/// 缓存快照缺失/过期/索引漂移。
	StaleIndex(String),
	/// 无已安装应用匹配启动查询;`near` 携带子串**建议**(绝非可启动
	/// 目标 —— 解析只认前缀,但模型需要真名才能恢复)。
	NoSuchLaunchTarget { query: String, near: String },
	/// 多个已安装应用匹配同一查询(启动错应用无法撤销,故拒绝不猜)。
	AmbiguousLaunchTarget { names: String, count: usize },
}

impl fmt::Display for ComputerUseError {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		match self {
			ComputerUseError::Unsupported(reason) => write!(f, "computer use unsupported: {reason}"),
			ComputerUseError::Denied(reason) => f.write_str(reason),
			ComputerUseError::KeyParse(reason) => f.write_str(reason),
			ComputerUseError::PolicyState(reason) => f.write_str(reason),
			ComputerUseError::StaleIndex(reason) => f.write_str(reason),
			ComputerUseError::NoSuchLaunchTarget { query, .. } => {
				write!(f, "no installed application matches '{query}'")
			}
			ComputerUseError::AmbiguousLaunchTarget { names, count } => {
				write!(f, "'{names}' matches {count} installed applications")
			}
		}
	}
}

impl std::error::Error for ComputerUseError {}

mod records;
pub use records::*;

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn app_ref_keys() {
		let app = AppRef {
			name: "Finder".into(),
			pid: 1041,
			bundle_id: "com.apple.finder".into(),
			window_id: 42,
			window_title: "Downloads".into(),
		};
		assert_eq!(app.key(), "com.apple.finder");
		assert_eq!(app.window_key(), "com.apple.finder#1041#42");
		assert_eq!(app.label(), "com.apple.finder (pid 1041)");

		let unbundled = AppRef { name: " Strange  ".into(), pid: 7, ..app.clone() };
		// name 回退且 trim;空 bundle 不影响。
		let mut bare = unbundled.clone();
		bare.bundle_id = String::new();
		assert_eq!(bare.key(), "strange");
	}

	#[test]
	fn click_method_vocabulary_and_pointer() {
		assert_eq!(ClickMethod::from_str("auto").unwrap(), ClickMethod::Auto);
		assert!(ClickMethod::from_str("magic").is_err());
		for method in [ClickMethod::Auto, ClickMethod::Accessibility, ClickMethod::AppPost, ClickMethod::SkyClick] {
			assert!(!method.moves_pointer(), "{} must not move pointer", method);
		}
		assert!(ClickMethod::Global.moves_pointer());
	}

	#[test]
	fn launch_identity_union_semantics() {
		let identity = LaunchIdentity { display: "mspaint".into(), key: "mspaint.exe".into() };
		let app = identity.as_app_ref();
		assert_eq!(app.name, "mspaint");
		assert_eq!(app.bundle_id, "mspaint.exe");
		assert_eq!(app.window_title, "mspaint"); // 自指目标标题规则仍可命中
		assert_eq!(app.pid, 0);
		// key 为空时 bundle_id 回退 display。
		let bare = LaunchIdentity { display: "X".into(), key: String::new() };
		assert_eq!(bare.as_app_ref().bundle_id, "X");
	}

	#[test]
	fn policy_config_strict_allowed_apps() {
		use crate::json::parse;
		let ok = parse(r#"{"allowed_apps": ["Preview"], "extra_denied_apps": "oops"}"#).unwrap();
		let cfg = PolicyConfig::from_state(&ok).unwrap();
		assert_eq!(cfg.allowed_apps, vec!["preview"]);
		assert!(cfg.extra_denied_apps.is_empty()); // 非 strict 容错

		let scalar = parse(r#"{"allowed_apps": "Preview"}"#).unwrap();
		assert!(matches!(PolicyConfig::from_state(&scalar), Err(ComputerUseError::PolicyState(_))));
		let dict_item = parse(r#"{"allowed_apps": [{"name": "Preview"}]}"#).unwrap();
		assert!(PolicyConfig::from_state(&dict_item).is_err());

		let absent = parse("{}").unwrap();
		assert!(PolicyConfig::from_state(&absent).unwrap().allowed_apps.is_empty());
	}

	#[test]
	fn short_role_strips_ax_prefix() {
		let rec = ElementRec { role: "AXButton".into(), ..ElementRec::default() };
		assert_eq!(rec.short_role(), "button");
		let plain = ElementRec { role: "webarea".into(), ..ElementRec::default() };
		assert_eq!(plain.short_role(), "webarea");
		let empty = ElementRec::default();
		assert_eq!(empty.short_role(), "?");
	}
}
