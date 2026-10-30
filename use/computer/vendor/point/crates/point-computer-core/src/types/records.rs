//! Native application, observation and driver request/result records.

use super::*;

// ── 冻结数据容器 ──

/// 从屏幕窗口列表解析出的应用。**永远经窗口列表,绝不 pgrep**:pgrep -n
/// 会命中短命 helper(Chrome/Slack helper 对一切属性读返
/// kAXErrorCannotComplete),拥有可见 layer-0 窗口的 pid 才有填充的树。
#[derive(Debug, Clone, PartialEq, Eq, Hash, Default)]
pub struct AppRef {
	pub name: String,
	pub pid: i32,
	/// macOS:CFBundleIdentifier;Windows:exe 名(hosted 窗口用标题)。
	pub bundle_id: String,
	/// macOS:CGWindowID;Windows:根 HWND。
	pub window_id: u32,
	pub window_title: String,
}

impl AppRef {
	/// 稳定**应用身份**键:bundle id 优先,否则进程名。刻意窗口无关 ——
	/// 拒绝名单与操作者 allow/deny 模式的正确粒度(拒 Terminal 就是拒
	/// 每个 Terminal 窗口)。不是快照缓存键(那是 [`Self::window_key`])。
	pub fn key(&self) -> String {
		let identity = if self.bundle_id.is_empty() { &self.name } else { &self.bundle_id };
		identity.trim().to_lowercase()
	}

	/// 快照缓存键:应用身份 + 具体窗口 + pid。元素索引寻址**一个窗口**的
	/// 树,只按应用键缓存会让同一应用的两个文档互串(指纹查不出来:两个
	/// 文档的工具栏 routinely 同形)。window_id 仅会话内唯一,重启动应用
	/// 可复用,加 pid 后不可能别名两个活窗口。
	pub fn window_key(&self) -> String {
		format!("{}#{}#{}", self.key(), self.pid, self.window_id)
	}

	/// 人/模型面身份,如 `com.apple.finder (pid 1041)`。
	pub fn label(&self) -> String {
		let identity = if self.bundle_id.is_empty() { self.name.clone() } else { self.bundle_id.clone() };
		format!("{identity} (pid {})", self.pid)
	}
}

/// 启动目标在**进程尚不存在时**的称呼。启动用显示名请求,而 OS 在进程
/// 存在后报出的身份(com.apple.TextEdit / notepad.exe)是其他所有拒绝
/// 展示给操作者的拼写 —— 只知显示名的预检会漏配操作者自己写的规则,
/// 让 deny 晚一步生效。`key` 携带那个第二拼写,经 [`Self::as_app_ref`]
/// 到达策略。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchIdentity {
	pub display: String,
	pub key: String,
}

impl LaunchIdentity {
	/// policy.check_app 应过问的 AppRef。双名并载:deny 匹配任一字段即拒
	/// (并集),allow 名单匹配任一即过 —— 分开各查一次会让写了
	/// `mspaint.exe` 的非空名单拒绝 `mspaint`。pid=0:尚无进程。
	pub fn as_app_ref(&self) -> AppRef {
		AppRef {
			name: self.display.clone(),
			pid: 0,
			bundle_id: if self.key.is_empty() { self.display.clone() } else { self.key.clone() },
			window_id: 0,
			window_title: self.display.clone(),
		}
	}
}

/// 窗口本地矩形(x, y 为窗口内左上原点)。命名结构体而非 `[f64; 4]`:
/// 消灭 x/y/w/h 在渲染与 FFI 边界的位置转置。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Frame {
	pub x: f64,
	pub y: f64,
	pub w: f64,
	pub h: f64,
}

