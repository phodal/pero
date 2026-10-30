//! 应用发现与 **OS 解析出的**身份 —— 只从窗口列表来。REF `apps_macos.py`
//! 的移植。
//!
//! 两份工作,第二份是安全承重的:
//!
//! 1. [`list_apps`]/[`resolve_app`] 回答「哪些应用有可见窗口、模型点名的
//!    那个 pid 是谁」;
//! 2. [`resolve_identity`] 产出策略(`policy::check_app`)所过问的 **OS 解析
//!    出的** bundle id 与显示名。策略永不查调用方给的 `app` 字符串:若查
//!    它,allow 了的 `com.apple.finder` 可以被一句 "finder" 满足,而自动化
//!    实际驾驶的是别的什么。这里的一切回答「我们真正碰了什么」,不是
//!    「我们被要求碰什么」。
//!
//! **绝不做进程名搜索。** 不 pgrep、不 ps、不做任何名字扫描 —— 原因是一次
//! 复现过的失败而非风格偏好:`pgrep -n "Google Chrome"` 答的是 47492,一
//! 个短命 helper,对一切无障碍读答 `kAXErrorCannotComplete` 后随即退出,
//! 真浏览器在 637。Slack 的 helper 1614 同样遮蔽了真的 942。拥有可见
//! layer-0 窗口的 pid 才有已填充的无障碍树,所以 CoreGraphics 窗口列表是
//! 唯一真相源。
//!
//! **bundle id 解析是一条与直觉相反的活体发现。** 两条你会先想到的路都不
//! 通:
//!
//! * 窗口列表字典**根本没有** bundle id 键(实测:字典恰为
//!   `{Alpha, Bounds, IsOnscreen, Layer, MemoryUsage, Name, Number,
//!   OwnerName, OwnerPID, SharingState, StoreType}`);
//! * application 元素上的 `AXBundleIdentifier` 在本 macOS 上对**每个**应用
//!   都答 `kAXErrorAttributeUnsupported`(-25205)—— Chrome、Slack、Notes、
//!   Obsidian、Outlook、系统设置,全部。不是 Electron 怪癖也不是权限假象。
//!
//! 所以 bundle id 来自 `proc_pidpath` + 最近外层 `.app` 的 `Info.plist` ——
//! 一次系统调用加一次小的 plist 读,实测每 pid 低于 1ms。无 bundle 的裸二
//! 进制产出空 identity,进程名扛起身份;策略把全未解析的 identity 当拒绝
//! 对待 —— 对一个叫不出名字的目标,那是正确的姿势。

use std::collections::HashMap;
use std::io::Read;
use std::os::unix::fs::OpenOptionsExt as _;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use point_computer_core::policy;
use point_computer_core::types::{AppRef, ComputerUseError, ERR_APP_NOT_FOUND, Frame, TOOL_LIST_APPS, fill};

use crate::ffi::{self, CfRef};

/// Info.plist 的键,显示名按此优先序取。`CFBundleName` 在
/// `CFBundleDisplayName` **之前**:前者是用户与策略模式真正敲的短规范名
/// ("Chrome"),后者常是营销串。
const PLIST_BUNDLE_ID_KEY: &str = "CFBundleIdentifier";
const PLIST_BUNDLE_NAME_KEYS: &[&str] = &["CFBundleName", "CFBundleDisplayName"];
const BUNDLE_SUFFIX: &str = ".app";

/// 愿意解析的最大 Info.plist。bundle 的 Info.plist 只有几 KB;远大于此的
/// 要么不是我们以为的东西,要么是经手工 bundle 的资源耗尽尝试,而身份
/// 不值一次无界读。多读一字节以区分「恰好等于上限」与「超过上限」——
/// 大小检查必须落在**实际读到的字节**上,而非对一个可能已不是同一文件的
/// path 做 stat。
const MAX_INFO_PLIST_BYTES: usize = 512 * 1024;

/// 身份缓存 TTL(秒)。进程活着时 bundle 身份不会变,缓存把每次动作的
/// plist 读变成一次哈希命中;TTL 界住 pid 复用:换了个程序的 pid 不得继承
/// 前任的身份,而身份正是策略过问的东西。60s 远短于 macOS 上任何现实的
/// 复用窗口,又盖住整个回合。
const IDENTITY_CACHE_TTL_SECS: f64 = 60.0;
const MAX_CACHED_IDENTITIES: usize = 64;

