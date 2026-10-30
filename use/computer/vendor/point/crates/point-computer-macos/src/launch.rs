//! macOS 应用启动:标准根下的 app-bundle 目录。REF `launch_macos.py` 的
//! 移植,作为 backend `run_launch` 的平台注入。
//!
//! 结构上比 Windows 侧简单,一个原因:**macOS 有真目录**。应用是少数几
//! 个惯用目录里的 `.app` bundle,目录就是目录列表,不是用户 hive 可以重
//! 定向的名字→可执行文件注册表;这里没有 `HKCU\…\App Paths` 的等价物,
//! 也不解析 `PATH`。
//!
//! launcher 是 `/usr/bin/open -a <bundle 路径>`,按绝对路径钉死,交给它
//! 的是**本模块验证过的路径**,不是名字、不是调用方给的任何东西。路径之
//! 所以要紧:`open -a` 收名字会要 LaunchServices 从它自己的数据库再解析
//! 一次,那个数据库索引了本模块刻意排除的 bundle —— 被检查的 bundle 与
//! 跑起来的 bundle 就可以不是同一个。两个推论:
//!
//! * `open -a` 天然幂等 —— 第二次调用激活运行中的那份而非再起一份 ——
//!   所以这里的「已运行拒绝」是为了告诉模型一件有用的事,不是为了防重
//!   复进程;
//! * `-a` 只收应用,永不收文档。文档形态(`open <file>`)刻意不可达:它
//!   会让这个动词把攻击者选的输入递给声称处理该文件类型的任何应用 ——
//!   那是「打开画图应用」之外的另一种能力。
//!
//! **解析出的 bundle 是被验证的,不只是被找到的**(backend trait 对每个
//! 实现的要求)。两个条件:
//!
//! * bundle 必须位于 [`APP_ROOTS`] 之一之下,而 `~/Applications` 刻意
//!   **不在**其中 —— 它与 agent 同用户可写,收下它等于给「种一个
//!   `~/Applications/Anything.app` 然后启动它」开门;
//! * 对**非目录根**再跑 [`writable_component`]。目录根本身以路径信任:
//!   `open -a` 收验证过的绝对路径,admin 可写的 `/Applications` 不再株连
//!   里面每一个第三方 bundle。
//!
//! **与 REF 的有意偏离(ADR-0065)。** REF 对 parent 目录做 create-probe,
//! 标准 macOS 上 `/Applications` 是 `root:admin drwxrwxr-x`,admin 组成员
//! 拖拽安装不要密码,于是 **`/Applications` 下每个第三方 bundle 都被拒**,
//! 拒绝文案还说「搬到 /Applications」—— 它们已经在那儿。本移植以
//! [`APP_ROOTS`] 为安装位置的信任边界:`open -a` 收的是验证过的绝对路径,
//! 旁边再丢一个同名 bundle 也启动不了被检查的那一个;`~/Applications`
//! 仍不在目录里。可写性探针留给**非目录根**(测试夹具、将来的额外根)。

use std::fs::OpenOptions;
use std::io::ErrorKind;
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};

use point_computer_core::types::{ComputerUseError, LaunchIdentity, MAX_LAUNCH_SUGGESTIONS, fill};

use crate::{apps, ffi};

/// LaunchServices 的正门,按绝对路径钉死 —— 绝不从 `PATH` 解析。
pub const OPEN_BIN: &str = "/usr/bin/open";

/// 可启动应用 bundle 所在的根,最信任的在前(同名冲突时系统安装胜出)。
///
/// **`~/Applications` 刻意缺席。** 它与 agent 同用户可写,收下它让这个动
/// 词变成原生代码执行路径:种 `~/Applications/Anything.app` 然后启动它。
/// 代价是真实的也是对的:只给当前用户装的应用无法启动,拒绝文案点明目录
/// 规则,操作者知道把 bundle 挪去 `/Applications`(或亲手打开),而非留
/// 在那儿猜。失去一个安装位置可恢复;运行 agent 写的任何东西不可恢复。
pub const APP_ROOTS: [&str; 4] =
	["/System/Applications", "/System/Applications/Utilities", "/Applications", "/Applications/Utilities"];