/// 渲染后无障碍树的一个节点,以 `index` 寻址。
///
/// `subrole` 与 `secure` 是**必填**而非便利:macOS 把密码框报成
/// role='AXTextField' + subrole='AXSecureTextField' 且值可读,`secure`
/// (由 driver 从**双属性**置位)是「值永不渲染、输入必拒」的唯一可靠信号。
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ElementRec {
	/// 稠密先序索引 —— 寻址句柄。
	pub index: u32,
	pub role: String,
	pub subrole: String,
	pub title: String,
	/// secure 记录永不填充。
	pub value: String,
	pub actions: Vec<String>,
	pub depth: u16,
	pub secure: bool,
	pub enabled: bool,
	/// 窗口**本地**坐标(截图是该窗口的裁剪,屏幕绝对矩形无法与模型可见
	/// 的任何东西关联;用户拖动窗口时数值仍稳定)。
	pub frame: Option<Frame>,
	/// 走查时由三态 AX 读推导(selected/expanded/editable);空 = 无观察。
	pub traits: Vec<String>,
	/// 该记录是应用的焦点元素(AXFocusedUIElement)。每快照至多一条。
	pub focused: bool,
}

impl ElementRec {
	/// 紧凑角色:`AXButton` → `button`。
	pub fn short_role(&self) -> String {
		let stripped = self.role.strip_prefix("AX").unwrap_or(&self.role);
		if stripped.is_empty() { "?".to_string() } else { stripped.to_lowercase() }
	}
}

/// 一个应用窗口的一次无障碍走查,外加可选像素。
///
/// `captured_at` 是单调钟读数(见 [`crate::clock`])—— 绝非墙上钟,时钟
/// 调整不能让旧快照显新(或新快照显旧)。`image_jpeg` 是后端产出的编码
/// 字节;`image_path` 在字节落盘后填上 —— **只有路径**会转达给模型。
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Snapshot {
	pub app: AppRef,
	pub elements: Vec<ElementRec>,
	pub window_title: String,
	pub captured_at: f64,
	pub truncated: bool,
	pub depth_truncated: bool,
	pub has_secure: bool,
	pub image_jpeg: Vec<u8>,
	pub image_path: String,
	pub image_width: u32,
	pub image_height: u32,
	/// 目标窗口的屏幕矩形(左上原点)—— 元素 frame 的参照原点。
	/// 窗口列表无可用 bounds 时为 None,此时元素 frame 也为 None
	/// (而非悄悄变成屏幕绝对)。
	pub window_bounds: Option<Frame>,
	/// 焦点元素内用户当前文本选区(已清洗裁剪;secure 焦点/无焦点为空)。
	pub selected_text: String,
	/// 焦点元素的有界文本。安全门未通过时保持空，调用方不得先读取再删除。
	pub focused_text: String,
	/// 焦点元素文档范围。树不完整、截断或安全未知时保持空。
	pub document_text: String,
	/// `available`、`unavailable`、`suppressed`，或空表示本次没有文本协商结果。
	pub text_state: String,
	pub text_reason: String,
	/// `windows.graphics.capture`、`print_window`、`suppressed`、`unavailable`，或空。
	pub capture_backend: String,
	pub capture_error: String,
	pub capture_fallback: String,
	/// 本快照实际走查时的树预算(service.snapshot 盖戳)。漂移核验的重走
	/// 读它,以重走**给模型看过的同一棵树**(用 1200 默认核验 2001 预算的
	/// 快照会让 1200 以上元素永久不可寻址 —— 无出口的循环)。后端直建的
	/// 快照为 None,调用方用自己的请求。
	pub walk_budget: Option<SnapshotRequest>,
}

impl Snapshot {
	/// 索引键 —— 元素索引所属的**窗口**(`AppRef::window_key`,非
	/// `AppRef::key`:同一应用另一窗口的索引无意义)。
	pub fn key(&self) -> String {
		self.app.window_key()
	}
}

/// 每个 backend 方法的统一返回。单一结果类型(而非每方法各自返回加
/// 异常)让 UnsupportedBackend 能以同一类型化拒绝回应一切方法。
///
/// `text` 是最终文案:ok=false 时是**不带** `Error: ` 前缀的拒绝理由
/// (dispatch 层恰好加一次 —— 前缀既不会翻倍也不会漏)。
#[derive(Debug, Clone, Default)]
pub struct DriverResult {
	pub ok: bool,
	pub text: String,
	pub apps: Vec<AppRef>,
	pub app: Option<AppRef>,
	pub snapshot: Option<Snapshot>,
}