/// darwin `O_NOFOLLOW`(`sys/fcntl.h` = `0x00000100`;拒绝对最终组件的符号
/// 链接,见 [`read_bundle_plist`] 的 TOCTOU 论证)。不是 Linux 的
/// `0x20000`,也不是曾经误抄的 `0x80000`(那会让 extra flag 被忽略,
/// NOFOLLOW 形同虚设)。
const O_NOFOLLOW: i32 = 0x0000_0100;

/// 一个进程的 OS 解析身份。
///
/// `bundle_id` 是稳定的 OS 身份,`display_name` 是给人看的。
/// `policy::check_app` 对二者**分别**匹配(绝不拼接后对同一模式),因为显
/// 示名是攻击者可选的,不得让它满足 bundle id 规则。`executable` 留作诊
/// 断:两个标识都空时,它是唯一能告诉操作者 sidecar 当时在看什么的东西。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AppIdentity {
	pub bundle_id: String,
	pub display_name: String,
	pub executable: String,
}

impl AppIdentity {
	/// 至少一个可治理的标识已知。deny 模式的 `apps` 规则下,空项不匹配任
	/// 何模式即**放行** —— 策略无法约束一个叫不出名字的目标,所以门拒绝
	/// 全未解析的 identity。
	pub fn resolved(&self) -> bool {
		!self.bundle_id.is_empty() || !self.display_name.is_empty()
	}
}

/// 身份缓存(TTL 见 [`IDENTITY_CACHE_TTL_SECS`])。懒初始化避免给不触碰
/// 身份的进程(单测、doctor)付一次分配。
static IDENTITY_CACHE: Mutex<Option<HashMap<i32, (Instant, AppIdentity)>>> = Mutex::new(None);

/// 有在屏 layer-0 窗口的应用,每应用(而非每窗口)一条 [`AppRef`],按 pid
/// 键控:六个窗口的应用是一条。
///
/// **保留的窗口是带标题的最前一个**,不是第一个 layer-0 条目。窗口列表的
/// 顺序是 CoreGraphics 的前后 z 序,「第一个」通常没错 —— 但在 Notes 上实
/// 测,最前的 layer-0 窗口是一个无标题 `AXDialog`(3 个无障碍节点),挡在
/// 真正的 103 节点文档窗之前。照单全收会让 Notes 的 get_state 返回一棵近
/// 乎空的树而应用明明有内容,结果里没有任何东西解释为什么。应用全无带标
/// 题窗口时仍保留无标题者(闪屏、裸警告 —— 应用真的在展示它)。
///
/// 非零 layer 被丢弃:菜单栏、Dock、tooltip、通知横幅与窗口阴影都在那里,
/// 不是可寻址的应用窗口,其 pid 常是树为空的系统 agent。
pub fn list_apps() -> Vec<AppRef> {
	let mut seen: HashMap<i32, AppRef> = HashMap::new();
	for info in ffi::window_list() {
		if info.layer != ffi::CG_WINDOW_LAYER_NORMAL {
			continue;
		}
		if info.pid <= 0 || info.owner_name.is_empty() {
			continue;
		}
		if let Some(existing) = seen.get(&info.pid)
			&& policy::title_is_denied(&existing.window_title)
		{
			// 已持有标题命中拒绝名单的窗口:永不替换。输入按 PID 投递
			//(CGEventPostToPid),此进程的**任何**窗口是自己的面板即整个
			// 进程必须拒绝;保留无害的首窗会让第二个承载着 Point 面板的
			// Chrome 窗口整个从标题规则下溜过去。
			continue;
		}
		if let Some(existing) = seen.get(&info.pid)
			&& !policy::title_is_denied(&info.title)
			&& (!existing.window_title.is_empty() || info.title.is_empty())
		{
			// 已有此应用的窗口,且要么它带标题(够好),要么当前候选并非
			// 改进。
			continue;
		}
		let identity = resolve_identity(info.pid);
		seen.insert(
			info.pid,
			AppRef {
				// 窗口列表的 owner name 是进程名;bundle 的 CFBundleName 常
				// 更漂亮("Chrome" vs "Google Chrome"),但进程名是操作者在
				// 活动监视器里看到的、也是拒绝名单 name 子串匹配的,所以
				// `name` 由它说了算。
				name: info.owner_name.clone(),
				pid: info.pid,
				bundle_id: identity.bundle_id,
				window_id: info.window_id,
				window_title: info.title,
			},
		);
	}
	seen.into_values().collect()
}