/// bundle 的 `.app` 后缀。
const BUNDLE_SUFFIX: &str = ".app";
/// [`directory_is_writable`] 建了又删的抛弃文件名:特征化,残留可归因;
/// 且只会在启动**即将拒绝**的目录里被创建。
const WRITE_PROBE_NAME: &str = ".point-launch-write-probe";
const CONTENTS_RELDIR: &str = "Contents";
const MACOS_RELDIR: &str = "Contents/MacOS";
const INFO_PLIST_RELPATH: &str = "Contents/Info.plist";

/// 无论住在哪都拒绝作为启动目标的 bundle。
///
/// **不是安全边界。** 它是 no-arguments 规则围不住的唯一形状的窄护栏:
/// 终端从**后续按键**取得指令,启动一个再 `computer_type_text` 进去,就
/// 到达了一个没有任何 `BUILTIN_DENIED_RULES` 的 shell。按去掉后缀的
/// bundle 名、大小写不敏感匹配。
const REFUSED_BUNDLES: [&str; 16] = [
	"terminal",
	"iterm",
	"iterm2",
	"xterm",
	"alacritty",
	"kitty",
	"wezterm",
	"warp",
	"hyper",
	"ghostty",
	"tabby",
	"rio",
	"wave",
	"contour",
	"terminus",
	"cool-retro-term",
];

const ERR_WRITABLE_ROOT: &str = "'{name}' is installed where this user can replace it, so it was not launched: a bundle anyone can overwrite is indistinguishable from one the operator installed. Install it as a root-owned bundle under /Applications or /System/Applications, or open it yourself";
const ERR_SHELL_TARGET: &str = "'{name}' is a terminal, so it is not a launch target: a shell takes its instructions from input rather than from the launch, which is the one thing the no-arguments rule cannot bound. Launch the application you want to use";

/// 一个 `.app` bundle:显示名与找到它的地方。
#[derive(Clone, Debug, PartialEq)]
pub struct InstalledApp {
	pub name: String,
	pub path: PathBuf,
	/// 找到它的根(最信任优先的序由此保留)。
	pub source: PathBuf,
}

/// 惯用根下的全部 `.app` bundle,最信任的根在前。永不失败:不存在或列
/// 不出的根跳过 —— 部分目录是更小的答案,异常才是失败的工具调用。更早
/// (更信任)的根里已见过的名字不被替换。
pub fn installed_apps() -> Vec<InstalledApp> {
	installed_apps_in(APP_ROOTS.map(Path::new).as_slice())
}

/// [`installed_apps`] 的可注入形态(测试用它造离线目录)。
fn installed_apps_in(roots: &[&Path]) -> Vec<InstalledApp> {
	let mut out = Vec::new();
	let mut seen: Vec<String> = Vec::new();
	for root in roots {
		let Ok(entries) = std::fs::read_dir(root) else {
			continue;
		};
		// 名字排序:目录列表顺序是文件系统实现细节,目录的答案必须稳定。
		let mut names: Vec<String> =
			entries.filter_map(|entry| entry.ok()).filter_map(|entry| entry.file_name().into_string().ok()).collect();
		names.sort();
		for entry in names {
			if !entry.ends_with(BUNDLE_SUFFIX) {
				continue;
			}
			let name = entry.strip_suffix(BUNDLE_SUFFIX).unwrap_or(&entry).to_string();
			let folded = name.to_lowercase();
			if seen.contains(&folded) {
				continue;
			}
			let path = root.join(&entry);
			if !path.is_dir() {
				continue;
			}
			seen.push(folded);
			out.push(InstalledApp { name, path, source: (*root).to_path_buf() });
		}
	}
	out
}