impl DriverResult {
	/// 拒绝(不带前缀)。
	pub fn refuse(text: impl Into<String>) -> Self {
		DriverResult { ok: false, text: text.into(), ..DriverResult::default() }
	}

	/// 成功,仅文案。
	pub fn ok_text(text: impl Into<String>) -> Self {
		DriverResult { ok: true, text: text.into(), ..DriverResult::default() }
	}

	/// 应用列表(computer_list_apps 的结果)。
	pub fn apps(apps: Vec<AppRef>) -> Self {
		DriverResult { ok: true, text: String::new(), apps, app: None, snapshot: None }
	}
}

/// 该 backend 此处能否驱动 computer use,不能则为何。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendStatus {
	pub supported: bool,
	pub platform_id: String,
	pub reason: String,
}

/// macOS 权限的**建议性**提示(绝不为门;responsible_hint 指出该授给
/// 谁:TCC 授予归因于进程树的 responsible parent 而非发起的 sidecar)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PermissionProbe {
	pub accessibility: &'static str,
	pub screen_recording: &'static str,
	pub responsible_hint: String,
}

impl Default for PermissionProbe {
	fn default() -> Self {
		PermissionProbe {
			accessibility: PERMISSION_UNKNOWN,
			screen_recording: PERMISSION_UNKNOWN,
			responsible_hint: String::new(),
		}
	}
}

/// keystone 状态文件中的操作者目标策略。`allowed_apps` 是可选白名单
/// (空 = 未拒绝即允许);`extra_denied_apps` 只能**加**内建拒绝 ——
/// 刻意没有移除内建条目的机制,floor 不可被 dashboard 或 prompt 注入编辑掉。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PolicyConfig {
	pub allowed_apps: Vec<String>,
	pub extra_denied_apps: Vec<String>,
}

impl PolicyConfig {
	/// 从(可能手编的)keystone 映射构建 —— 绝不 panic。present-but-
	/// malformed 的 `allowed_apps` 唯一严格:空元组**意为「无限制」**,
	/// 把手误静默转成空表 = 把限制悄悄改成放行(见 REF `_str_tuple`)。
	pub fn from_state(state: &Json) -> Result<Self, ComputerUseError> {
		Ok(PolicyConfig {
			allowed_apps: Self::str_list(state.get(STATE_KEY_ALLOWED_APPS), true)?,
			extra_denied_apps: Self::str_list(state.get(STATE_KEY_EXTRA_DENIED_APPS), false)?,
		})
	}

	fn str_list(raw: Option<&Json>, strict: bool) -> Result<Vec<String>, ComputerUseError> {
		let Some(value) = raw else { return Ok(Vec::new()) };
		let Json::Arr(items) = value else {
			if strict {
				return Err(ComputerUseError::PolicyState(
					"allowed_apps must be a JSON list of strings; a malformed value would silently remove the restriction it was meant to express".into(),
				));
			}
			return Ok(Vec::new());
		};
		let mut out = Vec::new();
		for item in items {
			match item.as_str() {
				Some(s) if !s.trim().is_empty() => out.push(s.trim().to_lowercase()),
				_ => {
					if strict {
						// 列表内的畸形条目与容器畸形是同一个放宽 bug:
						// `[{"name":"Preview"}]` 是列表,逐条丢弃后得到的
						// 空表仍意为「无限制」→ strict 必须逐条拒绝。
						return Err(ComputerUseError::PolicyState(
							"every allowed_apps entry must be a non-empty string; a malformed entry would silently remove the restriction it was meant to express".into(),
						));
					}
				}
			}
		}
		Ok(out)
	}
}

/// 一次 computer_get_state 走查必须遵守的预算。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnapshotRequest {
	pub max_nodes: usize,
	pub max_depth: usize,
	pub text_limit: usize,
	pub want_image: bool,
	pub image_max_px: u32,
	pub image_quality: u8,
}