/// 把 *query*(进程名、bundle id 或片段)解析为一个应用;无匹配时
/// [`ComputerUseError`],点名 `computer_list_apps` 让模型的下一步显而易见。
///
/// 匹配序,最具体在前 —— 精确的查询永不被松散的捕获:
///
/// 1. 精确 bundle id;
/// 2. 精确进程名(大小写不敏感);
/// 3. bundle id 子串;
/// 4. 进程名子串。
///
/// 每层内部最前窗口胜出(窗口列表序)。层次的必要性由真实歧义证明:查询
/// `"notes"` 应到达 `com.apple.Notes`,而不是某个窗口标题碰巧含这个词的
/// 应用。
pub fn resolve_app(query: &str) -> Result<AppRef, ComputerUseError> {
	let needle = query.trim().to_lowercase();
	if needle.is_empty() {
		return Err(app_not_found(query));
	}
	let apps = list_apps();
	resolve_from(&apps, &needle).ok_or_else(|| app_not_found(query))
}

/// [`resolve_app`] 的纯核心(判定的阶梯在这里可离线单测)。
fn resolve_from(apps: &[AppRef], needle: &str) -> Option<AppRef> {
	let exact_bundle = apps.iter().find(|app| !app.bundle_id.is_empty() && app.bundle_id.to_lowercase() == needle);
	if exact_bundle.is_some() {
		return exact_bundle.cloned();
	}
	let exact_name = apps.iter().find(|app| !app.name.is_empty() && app.name.to_lowercase() == needle);
	if exact_name.is_some() {
		return exact_name.cloned();
	}
	let sub_bundle = apps.iter().find(|app| !app.bundle_id.is_empty() && app.bundle_id.to_lowercase().contains(needle));
	if sub_bundle.is_some() {
		return sub_bundle.cloned();
	}
	apps.iter().find(|app| !app.name.is_empty() && app.name.to_lowercase().contains(needle)).cloned()
}

fn app_not_found(query: &str) -> ComputerUseError {
	ComputerUseError::Denied(fill(ERR_APP_NOT_FOUND, &[("{query}", query), ("{tool}", TOOL_LIST_APPS)]))
}

/// *pid* 的 OS 解析身份。永不失败。
///
/// 这是策略所吃的函数,所以它只回答「按 OS 的说法这是什么进程」,别的什
/// 么都不是 —— 没有任何调用方给的字符串能到达这里。死 pid、沙盒拒绝、
/// FFI 问题都产出全空的 identity:那是一个有效答案,门(以拒绝)处理它。
/// 故意不用猜测去补:发明一个身份会造出一个操作者从未批准的可治理名字。
pub fn resolve_identity(pid: i32) -> AppIdentity {
	if pid <= 0 {
		return AppIdentity::default();
	}
	if let Some(hit) = cached_identity(pid) {
		return hit;
	}
	let identity = resolve_identity_uncached(pid);
	store_identity(pid, identity.clone());
	identity
}

/// 清空身份缓存(driver close、测试)。
pub fn reset_identity_cache() {
	if let Ok(mut cache) = IDENTITY_CACHE.lock() {
		cache.take();
	}
}

fn cached_identity(pid: i32) -> Option<AppIdentity> {
	let cache = IDENTITY_CACHE.lock().ok()?;
	let cache = cache.as_ref()?;
	let (stamp, identity) = cache.get(&pid)?;
	(stamp.elapsed().as_secs_f64() <= IDENTITY_CACHE_TTL_SECS).then(|| identity.clone())
}

fn store_identity(pid: i32, identity: AppIdentity) {
	let Ok(mut guard) = IDENTITY_CACHE.lock() else { return };
	let cache = guard.get_or_insert_with(HashMap::new);
	// 顺手清过期,再封顶。每回合只有几个应用在场上;上限的存在只是让长命
	// 进程不会积累它见过的每个 pid 一条。
	cache.retain(|_, (stamp, _)| stamp.elapsed().as_secs_f64() <= IDENTITY_CACHE_TTL_SECS);
	while cache.len() >= MAX_CACHED_IDENTITIES {
		// 逐出最陈旧的一条(而非任一条):被逐的应是最不可能再被命中的。
		let stalest = cache.iter().min_by_key(|(_, (stamp, _))| *stamp).map(|(pid, _)| *pid);
		match stalest {
			Some(stalest) => {
				cache.remove(&stalest);
			}
			None => break,
		}
	}
	cache.insert(pid, (Instant::now(), identity));
}