/// 本进程能否在 *directory* 里创建文件。
///
/// 真实的 create-and-delete 而非权限计算:在 macOS 上建模 effective
/// access 意味着组成员 + ACL + SIP,一个微妙错误的模型会 fail OPEN。这里
/// fail CLOSED —— 任何不意味着「不」的错误都答「可写」,让调用方拒绝。
fn directory_is_writable(directory: &Path) -> bool {
	let probe = directory.join(WRITE_PROBE_NAME);
	match OpenOptions::new().write(true).create_new(true).open(&probe) {
		Ok(_file) => {
			// 建得出来就是可写;删不掉只留下一个可归因的残留。
			let _ = std::fs::remove_file(&probe);
			true
		}
		Err(err) => match err.kind() {
			// 唯一能读作「否」的三种:权限拒绝、目录不存在、路径不是目
			// 录。其余(包括名字冲突 —— 碰撞推不出「不可写」)fail
			// closed。
			ErrorKind::PermissionDenied | ErrorKind::NotFound | ErrorKind::NotADirectory => false,
			_ => true,
		},
	}
}

/// 本用户能否重写 *path* —— 无论它当前的 mode 说什么。
///
/// 两个条件,任一即够:
///
/// * **属主是本用户。** 决定性的那个,也是 mode 检查不够的原因:属主可
///   以无特权 `chmod`,此刻只读的 mode 是同一用户在下一次检查与 `exec`
///   之间就能撤销的事实(换二进制、`chmod a-w`、启动 —— mode 测试通过,
///   agent 写的代码跑起来)。`chown` 给别人需要特权,所以属主才是持久
///   的问题:*这个文件本来就可能被此用户写过吗,不管它现在怎么说?*
/// * **mode 允许写**,覆盖别人拥有却 group-/world-writable 的文件。
///
/// 读元数据而非真写:这里检查的是启动**即将允许**的 bundle,不能改动正
/// 当应用。检不出的文件算 replaceable —— 验证不了的 bundle 被拒,绝不被
/// 放行。
fn file_is_replaceable(path: &Path) -> bool {
	match std::fs::metadata(path) {
		Ok(metadata) => metadata.uid() == ffi::effective_uid() || ffi::access_w_ok(path),
		Err(_) => true,
	}
}

/// *macos_dir* 下是否有任一文件是本用户可**替换**的。
///
/// create-probe 看不到的另一半:拒绝创建的目录仍装着本用户可重写的文件,
/// 这正是拖拽安装的形状 —— root 拥有的 `Foo.app/…` 里
/// `Contents/MacOS/Foo` 属于拖它进去的用户。
///
/// 检查每个条目而非只查 `CFBundleExecutable` 点名的那一个:那个值住在
/// bundle 里,不能信任它说哪个文件要紧(见 [`writable_component`] 的固
/// 定目录论证);主二进制旁边的 helper 会被它加载,可替换的一个同样是
/// 选择运行代码的途径。
fn any_executable_is_writable(macos_dir: &Path) -> bool {
	let Ok(entries) = std::fs::read_dir(macos_dir) else {
		return true;
	};
	for entry in entries.filter_map(|entry| entry.ok()) {
		let path = entry.path();
		// 嵌套目录在已探针的目录之下,跳过(REF 同);读不出类型算
		// replaceable —— fail closed。
		match std::fs::metadata(&path) {
			Ok(metadata) if metadata.is_dir() => continue,
			Ok(_) => {}
			Err(_) => return true,
		}
		if file_is_replaceable(&path) {
			return true;
		}
	}
	false
}

