//! computer-use 的 backend 缝隙:一个 trait、一份契约。REF `backend.py`
//! `ComputerUseBackend` ABC 的移植。
//!
//! 随 OS 变化的是这一个类型;它之上的一切(policy、渲染、索引生命周期、
//! dispatch)平台无关。缝隙是带运行时可换 factory 的普通 trait 而非扩展点,
//! 理由与 REF 相同:平台在**运行的主机**上分派,一次进程内可交换(测试装
//! FakeBackend、CLI 可指向任何已注册实现)。
//!
//! 两条结构性保证(见各实现):
//!
//! * **异常不穿缝。** 每个方法返回 [`DriverResult`];driver 把自己的失败折成
//!   `ok=false`。一个 panic 穿过缝会带走整条工具调用路径 —— 每个实现以
//!   catch_unwind 的 `guarded()` 包裹(见 macOS driver),trait 契约再禁一次。
//! * **指针不动,除非请求点名。** 每个方法默认应用域:元素点击是无障碍动作,
//!   坐标点击/拖拽投递到目标进程,操作者的光标不动。唯一例外是
//!   `moves_pointer()` 为真的 [`ClickRequest`]/[`DragRequest`](global 方法),
//!   它必须被模型**显式点名** —— auto 永不解析到它。
//!
//! 本模块不接触任何 FFI;平台 crate 由 service 的 platform.rs 惰性选择,在
//! Linux CI 上加载本包不触碰任何原生库。

use point_computer_core::types::{
	AppRef, BackendStatus, ClickRequest, DragRequest, DriverResult, ElementRec, LaunchIdentity, PermissionProbe,
	ScrollDirection, SnapshotRequest,
};

/// 拒绝谓词:`Some(理由)` 即拒绝,`None` 放行。
pub type Refusal<'a, T> = &'a dyn Fn(&T) -> Option<String>;

/// `launch_app` 的调用方策略钩子。两个都是「返回 `Some(理由)` 即拒绝」的
/// 谓词;`None`(钩子缺席或放行)继续流程。
///
/// REF 把它们作为 launch_app 的两个 keyword 参数;Rust 侧捆成一个结构体,
/// 让「策略在此流程的哪两处过问」在类型上就是一个整体。
#[derive(Default)]
pub struct LaunchPermit<'a> {
	/// 对**已解析**的 [`LaunchIdentity`] 的拒绝谓词(spawn 之前、每个拼写上)。
	pub permit: Option<Refusal<'a, LaunchIdentity>>,
	/// 对窗口列表**已报出**的 [`AppRef`] 的拒绝谓词(spawn 之后、整只 AppRef
	/// 含窗口标题上)。与 permit 分开,因为参数类型不同 —— 见
	/// [`crate::launch::run_launch`] 内注释。
	pub refuse_launched: Option<Refusal<'a, AppRef>>,
}

impl<'a> LaunchPermit<'a> {
	/// 两个钩子全空(无策略过问的裸流程,测试与无策略调用方用)。
	pub fn none() -> Self {
		Self::default()
	}
}

/// 单平台桌面自动化 driver 的抽象契约。
///
/// 每个实现必须遵守:
///
/// * **永不 panic / 永不 Err。** 把一切失败 —— 应用缺席、无障碍错误、权限
///   拒绝 —— 折成 `DriverResult { ok: false, text: 理由 }`,理由**不带**
///   `Error: ` 前缀(dispatch 层恰好加一次)。
/// * **请求没点名就不动指针。** 唯一例外是 `moves_pointer()` 为真的请求
///   (global),它必须被显式点名。driver 不得为任何其他方法弯曲光标,也不得
///   把被拒的应用域点击静默升级成动指针的点击。
/// * **`ElementRec.secure` 从 role 与 subrole 双属性置位**(或平台等价物)。
///   密码框报无害 role + secure subrole + 可读值;只查 role 会漏掉每一个。
///   下游全部三重保护(值 redaction、输入拒绝、截图抑制)都挂在这面旗上,
///   置错的 driver 一处失手全线失守。
/// * **`Snapshot.captured_at` 用单调钟**(core::clock),绝不用墙上钟 —— 时钟
///   调整不能攻破 TTL。
/// * **线程安全**(此 trait 要求 Send+Sync;dispatch 与调用方在不同线程)。
pub trait ComputerUseBackend: Send + Sync {
	/// 稳定平台标识(`macos`/`windows`/`linux`/`fake`/`unsupported`)。
	fn platform_id(&self) -> &'static str;

	/// 本 backend 此处能否驱动 computer use,不能则为何。
	fn status(&self) -> BackendStatus;