/// 已解析 [`AppRef`] 的身份。
///
/// 从 pid 重新解析而非信任 ref 自带字段:ref 可能来自缓存快照,而门必须吃
/// 一次新鲜观测的身份。display_name 为空时回退 ref 的进程名 —— 无 bundle
/// 的应用仍可按名治理。
pub fn identity_for(app: &AppRef) -> AppIdentity {
	let identity = resolve_identity(app.pid);
	if !identity.display_name.is_empty() || app.name.is_empty() {
		return identity;
	}
	AppIdentity { bundle_id: identity.bundle_id, display_name: app.name.clone(), executable: identity.executable }
}

fn resolve_identity_uncached(pid: i32) -> AppIdentity {
	let executable = ffi::pid_path(pid);
	if executable.is_empty() {
		return AppIdentity::default();
	}
	let (bundle_id, display_name) = bundle_metadata(&executable);
	AppIdentity { bundle_id, display_name, executable }
}

/// 从*executable* 的外层 bundle 取 `(bundle_id, display_name)`。
///
/// 从可执行路径**向上**走,找最近的 `.app` 目录 —— 二进制永远住在
/// `Foo.app/Contents/MacOS/Foo`,helper 可以嵌得更深。裸二进制 → 空对。
fn bundle_metadata(executable: &str) -> (String, String) {
	match enclosing_bundle(Path::new(executable)) {
		Some(bundle) => bundle_identity_at(&bundle),
		None => (String::new(), String::new()),
	}
}

/// 路径分量是否是应用 bundle 目录。普通安装是 `Foo.app`;Chrome 等在跑时
/// 会把二进制放进 `Foo.app.bundle` 的 code_sign_clone,只认 `.app` 后缀会
/// 把活窗口判成 unresolved-id。
fn is_bundle_dir(path: &Path) -> bool {
	let name = path.file_name().and_then(|value| value.to_str()).unwrap_or("");
	name.ends_with(BUNDLE_SUFFIX) || name.contains(".app.")
}

/// 从可执行路径向上找最近的 `.app` / `.app.bundle` 祖先目录。以路径自身
/// 深度为界:`dirname` 不再变化时终止,畸形或相对路径转不起来。
fn enclosing_bundle(executable: &Path) -> Option<PathBuf> {
	let mut current = executable.to_path_buf();
	loop {
		let parent = current.parent()?.to_path_buf();
		if parent == current {
			return None;
		}
		current = parent;
		if is_bundle_dir(&current) {
			return Some(current);
		}
	}
}

/// *bundle* 自家 `Info.plist` 里的 `(bundle_id, display_name)`。
///
/// bundle 路径入口(可执行路径入口是 [`bundle_metadata`])。共享给**即将启
/// 动**的应用的身份读取 —— 未来的 launch(M6)持有 bundle 而无 pid,它读
/// 身份必须与运行中的应用**同一条路**,含硬化、定容、O_NOFOLLOW 的读。
/// spawn 前的策略检查只有在看见与 spawn 后检查相同的字符串时才有意义,
/// 两个读者是两次意见相左的机会。不可读或非 bundle → 空对;永不失败。
pub fn bundle_identity_at(bundle: &Path) -> (String, String) {
	let info = read_bundle_plist(bundle);
	let Some(info) = info else { return (String::new(), String::new()) };
	let bundle_id = ffi::dict_str(info.as_ptr(), PLIST_BUNDLE_ID_KEY).trim().to_string();
	let mut display = String::new();
	for key in PLIST_BUNDLE_NAME_KEYS {
		let value = ffi::dict_str(info.as_ptr(), key).trim().to_string();
		if !value.is_empty() {
			display = value;
			break;
		}
	}
	(bundle_id, display)
}