/// 本用户能否改变 *app* 运行什么 —— 按 CREATE 或按 REPLACE。
///
/// 启动边界。bundle 是普通文件的目录,「app 住在 `/Applications` 下」只
/// 约束谁能**加新** app —— 对谁能重写既有那个里面的 Mach-O 什么都没说。
///
/// **两种权限,两种测试。** 目录可写性管 create/unlink/rename;重写**已
/// 存在**文件的字节只要文件 inode 上的写,目录权限一点不要。于是仅
/// create-probe 对普通拖拽安装与 Homebrew-cask 形状答「不可写」—— root
/// 拥有、拒绝创建的目录,装着安装用户拥有的可执行文件。
///
/// **路径上的每个目录都探针,不止端点**,因为对其中任一写的访问都足以
/// 控制执行什么:
///
/// * bundle 的**父目录** —— 整个 bundle 掉包到真品旁边;
/// * **bundle 目录** —— `Contents` 整体替换;
/// * **`Contents`** —— 端点检查漏掉的那个。它是中间层而非「更深嵌套」,
///   其可写性与两个邻居都无关(父不可写不使子不可写 —— 让根清单不够的
///   同一实测事实)。拥有它就够了:`mv Contents/MacOS Contents/MacOS.bak
///   && mkdir Contents/MacOS` 造出一个 agent 拥有的可执行目录,其余探针
///   全答「不可写」。它还装着 `Info.plist`,同一访问重写
///   `CFBundleIdentifier` 就击穿了 [`target_identity`] 的 spawn 前拒绝;
/// * **`Contents/MacOS`** —— 二进制本体原地换掉。
///
/// 目录是**固定的,永不从 bundle 读**。问 bundle 自己的 `Info.plist` 可
/// 执行文件在哪是显然的改进,却是错的那个:`CFBundleExecutable` 位于正
/// 被质疑可信度的目录里,绝对或穿越的值会把探针**指到 bundle 外**(`/
/// tmp/x` 探 `/tmp`;`../../..` 走出 bundle)。目标将选择哪个目录被审
/// 判 —— 与检查相反。`Contents/MacOS` 是 OS 自己要求的位置,其下的嵌套
/// 可执行文件在一个已被探针的目录之下。
fn writable_component(app: &InstalledApp) -> bool {
	let candidates = [
		app.path.parent().unwrap_or(Path::new("/")),
		app.path.as_path(),
		&app.path.join(CONTENTS_RELDIR),
		&app.path.join(MACOS_RELDIR),
	];
	if candidates.iter().any(|dir| directory_is_writable(dir)) {
		return true;
	}
	if any_executable_is_writable(&app.path.join(MACOS_RELDIR)) {
		return true;
	}
	// Info.plist 本体,同一个 create-vs-replace 论证再一个文件。不可写的
	// `Contents` 仍装着本用户可**重写**的 plist,而它供给 policy 的
	// `CFBundleIdentifier` —— 伪造的 id 以操作者从未封过的名字通过
	// spawn 前拒绝,启动后复查读同一伪造字符串。它的可写性与可执行文件
	// 的同样承重。
	file_is_replaceable(&app.path.join(INFO_PLIST_RELPATH))
}

/// *query* → `(bundle 路径, 显示名)`,或拒绝。
///
/// 阶梯与匹配规则是 REF `resolve_target` 的镜像,两条不显然的规则都来自
/// 实测而非对称性:
///
/// * **查询在解析之前就对终端名单检查**,解析后的 bundle 再查一次。两次
///   查各抓不同的东西:实测 Windows 上要 `cmd` 解析到了不相干的
///   `IEDIAGCMD.EXE` 并启动了它 —— 只查解析结果的那次检查从没见过 shell;
/// * **模糊层是前缀,不是子串。** 短片段命中长名字内部是巧合不是意图,
///   而多义护栏抓不到它 —— 巧合通常恰好只命中一条。
///
/// exact 胜出;前缀命中多个**拒绝**而非挑一个 —— 启动错应用不可撤销。
/// 未命中时子串扫描供**建议**,拒绝因此可恢复。
pub fn resolve_target(query: &str) -> Result<(String, String), ComputerUseError> {
	resolve_in(&installed_apps(), query)
}

/// *source* 是否就是 [`APP_ROOTS`] 之一(按字面路径:目录枚举时记下的就是这些常量)。
fn is_trusted_catalog_root(source: &Path) -> bool {
	APP_ROOTS.iter().any(|root| Path::new(root) == source)
}