impl Default for SnapshotRequest {
	fn default() -> Self {
		SnapshotRequest {
			max_nodes: DEFAULT_MAX_TREE_NODES,
			max_depth: DEFAULT_MAX_TREE_DEPTH,
			text_limit: DEFAULT_TEXT_LIMIT,
			want_image: DEFAULT_ATTACH_SCREENSHOT,
			image_max_px: DEFAULT_SCREENSHOT_MAX_PX,
			image_quality: DEFAULT_SCREENSHOT_JPEG_QUALITY,
		}
	}
}

/// 一次已解析的点击:怎么点、点哪、哪个按钮、几次。
///
/// 方法在 driver 之前**已解析**(auto 到不了 backend —— chokepoint 的
/// [`crate::policy::resolve_click_method`] 把它变成具体方法),driver 不能
/// 重新决定并选到移动指针的路径;`point` 为 None 即元素寻址形态,
/// 「element_index XOR x+y」由类型系统承载,不是每个 backend 重查的约定。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClickRequest {
	pub method: ClickMethod,
	/// 左上原点屏幕坐标;元素寻址形态为 None。
	pub point: Option<(f64, f64)>,
	pub button: MouseButton,
	pub count: u8,
}

impl Default for ClickRequest {
	fn default() -> Self {
		ClickRequest {
			method: ClickMethod::Accessibility,
			point: None,
			button: MouseButton::Left,
			count: DEFAULT_CLICK_COUNT,
		}
	}
}

impl ClickRequest {
	/// 该点击是否弯曲操作者的物理光标 —— 每个门/审计/拒绝读的唯一谓词。
	pub fn moves_pointer(&self) -> bool {
		self.method.moves_pointer()
	}
}

/// 一次拖拽:两端点 + 按钮 + 路径**形状**。刻意只有坐标形态(拖拽的
/// 意义就是两点间的路径,无 AX 动作能表达)。两端点为左上原点屏幕坐标。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DragRequest {
	pub start: (f64, f64),
	pub end: (f64, f64),
	pub method: ClickMethod,
	pub button: MouseButton,
	/// 路径分段数(结果为 steps+1 个点;1 = 仅端点)。
	pub steps: u16,
	pub path: DragPath,
}

impl Default for DragRequest {
	fn default() -> Self {
		DragRequest {
			start: (0.0, 0.0),
			end: (0.0, 0.0),
			method: ClickMethod::AppPost,
			button: MouseButton::Left,
			steps: DEFAULT_DRAG_STEPS,
			path: DragPath::Straight,
		}
	}
}

impl DragRequest {
	pub fn moves_pointer(&self) -> bool {
		self.method.moves_pointer()
	}
}

/// 内建目标拒绝名单的一条:类别 + 理由(理由随规则走,设置面板与拒绝
/// 文案共用,不复制文字)。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeniedApp {
	pub category: &'static str,
	pub reason: &'static str,
	pub bundle_prefixes: &'static [&'static str],
	pub name_substrings: &'static [&'static str],
	/// 与解析出的**窗口标题**比对(非应用身份):宿主应用可以显示别人
	/// 的 UI —— 我们的 dashboard 在浏览器标签里呈现的是 Chrome 的 bundle
	/// id 与进程名,身份匹配看不见,只有标题活下来。只用于**加**拒绝,
	/// 标题匹配永远不能解除 bundle 匹配。
	pub title_substrings: &'static [&'static str],
}

/// 文案模板填充:把 `{name}` 占位符的全部出现替换为给定值。REF 用 Python
/// `str.format`;Rust 侧以此小函数保持「模板常量 + 一处填充」的单一居所,
/// 而不把长文案散落成各调用点的 format! 字面量(测试也因此能钉住整句)。
/// 注意 `{secs:.1}` 这类带格式_spec_的占位符由调用点预先格式化后以整串
/// 占位符为键传入。
pub fn fill(template: &str, pairs: &[(&str, &str)]) -> String {
	let mut out = template.to_string();
	for (name, value) in pairs {
		out = out.replace(name, value);
	}
	out
}