/// *bundle* 的 `Contents/Info.plist` 解析出的 CFDictionary;读不了 → `None`。
/// 永不 panic。
///
/// 定容且全防御。这里读的路径派生自**代理选择去瞄准的进程**,所以必须容忍
/// 一个手工 bundle 携带畸形、巨大或敌意的 plist —— 而失败的后果只是「身份
/// 未知」,门已经以拒绝处理它。
///
/// 三条防线,一条都不能少。路径虽来自 OS(目标进程的可执行文件,向上走到
/// `.app` 祖先)而非代理,但代理**确实**选择了瞄准哪个进程 —— 因此可以布
/// 置那个 bundle。所以:
///
/// 1. `canonicalize` 后对**解析后的**目标做敏感路径检查 —— 布置在受保护目
///    录下的 bundle(`~/.ssh/evil.app`)不得被读;
/// 2. `O_NOFOLLOW` 打开 canonical 路径 —— 「先检查再另开一次」是
///    check-then-open:检查与打开之间换入的末级符号链接会在一条从未碰过
///    防线的路径上读出受保护文件的字节。NOFOLLOW 关掉这个窗口;
/// 3. 读 `MAX + 1` 字节并在**读到的字节**上检查上限 —— stat 一个可能已不是
///    同一文件的 path 是同一个竞态再往前一步。
///
/// 防线关乎**被打开的文件**,不关乎谁算出的字符串;为它付的代价只是「放
/// 错地方的应用身份未知」,门已以拒绝处理。
pub fn read_bundle_plist(bundle: &Path) -> Option<CfRef> {
	let path = bundle.join("Contents").join("Info.plist");
	let canonical = std::fs::canonicalize(&path).ok()?;
	if is_sensitive_path(&canonical) {
		return None;
	}
	// SAFETY:无 unsafe —— OpenOptionsExt 的 custom_flags 携带 darwin 常量。
	let file = std::fs::File::options().read(true).custom_flags(O_NOFOLLOW).open(&canonical).ok()?;
	// 上限 + 1:多读的一字节区分「恰好等于上限」与「超过上限」。
	let mut reader = file.take((MAX_INFO_PLIST_BYTES + 1) as u64);
	let mut bytes = Vec::new();
	reader.read_to_end(&mut bytes).ok()?;
	if bytes.len() > MAX_INFO_PLIST_BYTES {
		return None;
	}
	ffi::parse_plist_dict(&bytes)
}

/// 敏感路径防线:身份读不得触及的地方。REF 经仓库级 `hooks` 走同一条规
/// 则;Point 侧这份最小副本只服务这一个读者 —— 三个键(.ssh/.gnupg/
/// .config)与隐藏目录语义,刻意从紧:多放一个目录只丢一个身份,少放一个
/// 是把 `~/.ssh/evil.app/Contents/Info.plist` 的字节读进我们的进程。
fn is_sensitive_path(path: &Path) -> bool {
	let Some(home) = std::env::var_os("HOME") else { return false };
	let home = Path::new(&home);
	let Ok(relative) = path.strip_prefix(home) else { return false };
	let mut parts = relative.components();
	match parts.next() {
		None => false,
		Some(first) => {
			let name = first.as_os_str().to_string_lossy();
			if matches!(name.as_ref(), ".ssh" | ".gnupg" | ".config" | ".aws" | ".kube") {
				return true;
			}
			// 家目录下的任何隐藏目录从紧对待:应用不装在那里。
			name.starts_with('.')
		}
	}
}

/// *window_id* 的屏幕矩形,窗口已消失或不属 *pid* 时 `None`(sky_click 的
/// 窗口本地坐标换算用,M6 接上)。
///
/// *pid* 被核验而非信任:窗口 id 会被回收,陈旧 id 可以指到另一个应用的
/// 窗口,而 sky_click 的全部意义是点击操作者看不见的东西(那里一次瞄准
/// 错误是不可见的)。任何错误都 `None`,调用方拒绝而非猜一个矩形。
pub fn window_bounds(window_id: u32, pid: i32) -> Option<Frame> {
	for info in ffi::window_list() {
		if info.window_id != window_id {
			continue;
		}
		let (x, y, w, h) = info.bounds?;
		return (info.pid == pid).then_some(Frame { x, y, w, h });
	}
	None
}