	/// 给设置界面的**建议性**权限提示 —— 绝不是门。
	///
	/// macOS 把 TCC 授予归因到进程树的 responsible parent,探针可能报
	/// missing 而全保真捕获照样成功。调用方不得据此拒绝动作。
	fn probe_permissions(&self) -> PermissionProbe;

	/// 有在屏窗口的应用,经窗口列表解析。
	fn list_apps(&self) -> DriverResult;

	/// 把 *query*(名字或 bundle id)解析为一只 [`AppRef`]。
	///
	/// 必须从**在屏窗口列表**解析,绝不做进程名搜索:pgrep 式匹配会命中
	/// 短命 helper 进程,其无障碍树是空的。
	fn resolve_app(&self, query: &str) -> DriverResult;

	/// 启动已安装应用 *query* 所指名者,使它**有**一个窗口。
	///
	/// `permit` 是调用方的策略谓词,实现必须把它应用到**已解析**的
	/// [`LaunchIdentity`] 上、在 spawn 之前 —— 用解析产出的每一个标识,而不
	/// 只是显示名。调用方自己做不了:它手里只有原始 query,前缀解析会把它
	/// 变走,且它不携带操作者 deny 规则所写的任何拼写(exe key、bundle id)。
	///
	/// 这里唯一「创建进程」而非观测/驾驶的方法,因此对实现有三条要求:
	///
	/// * **经 OS 自有的目录解析,拒绝路径。** *query* 是名字,绝非文件系统
	///   路径、参数向量或 URL。接受其中任何一个都会把「打开应用」变成「以
	///   攻击者所选输入运行任意程序」。
	/// * **校验目录返回的东西。** 目录可以是 agent 可写的(Windows 实测
	///   HKCU App Paths 与每用户 Start Menu 都是),实现必须给**解析出的**
	///   可执行文件设界,而非信任查找结果。
	/// * **以找到窗口确认,而非 launcher 的退出状态。** 打包应用的 launcher
	///   立即退出并交棒;读 launcher 自身结果会把成功启动报成失败。
	///
	/// 窗口出现后返回 ok=true 与解析出的 AppRef;进程启动但在超时内没显示
	/// 窗口也返回 ok=true(**不带** AppRef)—— 进程确实启动了,报失败会引诱
	/// 模型再启动一份。
	fn launch_app(&self, query: &str, permit: LaunchPermit<'_>) -> DriverResult;

	/// 把 *app* 的聚焦窗口走查成 [`Snapshot`]。
	///
	/// 遵守 *req* 的每一项预算。`req.want_image` 置位时快照**可以**携带编码
	/// JPEG 字节;不能捕获的 driver 返回树本身而非让调用失败。
	fn snapshot(&self, app: &AppRef, req: SnapshotRequest) -> DriverResult;

	/// 点击 *rec*(无障碍按压)或 *req* 的坐标点(鼠标事件)。
	///
	/// *req* 到达时方法**已具体化** —— auto 在 dispatch chokepoint 解析,
	/// driver 不重新决定它,也就不可能意外选中弯曲指针的路径。坐标点击时
	/// `rec` 为 None,元素形态时 `req.point` 为 None;恰其一(上游
	/// `policy::check_click_target` 已验)。
	///
	/// 鼠标事件点击尊重 `req.button` 与 `req.count`,且仅当
	/// `req.moves_pointer()` 为真才弯曲指针。
	fn click(&self, app: &AppRef, rec: Option<&ElementRec>, req: ClickRequest) -> DriverResult;

	/// 在 *app* 内从 *req* 的起点拖到终点。
	///
	/// 构造上只有坐标形态:拖拽的意义**就是**两点间的路径,没有无障碍动作
	/// 能表达它。除非 `req.moves_pointer()` 为真否则应用域;真时上游两道
	/// 许可已经查过。
	fn drag(&self, app: &AppRef, req: DragRequest) -> DriverResult;

	/// 把 *text* 敲进 *rec*,rec 为 None 时敲进聚焦元素。
	fn type_text(&self, app: &AppRef, rec: Option<&ElementRec>, text: &str) -> DriverResult;

	/// 向 *app* 送一枚按键 spec(`"cmd+shift+a"`)。
	fn press_key(&self, app: &AppRef, rec: Option<&ElementRec>, key: &str) -> DriverResult;

	/// 直接设置 *rec* 的值(不经按键)。
	fn set_value(&self, app: &AppRef, rec: &ElementRec, value: &str) -> DriverResult;

	/// 让 *rec* 按 *direction* 滚动 *pages* 页。
	fn scroll(&self, app: &AppRef, rec: &ElementRec, direction: ScrollDirection, pages: f64) -> DriverResult;

	/// 在 *rec* 上执行具名无障碍动作。
	fn perform_action(&self, app: &AppRef, rec: &ElementRec, action: &str) -> DriverResult;

	/// 释放资源。可重复调用。
	fn close(&self);
}