/// [`resolve_target`] 的可注入形态(测试喂离线目录)。
fn resolve_in(catalog: &[InstalledApp], query: &str) -> Result<(String, String), ComputerUseError> {
	let app = resolve_match(catalog, query)?;
	// 目录根(`APP_ROOTS`)是安装位置的信任边界,不再对 `/Applications`
	// 本身的 admin 可写做 create-probe —— 那会把每个第三方 app 拒掉,还
	// 配上一句「搬到 /Applications」。探针留给夹具与将来的非目录根。
	if !is_trusted_catalog_root(&app.source) && writable_component(app) {
		return Err(ComputerUseError::Denied(fill(ERR_WRITABLE_ROOT, &[("{name}", &app.name)])));
	}
	// 验证过的**路径**,不是名字。返回名字等于把验证扔掉:`open -a <名字>`
	// 要 LaunchServices 从它自己的数据库再解析,那个数据库索引了本模块
	// 刻意排除的 bundle —— 被检查的与跑起来的可以不是同一个。`open -a`
	// 收路径,启动的恰是那一个 bundle。显示名一并返回:每条拒绝与结果文
	// 案点名的都是应用而非路径。
	Ok((app.path.to_string_lossy().into_owned(), app.name.clone()))
}

/// 解析阶梯(exact → 唯一前缀 → 子串建议),纯查找、不触文件系统 ——
/// 可写性验证是 [`resolve_in`] 的下一层,测试因此能对阶梯本身逐分支断言。
fn resolve_match<'a>(catalog: &'a [InstalledApp], query: &str) -> Result<&'a InstalledApp, ComputerUseError> {
	let wanted = query.trim().to_lowercase();
	if wanted.is_empty() {
		return Err(ComputerUseError::NoSuchLaunchTarget { query: query.to_string(), near: String::new() });
	}
	if REFUSED_BUNDLES.contains(&wanted.as_str()) {
		return Err(ComputerUseError::Denied(fill(ERR_SHELL_TARGET, &[("{name}", query)])));
	}
	let mut matched: Vec<&InstalledApp> = catalog.iter().filter(|app| app.name.to_lowercase() == wanted).collect();
	if matched.is_empty() {
		let prefixed: Vec<&InstalledApp> =
			catalog.iter().filter(|app| app.name.to_lowercase().starts_with(&wanted)).collect();
		if prefixed.len() > 1 {
			let mut names: Vec<String> = prefixed.iter().map(|app| app.name.clone()).collect();
			names.sort();
			names.dedup();
			names.truncate(MAX_LAUNCH_SUGGESTIONS);
			return Err(ComputerUseError::AmbiguousLaunchTarget { names: names.join(", "), count: prefixed.len() });
		}
		matched = prefixed;
	}
	let Some(app) = matched.first() else {
		let near = catalog
			.iter()
			.filter(|app| app.name.to_lowercase().contains(&wanted))
			.map(|app| app.name.clone())
			.collect::<Vec<String>>()
			.join(", ");
		return Err(ComputerUseError::NoSuchLaunchTarget { query: query.to_string(), near });
	};
	if REFUSED_BUNDLES.contains(&app.name.to_lowercase().as_str()) {
		return Err(ComputerUseError::Denied(fill(ERR_SHELL_TARGET, &[("{name}", &app.name)])));
	}
	Ok(app)
}

/// 已解析 bundle 的全部名字,供 spawn 前策略检查。
///
/// macOS 的第二拼写是 **bundle id**,也是这里最要紧的:`policy.check_app`
/// 对 bundle id 与名字分别匹配,内置拒绝名单以 bundle 前缀表达
/// (`com.apple.Terminal`),操作者读过的每条 computer-use 拒绝点名的都是
/// bundle id —— 他们 `extra_denied_apps` 条目携带的拼写。只查显示名一个
/// 都匹配不上,拒绝就晚了一步才生效:应用已经跑起来之后。
///
/// 经 [`apps::bundle_identity_at`] 从 bundle 自己的 `Info.plist` 读 —— 与
/// 为**运行中**应用命名的同一个硬化读取(size 上限、`O_NOFOLLOW`),于是
/// spawn 前检查的字符串就是之后策略会看到的字符串。读不出 id 的 bundle
/// 不额外贡献也不失败:显示名仍被检查,启动后复查仍会跑。
pub fn target_identity(bundle_path: &str, display: &str) -> LaunchIdentity {
	let (bundle_id, _) = apps::bundle_identity_at(Path::new(bundle_path));
	LaunchIdentity { display: display.to_string(), key: bundle_id }
}