/// *pid* 是否仍有可读在屏窗口,以及 `(x, y)` 是否落在其中任意一个的矩形内。
///
/// `app_post` 拖拽的端点诚实性谓词:事件按 pid 投递,同一进程的第二扇窗口
/// / sheet / popover 是合法落点,z 序遮挡也不该误拒(与 [`pid_owns_point`]
/// 相反)。`None` = 该 pid 已无窗口;`Some(false)` = 有窗口但点在全部矩形外。
pub fn pid_window_contains(pid: i32, x: f64, y: f64) -> Option<bool> {
	pid_window_contains_in(&ffi::window_list(), pid, x, y)
}

fn pid_window_contains_in(windows: &[ffi::WindowInfo], pid: i32, x: f64, y: f64) -> Option<bool> {
	let mut saw = false;
	for info in windows {
		if info.pid != pid {
			continue;
		}
		let Some((left, top, width, height)) = info.bounds else {
			continue;
		};
		saw = true;
		if left <= x && x < left + width && top <= y && y < top + height {
			return Some(true);
		}
	}
	saw.then_some(false)
}

/// *pid* 是否拥有包含 `(x, y)` 的最上层在屏窗口。
///
/// 真指针点击路径的**收容检查**,它必须存在的原因:`CGWarpMouseCoordinates` +
/// 全局 `CGEventPost` 投递给那个像素下的任何东西,调用里没有 pid。其余每条
/// 输入路径都是应用域的(`CGEventPostToPid`),解析出的应用身份**就是**授权
/// 边界 —— 策略对**那个**应用跑过了拒绝名单。没有这道检查,点名一个被允许
/// 的应用、把坐标传到一个被拒的(自己的面板)上面会一路通过:策略在应用 A
/// 上通过,点击落在应用 B 上。
///
/// 最上层而非仅「在内」:窗口列表是前到后 z 序,**第一个**包含该点的
/// layer-0 窗口才是真正收到点击的那个。测「pid 的任何窗口包含该点」会错误
/// 放行一次视觉上落在被拒应用上的点击。
///
/// 点不属于任何人、所属窗口无可读 bounds、任何错误 → `false`:拒绝一次合
/// 法点击花模型一句清楚的拒绝,放行一次瞄准错误的点击是操作者从未授权的
/// 应用里一次不可逆的动作。
pub fn pid_owns_point(pid: i32, x: f64, y: f64) -> bool {
	owns_point(&ffi::window_list(), pid, x, y)
}

/// [`pid_owns_point`] 的纯核心(z 序判定可离线单测)。
///
/// 一个刻意的非对称:这里的第一个包含窗口**不跳过**任何 layer —— 与
/// `list_apps` 相反。本函数回答「这个像素上的一次物理点击会落到谁头上」,
/// 压在获准应用之上的通知横幅、菜单栏扩展或打开的菜单**真的**会吃掉那次
/// 点击;跳过那些 layer 是让下面那个应用替操作者自己的覆盖层授权 —— 恰是
/// 本函数要提供的收容的反面。`list_apps` 跳过它们出于无关的理由:它们不是
/// 可寻址目标。
fn owns_point(windows: &[ffi::WindowInfo], pid: i32, x: f64, y: f64) -> bool {
	for info in windows {
		let Some((left, top, width, height)) = info.bounds else {
			// 放置不了这个窗口,也就证明不了它**不**盖住这个点。拒绝,
			// 而非看穿它。
			return false;
		};
		if !(left <= x && x < left + width && top <= y && y < top + height) {
			continue;
		}
		return info.pid == pid && info.layer == ffi::CG_WINDOW_LAYER_NORMAL;
	}
	false
}

// ── 纯测(判定核心离线钉死;窗口服务器往返在 #[ignore] 冒烟里) ──

#[cfg(test)]
mod tests {
	use super::*;
	use crate::ffi::WindowInfo;

	fn window(window_id: u32, pid: i32, title: &str, layer: i64, bounds: Option<(f64, f64, f64, f64)>) -> WindowInfo {
		WindowInfo { window_id, pid, owner_name: format!("app{pid}"), title: title.to_string(), layer, bounds }
	}

	fn app_ref(name: &str, pid: i32, bundle_id: &str) -> AppRef {
		AppRef { name: name.to_string(), pid, bundle_id: bundle_id.to_string(), ..Default::default() }
	}

	#[test]
	fn resolve_ladder_is_specific_before_loose() {
		let apps = vec![app_ref("Notes", 10, "com.apple.Notes"), app_ref("Google Chrome", 20, "com.google.Chrome")];
		// 精确 bundle id。
		let hit = resolve_from(&apps, "com.google.chrome").unwrap();
		assert_eq!(hit.pid, 20);
		// 精确进程名(大小写不敏感)。
		let hit = resolve_from(&apps, "notes").unwrap();
		assert_eq!(hit.pid, 10);
		// bundle 子串:"chrome" 命中 bundle 而非标题里碰巧带词的别人。
		let hit = resolve_from(&apps, "google.chrome").unwrap();
		assert_eq!(hit.pid, 20);
		// 进程名子串。
		let hit = resolve_from(&apps, "chrome").unwrap();
		assert_eq!(hit.pid, 20);
		assert!(resolve_from(&apps, "nothing").is_none());
	}

	#[test]
	fn identity_is_unresolved_for_the_unbundled() {
		assert!(!AppIdentity::default().resolved());
		assert!(AppIdentity { bundle_id: "x".into(), ..Default::default() }.resolved());
		assert!(AppIdentity { display_name: "x".into(), ..Default::default() }.resolved());
	}

	#[test]
	fn enclosing_bundle_finds_nearest_app_ancestor() {
		assert_eq!(
			enclosing_bundle(Path::new("/Applications/Calculator.app/Contents/MacOS/Calculator")),
			Some(PathBuf::from("/Applications/Calculator.app"))
		);
		assert_eq!(
			enclosing_bundle(Path::new(
				"/private/var/folders/x/X/com.google.Chrome.code_sign_clone/code_sign_clone.abc/Google Chrome.app.bundle/Contents/MacOS/Google Chrome"
			)),
			Some(PathBuf::from(
				"/private/var/folders/x/X/com.google.Chrome.code_sign_clone/code_sign_clone.abc/Google Chrome.app.bundle"
			))
		);
		// 嵌套 helper:最近的 .app 胜出。
		assert_eq!(
			enclosing_bundle(Path::new(
				"/Applications/Foo.app/Contents/Frameworks/Bar.framework/Versions/A/Helpers/Baz.app/Contents/MacOS/Baz"
			)),
			Some(PathBuf::from("/Applications/Foo.app/Contents/Frameworks/Bar.framework/Versions/A/Helpers/Baz.app"))
		);
		// 裸二进制:无 bundle。
		assert_eq!(enclosing_bundle(Path::new("/usr/local/bin/thing")), None);
	}