/// `/usr/bin/open -a <bundle_path>` —— 无文档、无参数。
///
/// 收 [`resolve_target`] 验证过的**路径**,永不收名字(理由见上)。`open`
/// 在请求递交 LaunchServices 后即返回,退出状态对窗口是否出现**什么都没
/// 说** —— 所以调用方以轮询窗口列表确认。
///
/// 与调用进程的管道分离:写 stdout 的应用不能填满一根没人排水的管道,也
/// 不许握着调用方的句柄;新进程组让开发终端里的一次 Ctrl-C 不把操作者的
/// 应用一起带倒。
pub fn spawn_detached(bundle_path: &str) -> Result<(), String> {
	let open = Path::new(OPEN_BIN);
	if !open.is_file() {
		return Err(format!("{OPEN_BIN} is not available on this host"));
	}
	let spawned = std::process::Command::new(open)
		.arg("-a")
		.arg(bundle_path)
		.stdin(std::process::Stdio::null())
		.stdout(std::process::Stdio::null())
		.stderr(std::process::Stdio::null())
		// 新进程组(POSIX setpgid(0,0)):脱离调用方的前台进程组。
		.process_group(0)
		.spawn();
	match spawned {
		Ok(child) => {
			// open 只递一次话;不收集它的退出状态,理由见函数文档。
			drop(child);
			Ok(())
		}
		Err(err) => Err(err.to_string()),
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	/// 每个测试自己的临时根(名字带测试标签 —— cargo 并行跑测试,共享
	/// 一个目录会互相看到对方的 bundle)。`Cleanup` 删掉整个树。
	struct Cleanup(PathBuf);

	impl Drop for Cleanup {
		fn drop(&mut self) {
			let _ = std::fs::remove_dir_all(&self.0);
		}
	}

	fn make_bundle(root: &Path, name: &str) -> PathBuf {
		let bundle = root.join(format!("{name}.app"));
		let macos = bundle.join(MACOS_RELDIR);
		std::fs::create_dir_all(&macos).expect("create bundle dirs");
		std::fs::write(macos.join(name), b"#!/bin/true\n").expect("write executable");
		bundle
	}

	fn fixture(label: &str, names_by_root: &[(&str, &[&str])]) -> (PathBuf, Cleanup) {
		let root = std::env::temp_dir().join(format!("point-launch-{label}-{}", std::process::id()));
		let _ = std::fs::remove_dir_all(&root);
		for (dir, names) in names_by_root {
			let sub = root.join(dir);
			std::fs::create_dir_all(&sub).expect("create root");
			for name in *names {
				make_bundle(&sub, name);
			}
		}
		(root.clone(), Cleanup(root))
	}

	fn catalog_at(root: &Path) -> Vec<InstalledApp> {
		let system = root.join("system");
		let applications = root.join("applications");
		installed_apps_in(&[system.as_path(), applications.as_path()])
	}

	/// 纯 catalog(不触文件系统):阶梯的每个分支都能离线断言。
	fn paper_catalog() -> Vec<InstalledApp> {
		[
			("Calculator", "system"),
			("Chess", "system"),
			("Calculator-Pro", "applications"),
			("TextEdit", "applications"),
		]
		.iter()
		.map(|(name, root)| InstalledApp {
			name: (*name).to_string(),
			path: PathBuf::from(*root).join(format!("{name}.app")),
			source: PathBuf::from(*root),
		})
		.collect()
	}

	#[test]
	fn installed_apps_lists_sorted_deduped_bundles_only() {
		let (root, _cleanup) =
			fixture("list", &[("system", &["Calculator", "Zoo"]), ("applications", &["Bar", "Zoo"])]);
		// 非 bundle 条目:一个无后缀目录 + 一个普通文件,二者都被排除。
		std::fs::create_dir_all(root.join("system").join("PlainDirectory")).unwrap();
		std::fs::write(root.join("system").join("Notes.txt"), b"x").unwrap();
		let catalog = catalog_at(&root);
		let names: Vec<&str> = catalog.iter().map(|app| app.name.as_str()).collect();
		// 系统根在前、根内按名字排序;同名时更信任的根赢(Zoo 只出现一
		// 次,来自 system);非 .app 条目与普通文件被排除。
		assert_eq!(names, ["Calculator", "Zoo", "Bar"]);
		assert!(catalog.iter().all(|app| app.path.is_dir()));
		assert_eq!(catalog[0].source, root.join("system"));
	}

	#[test]
	fn resolve_ladder_exact_prefix_ambiguous_miss() {
		let catalog = paper_catalog();

		// exact,大小写不敏感、首尾空白剥掉。
		let app = resolve_match(&catalog, "  CALCULATOR ").unwrap();
		assert_eq!(app.name, "Calculator");

		// 唯一前缀。
		assert_eq!(resolve_match(&catalog, "te").unwrap().name, "TextEdit");

		// 多义前缀:拒绝而非挑一个,候选排序去重、点出全部。
		let err = resolve_match(&catalog, "c").unwrap_err();
		let ComputerUseError::AmbiguousLaunchTarget { names, count } = err else {
			panic!("expected ambiguous, got {err}");
		};
		assert_eq!(count, 3);
		assert_eq!(names, "Calculator, Calculator-Pro, Chess");

		// 未命中:子串建议让拒绝可恢复;无一处子串命中则 near 为空。
		let ComputerUseError::NoSuchLaunchTarget { near, .. } = resolve_match(&catalog, "zzz").unwrap_err() else {
			panic!("expected no-such");
		};
		assert!(near.is_empty(), "{near}");
		let ComputerUseError::NoSuchLaunchTarget { near, .. } = resolve_match(&catalog, "dit").unwrap_err() else {
			panic!("expected no-such");
		};
		assert!(near.contains("TextEdit"), "{near}");

		// 空查询。
		assert!(matches!(resolve_match(&catalog, "   "), Err(ComputerUseError::NoSuchLaunchTarget { .. })));
	}

	#[test]
	fn terminals_are_refused_before_and_after_resolution() {
		let catalog: Vec<InstalledApp> = ["Terminal", "Hype"]
			.iter()
			.map(|name| InstalledApp {
				name: (*name).to_string(),
				path: PathBuf::from(format!("/{name}.app")),
				source: PathBuf::from("/"),
			})
			.collect();

		// 查询本身就是拒绝名单上的名字:在解析之前拒绝,文案点原始查询。
		let err = resolve_match(&catalog, "iTerm2").unwrap_err().to_string();
		assert!(err.contains("is a terminal"), "{err}");
		assert!(err.contains("'iTerm2'"), "{err}");

		// 前缀解析到终端:解析结果的复查拒绝(只查查询的那次看不到
		// shell —— 实测 Windows 上 `cmd` 前缀命中过 `IEDIAGCMD.EXE`)。
		let err = resolve_match(&catalog, "term").unwrap_err().to_string();
		assert!(err.contains("is a terminal"), "{err}");
		assert!(err.contains("'Terminal'"), "{err}");

		// 非终端的正常通过(这一层不触文件系统)。
		assert_eq!(resolve_match(&catalog, "hype").unwrap().name, "Hype");
	}

	#[test]
	fn a_writable_install_refuses_rather_than_launches() {
		// 测试目录由当前用户创建 —— parent/bundle/Contents/Contents/MacOS
		// 全部可写,这正是被拒绝的形状,四层探针的任一层都该拦住。
		let (root, _cleanup) = fixture("writable", &[("applications", &["Plant"])]);
		let catalog = catalog_at(&root);
		let err = resolve_in(&catalog, "plant").unwrap_err().to_string();
		assert!(err.contains("this user can replace it"), "{err}");
		assert!(err.contains("root-owned bundle"), "{err}");
	}

	#[test]
	fn trusted_catalog_root_skips_the_writable_probe() {
		// 夹具目录可写,但 source 伪装成 /Applications:生产路径上这正是
		// 「admin 可写的 /Applications 不得株连里面的 bundle」。
		let (root, _cleanup) = fixture("trusted-root", &[("applications", &["Plant"])]);
		let mut catalog = catalog_at(&root);
		catalog[0].source = PathBuf::from("/Applications");
		let (path, name) = resolve_in(&catalog, "plant").expect("trusted catalog root skips the probe");
		assert_eq!(name, "Plant");
		assert!(path.ends_with("Plant.app"), "{path}");
	}

	#[test]
	fn ghostty_is_refused_as_a_terminal() {
		let catalog = vec![InstalledApp {
			name: "Ghostty".into(),
			path: PathBuf::from("/Applications/Ghostty.app"),
			source: PathBuf::from("/Applications"),
		}];
		let err = resolve_match(&catalog, "ghostty").unwrap_err().to_string();
		assert!(err.contains("is a terminal"), "{err}");
		assert!(err.contains("'Ghostty'") || err.contains("'ghostty'"), "{err}");
	}

	#[test]
	fn the_read_only_system_root_launches_by_path() {
		// 真机整条链:系统根只读 → 四层探针全「否」→ 返回**路径**(不
		// 是名字,验证不因换名重解析而被扔掉)。
		let (path, name) = resolve_target("calculator").expect("Calculator lives on the read-only system volume");
		assert_eq!(name, "Calculator");
		assert_eq!(path, "/System/Applications/Calculator.app");
	}

	#[test]
	fn writable_probes_answer_by_creation_not_by_mode() {
		// 本机两个真实读数:用户可写的 /Applications(admin 组,拖拽安装
		// 不要密码正因如此)、系统卷上只读的 /System/Applications。两者
		// 之间的差异正是探针存在的原因 —— mode 的纸面推演在 admin 组成
		// 员身份面前会答错。
		assert!(directory_is_writable(Path::new("/Applications")));
		assert!(!directory_is_writable(Path::new("/System/Applications")));
		// 不存在的目录:明确答「否」的错误形态之一。
		assert!(!directory_is_writable(Path::new("/definitely/not/here")));

		// 属主即本用户的文件按 replaceable 对待,mode 无关紧要(owner 可
		// 以无特权 chmod,只读 mode 是同一用户随时能撤销的事实)。
		let mine = std::env::temp_dir().join(format!("point-repl-{}", std::process::id()));
		std::fs::write(&mine, b"x").expect("write own file");
		use std::os::unix::fs::PermissionsExt;
		let mut perms = std::fs::metadata(&mine).unwrap().permissions();
		perms.set_mode(0o444);
		let _ = std::fs::set_permissions(&mine, perms);
		assert!(file_is_replaceable(&mine));
		// root 拥有、无人可写的系统文件:不可替换。
		assert!(!file_is_replaceable(Path::new("/System/Applications/Calculator.app/Contents/Info.plist")));
		let _ = std::fs::remove_file(&mine);
	}

	#[test]
	fn target_identity_reads_the_bundle_id_through_the_hardened_reader() {
		// 真机系统 bundle 的读数:bundle id 来自 Info.plist,显示名原样带回。
		let identity = target_identity("/System/Applications/Calculator.app", "Calculator");
		assert_eq!(identity.display, "Calculator");
		assert_eq!(identity.key, "com.apple.calculator", "the hardened plist reader names the bundle id");
	}

	/// launcher 按绝对路径钉死,永不从 PATH 解析(REF `_OPEN_BIN` 的规则)。
	#[test]
	fn open_bin_is_pinned_absolute() {
		assert!(OPEN_BIN.starts_with('/'), "{OPEN_BIN}");
		assert!(Path::new(OPEN_BIN).is_file(), "macOS ships {OPEN_BIN}");
	}
}