	#[test]
	fn bundle_identity_reads_a_real_plist() {
		// 真 CoreFoundation 解析(XML plist 写进临时 bundle):CFBundleName
		// 优先于 CFBundleDisplayName。
		let dir = std::env::temp_dir().join(format!("point-cu-apps-{}", std::process::id()));
		let bundle = dir.join("Fixture.app");
		let contents = bundle.join("Contents");
		std::fs::create_dir_all(&contents).unwrap();
		std::fs::write(
			contents.join("Info.plist"),
			r#"<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
	<key>CFBundleIdentifier</key><string>dev.point.fixture</string>
	<key>CFBundleName</key><string>Fixture</string>
	<key>CFBundleDisplayName</key><string>Fixture Deluxe Marketing Edition</string>
</dict></plist>"#,
		)
		.unwrap();
		let (bundle_id, display) = bundle_identity_at(&bundle);
		assert_eq!(bundle_id, "dev.point.fixture");
		assert_eq!(display, "Fixture", "CFBundleName wins over the marketing string");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn nofollow_refuses_a_symlink_plist() {
		let dir = std::env::temp_dir().join(format!("point-cu-nofollow-{}", std::process::id()));
		let bundle = dir.join("Link.app");
		let contents = bundle.join("Contents");
		std::fs::create_dir_all(&contents).unwrap();
		let target = dir.join("real.plist");
		std::fs::write(&target, b"not-a-plist").unwrap();
		std::os::unix::fs::symlink(&target, contents.join("Info.plist")).unwrap();
		assert!(read_bundle_plist(&bundle).is_none(), "O_NOFOLLOW must not follow a swapped plist");
		let _ = std::fs::remove_dir_all(&dir);
	}

	#[test]
	fn chrome_bundle_identity_if_installed() {
		let bundle = Path::new("/Applications/Google Chrome.app");
		if !bundle.is_dir() {
			return;
		}
		let (id, name) = bundle_identity_at(bundle);
		assert_eq!(
			id,
			"com.google.Chrome",
			"plist id={id:?} name={name:?} path readable={}",
			bundle.join("Contents/Info.plist").is_file()
		);
		if let Some(info) =
			crate::ffi::window_list().into_iter().find(|window| window.owner_name.contains("Google Chrome"))
		{
			reset_identity_cache();
			let identity = resolve_identity(info.pid);
			assert_eq!(
				identity.bundle_id,
				"com.google.Chrome",
				"pid {} path={:?}",
				info.pid,
				crate::ffi::pid_path(info.pid)
			);
		}
	}

	#[test]
	fn sensitive_paths_are_refused_and_normal_bundles_read() {
		let home = std::env::var("HOME").unwrap();
		assert!(is_sensitive_path(Path::new(&home).join(".ssh/evil.app/Contents/Info.plist").as_path()));
		assert!(is_sensitive_path(Path::new(&home).join(".config/evil.app/Contents/Info.plist").as_path()));
		assert!(!is_sensitive_path(Path::new("/Applications/Calculator.app/Contents/Info.plist")));
		assert!(!is_sensitive_path(Path::new(&home).join("Applications/Fixture.app").as_path()));
		// 非存在路径 → None(canonicalize 失败先于一切)。
		assert!(read_bundle_plist(Path::new("/nonexistent/Foo.app")).is_none());
	}

	#[test]
	fn owns_point_first_container_in_z_order_wins() {
		let windows = vec![
			window(1, 100, "allowed", 0, Some((0.0, 0.0, 500.0, 500.0))),
			window(2, 200, "denied-underneath", 0, Some((0.0, 0.0, 500.0, 500.0))),
		];
		// z 序第一个包含窗口是 pid 100。
		assert!(owns_point(&windows, 100, 250.0, 250.0));
		assert!(!owns_point(&windows, 200, 250.0, 250.0));
		// 无 bounds 的窗口挡在前面:证明不了不含,拒绝。
		let opaque =
			vec![window(3, 300, "mystery", 0, None), window(1, 100, "allowed", 0, Some((0.0, 0.0, 500.0, 500.0)))];
		assert!(!owns_point(&opaque, 100, 10.0, 10.0));
		// 非 normal layer 的包含窗口**不**跳过:菜单开着时点击属于菜单,
		// 不属于其下的获准应用。
		let with_menu = vec![
			window(4, 300, "open menu", 3, Some((0.0, 0.0, 500.0, 500.0))),
			window(1, 100, "allowed", 0, Some((0.0, 0.0, 500.0, 500.0))),
		];
		assert!(!owns_point(&with_menu, 100, 10.0, 10.0));
		// 半开区间:右/下边界不属于窗口。
		assert!(!owns_point(&windows, 100, 500.0, 250.0));
	}

	#[test]
	fn pid_window_contains_any_window_of_the_pid() {
		let windows = vec![
			window(1, 100, "main", 0, Some((0.0, 0.0, 200.0, 200.0))),
			window(2, 100, "sheet", 1, Some((300.0, 300.0, 50.0, 50.0))),
			window(3, 200, "other", 0, Some((0.0, 0.0, 500.0, 500.0))),
		];
		assert_eq!(pid_window_contains_in(&windows, 100, 10.0, 10.0), Some(true));
		assert_eq!(pid_window_contains_in(&windows, 100, 320.0, 320.0), Some(true), "second window of same pid");
		assert_eq!(pid_window_contains_in(&windows, 100, 250.0, 250.0), Some(false), "gap between own windows");
		assert_eq!(pid_window_contains_in(&windows, 999, 10.0, 10.0), None, "pid with no windows");
		assert_eq!(pid_window_contains_in(&windows, 100, 200.0, 10.0), Some(false), "right edge exclusive");
	}

	/// 冒烟:真实窗口列表解析(需要桌面会话;授权相关全部 fail-soft)。
	#[test]
	#[ignore = "needs a desktop window server session"]
	fn list_apps_smoke() {
		reset_identity_cache();
		let apps = list_apps();
		assert!(!apps.is_empty(), "an interactive session has layer-0 windows");
		assert!(apps.iter().all(|app| app.pid > 0));
		assert!(apps.iter().all(|app| !app.name.is_empty()));
	}
}
