//! 窗口捕获:像素 → 一张落盘的、尺寸有界的 JPEG。全程进程内。REF
//! `capture_macos.py` 的移植。
//!
//! **无子进程、无图像库。** 不 `/usr/sbin/screencapture`、不 Pillow。
//! `CGWindowListCreateImage` 抓一个窗口的像素,ImageIO 的
//! `CGImageDestination` 编码,降 scale 由 ImageIO 经
//! `kCGImageDestinationImageMaxPixelSize` 自己完成。三个麻烦随这个选择消
//! 失:spawn 审计没有要记账的节点,没有可选依赖要绕(REF 的依赖清单里根
//! 本没有 Pillow),没有每次捕获 204ms 的进程启动。
//!
//! **为什么图是路径、绝不是字节。** MCP 传输只发 `{"content":[{"type":
//! "text",...}]}`,表达不了图像块,中继的截图只能变成文本里的 base64 ——
//! 实测一张裸窗口 PNG ~41,000 token。压缩后的文件落盘,只有路径被中继;
//! 无障碍树不够用时模型才按需读它。1280px/q0.55 下真实窗口编码 ~24KB(真
//! 要读也才 ~8,300 token),图是佐证而非主通道。
//!
//! 尺寸报告来自编码后的字节(`ffi::jpeg_dimensions` 解析 SOF),不是源图
//! 的 —— 对输入调 `CGImageGetWidth` 会多报降 scale 的倍数(实测 1676x1320
//! 的窗口编成 1280x1008),结果行里的错误尺寸会让模型对着一个它拿不到的
//! 分辨率推理。
//!
//! 已接受的残留风险,写在这里因为评审会找到:落盘的 JPEG 住在代理可读的
//! 0700 临时目录里。computer use 放宽的是**画面里可能有什么**(任何窗口,
//! 不止一个浏览器标签)—— 所以捕获是按窗口的、永不整屏,含任何 secure
//! 字段的窗口根本不捕,目录环形修剪。不声称它是关死的。

use std::io::Write as _;
use std::os::unix::fs::OpenOptionsExt as _;
use std::os::unix::fs::PermissionsExt as _;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use point_computer_core::types::{
	AppRef, MAX_SCREENSHOT_MAX_PX, MIN_SCREENSHOT_MAX_PX, SCREENSHOT_DIR_NAME, SCREENSHOT_FILE_PREFIX,
	SCREENSHOT_FILE_SUFFIX, SCREENSHOT_KEEP, Snapshot,
};

use crate::ffi;

/// 属主-only。目录里是操作者自己窗口的像素,别的本地账户不得列出或读。
const SHOT_DIR_MODE: u32 = 0o700;
/// 文件也属主-only(mkstemp 语义:出生即 0600)。
const SHOT_FILE_MODE: u32 = 0o600;
/// ImageIO 吃 0.0–1.0 的质量;配置字段是用户与设置面板懂的 0–100 整数。
const QUALITY_SCALE: f64 = 100.0;

/// 唯一文件名的进程内序号。与毫秒时间戳配合:同毫秒两次捕获(一次
/// get_state 跟着一次变更动作的重快照)是常态,秒级名会静默覆盖;而网关
/// 把快照卸到线程池时,**不同应用**的两次捕获也能落进同一毫秒 —— 纯时间
/// 戳名会解析到同一路径、两个写者打开它,后者覆盖前者,一个调用方拿到一
/// 张它从未请求过的应用截图(跨应用的像素泄漏,不只是丢文件)。序号 +
/// create_new 让冲突在类型上不可表达。
static FILE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 截图目录路径(无副作用)。
///
/// 从 `std::env::temp_dir()` 构建而非硬编码 `/tmp` —— 同 `$TMPDIR` 约定,
/// 非 darwin 移植不必改这里。
pub fn shots_dir() -> PathBuf {
	std::env::temp_dir().join(SCREENSHOT_DIR_NAME)
}

/// 创建 0700 的截图目录并返回路径。
///
/// `create_dir_all` 之后**重申**权限:创建路径上的 mode 经 umask 折扣,一
/// 个宽松的 umask 会留下组/全局可读的目录,mode 的全部意义就没了。设不
/// 上权限仅是告警级别的处境 —— 拒绝捕获会为一个可能根本不支持 mode 的文
/// 件系统弄坏一个特性,而文件本身出生即 0600(见 [`persist_jpeg`])。
pub fn ensure_shots_dir() -> PathBuf {
	let path = shots_dir();
	let _ = std::fs::create_dir_all(&path);
	if let Ok(meta) = std::fs::metadata(&path) {
		let mut perms = meta.permissions();
		perms.set_mode(SHOT_DIR_MODE);
		let _ = std::fs::set_permissions(&path, perms);
	}
	path
}

/// 捕获 *snap* 的窗口、落盘 JPEG、返回带图的快照。
///
/// 以下情形返回快照**原样**(无图):
///
/// * 快照含任何 secure 元素 —— 永不撤的底线。密码框渲染出的字形就是凭据
///   (树只掩了它的值),而已编码 JPEG 的子矩形没有可靠的办法涂掉,所以
///   抑制是整窗的。渲染器会明确说出来而非静默省略那一行 —— 要了像素却没
///   得到的模型,除非被告知省略是故意的,会循环重试;
/// * 窗口 id 未知;
/// * 捕获或编码没有产出字节(已关的窗口给 NULL image —— 实测,不是崩
///   溃);
/// * 落盘失败。
///
/// 永不失败:无障碍树是主通道,捕获失败必须降级结果而非弄败观测。
pub fn attach_image(snap: Snapshot, max_px: u32, quality: u8) -> Snapshot {
	if snap.has_secure {
		return snap;
	}
	// 对不完整的扫描 **fail-closed**。has_secure 对走查**分类过**的每个节
	// 点置位 —— 已含报告预算之外的 —— 但走查仍有自己的硬截止
	// (MAX_TREE_NODES_LIMIT 与 MAX_WALK_SECS)。任一触发,走查就没到过窗
	// 口的末尾,has_secure=false 的意思因此是「没看见」而非「不存在」:
	// 截止之外的密码框会让渲染出的凭据可捕。「未知」在这里必须表现得和
	// 「存在」一样。这是决定像素能否离开进程的那道门,两个方向错的代价
	// 不对称 —— 被抑制的截图花模型一次已宣布的省略(渲染器说了,所以不
	// 会盲目重试),捕错的拍下的是谁的密码框。
	if snap.truncated || snap.depth_truncated {
		return snap;
	}
	if snap.app.window_id == 0 {
		return snap;
	}
	let (raw, width, height) = encode_window(&snap.app, max_px, quality);
	if raw.is_empty() {
		return snap;
	}
	let Some(path) = persist_jpeg(&raw) else { return snap };
	// 结构更新语法等价 REF 的 dataclasses.replace:逐字段重建曾让本函数静
	// 默丢字段 —— 后来给 Snapshot 加的每个字段都从带图的响应里消失,而丢
	// 失的形状恰是它阴险的地方:同一快照**不带**图时一切正常。Rust 侧
	// `..snap` 让「其余字段原样」由编译器点名。
	Snapshot { image_jpeg: raw, image_path: path, image_width: width, image_height: height, ..snap }
}

/// 捕获 + 编码一个窗口。钳制 *max_px* 与 *quality* 而非信任调用方:
/// schema 校验的是代理输入,本函数也可能从配置到达,一个 0 或负的
/// max_px 递给 ImageIO 会产出退化图或无界图。
fn encode_window(app: &AppRef, max_px: u32, quality: u8) -> (Vec<u8>, u32, u32) {
	let clamped_px = max_px.clamp(MIN_SCREENSHOT_MAX_PX, MAX_SCREENSHOT_MAX_PX);
	let clamped_quality = (quality.clamp(1, 100) as f64) / QUALITY_SCALE;
	ffi::capture_window_jpeg(app.window_id, clamped_px, clamped_quality)
}

/// 把 *raw* 写进截图目录并返回路径;失败 `None`。
///
/// 先写后修剪,目录无论之后发生什么都有界 —— 先修剪会让上限在「写完就崩
/// 的会话」余生里被一个文件持续违反。文件名:毫秒时间戳前缀(环形修剪按
/// 名字排序即按时间,读 spool 的人也想要它)+ 进程内序号 + `create_new`
/// 原子分配 —— 见 [`FILE_SEQUENCE`] 的论证。失败路径上的半成品文件当场
/// 删除:没人会收到这个路径,留着的话一张可能含敏感屏幕像素的孤儿帧在
/// spool 里坐到环形修剪碰巧轮到它。
pub fn persist_jpeg(raw: &[u8]) -> Option<String> {
	if raw.is_empty() {
		return None;
	}
	let directory = ensure_shots_dir();
	let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
	let sequence = FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
	let path = directory.join(format!(
		"{SCREENSHOT_FILE_PREFIX}{ms}-{sequence}{pid}{SCREENSHOT_FILE_SUFFIX}",
		pid = std::process::id(),
	));
	let mut options = std::fs::File::options();
	options.write(true).create_new(true).mode(SHOT_FILE_MODE);
	let mut file = match options.open(&path) {
		Ok(file) => file,
		Err(_) => {
			// create_new 失败几乎只剩同名冲突(毫秒 + 序号 + pid 三重下仍
			// 可能:测试环境反复重置时钟无此忧,如实降级)。
			return None;
		}
	};
	if file.write_all(raw).is_err() {
		let _ = std::fs::remove_file(&path);
		return None;
	}
	drop(file);
	// 属主-only 再申一次:目录已 0700,这里是纵深防御(目录 mode 可能设
	// 不上时的那层);失败仅降级 —— 文件已在属主目录里。
	if let Ok(meta) = std::fs::metadata(&path) {
		let mut perms = meta.permissions();
		perms.set_mode(SHOT_FILE_MODE);
		let _ = std::fs::set_permissions(&path, perms);
	}
	trim_shots_dir();
	path.into_os_string().into_string().ok()
}

/// 只保留最新 *keep* 张截图,返回删除数。
///
/// 目录是缓存不是归档,长会话不能填满临时卷。按文件名而非 mtime 排序:
/// 名字带毫秒时间戳,字典序即时间序,无需逐文件 stat。永不失败:别的进程
/// 恰好并发删掉或删不掉的文件,跳过。
pub fn trim_shots_dir() -> usize {
	trim_shots_dir_to(SCREENSHOT_KEEP)
}

fn trim_shots_dir_to(keep: usize) -> usize {
	if keep == 0 {
		return 0;
	}
	let directory = shots_dir();
	let Ok(entries) = std::fs::read_dir(&directory) else {
		return 0;
	};
	let mut names: Vec<String> = entries
		.filter_map(|entry| entry.ok())
		.filter_map(|entry| entry.file_name().into_string().ok())
		.filter(|name| name.starts_with(SCREENSHOT_FILE_PREFIX) && name.ends_with(SCREENSHOT_FILE_SUFFIX))
		.collect();
	if names.len() <= keep {
		return 0;
	}
	names.sort();
	let mut removed = 0;
	for name in &names[..names.len() - keep] {
		if std::fs::remove_file(directory.join(name)).is_ok() {
			removed += 1;
		}
	}
	removed
}

// ── 纯测(尺寸解析、环形修剪、落盘;真实捕获在 #[ignore] 冒烟里) ──

#[cfg(test)]
mod tests {
	use super::*;
	use crate::ffi::jpeg_dimensions;
	use point_computer_core::types::{DEFAULT_SCREENSHOT_JPEG_QUALITY, DEFAULT_SCREENSHOT_MAX_PX};

	#[test]
	fn jpeg_dimensions_reads_sof() {
		// 手工 SOF:FF D8(SOI)FF C0(SOF0)段长(含自身)precision 高 宽 分量数。
		let mut jpeg = vec![0xFF, 0xD8, 0xFF, 0xC0, 0x00, 0x08];
		jpeg.push(0x08); // precision:每分量 8 位。
		jpeg.extend_from_slice(&1000u16.to_be_bytes()); // 高
		jpeg.extend_from_slice(&2000u16.to_be_bytes()); // 宽
		jpeg.push(0x01); // 分量数:1。
		assert_eq!(jpeg_dimensions(&jpeg), (2000, 1000), "width first, big-endian");
		// 非 JPEG / 空 → (0, 0)。
		assert_eq!(jpeg_dimensions(&[]), (0, 0));
		assert_eq!(jpeg_dimensions(b"not a jpeg at all"), (0, 0));
		// 段长字段 < 2:病态流,不推进、不 panic。
		assert_eq!(jpeg_dimensions(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x01]), (0, 0));
	}

	#[test]
	fn persist_and_ring_trim_keep_the_directory_bounded() {
		// 真实临时目录往返:写 keep+2 张,修剪后只剩最新 keep 张。
		let dir = ensure_shots_dir();
		let mut paths = Vec::new();
		for i in 0..5 {
			let path = persist_jpeg(format!("frame-{i}").as_bytes()).expect("persist succeeds");
			assert!(path.starts_with(dir.to_str().unwrap()), "{path}");
			paths.push(path);
		}
		let removed = trim_shots_dir_to(2);
		assert!(removed >= 3, "removed {removed}");
		let remaining = std::fs::read_dir(&dir)
			.unwrap()
			.filter_map(|entry| entry.ok())
			.filter(|entry| entry.file_name().to_string_lossy().starts_with(SCREENSHOT_FILE_PREFIX))
			.count();
		assert_eq!(remaining, 2, "ring keeps exactly the newest frames");
		// 文件属主-only。
		let meta = std::fs::metadata(&paths[4]).unwrap();
		assert_eq!(meta.permissions().mode() & 0o777, 0o600);
		// 空字节:不落盘。
		assert!(persist_jpeg(b"").is_none());
	}

	/// 冒烟:真实窗口捕获 + ImageIO 编码(需屏幕录制授权;权限假象见
	/// permissions 模块 —— 探针 missing 不代表失败,失败自然显形)。
	#[test]
	#[ignore = "needs a desktop session; captures a real window"]
	fn capture_returns_jpeg_with_dimensions() {
		let apps = crate::apps::list_apps();
		let Some(app) = apps.first() else {
			eprintln!("no on-screen app to capture");
			return;
		};
		let (raw, width, height) = encode_window(app, DEFAULT_SCREENSHOT_MAX_PX, DEFAULT_SCREENSHOT_JPEG_QUALITY);
		assert!(!raw.is_empty(), "an on-screen window encodes");
		assert!(width > 0 && height > 0);
		assert_eq!((raw[0], raw[1]), (0xFF, 0xD8), "bytes are a JPEG");
		assert!(width <= MAX_SCREENSHOT_MAX_PX, "downscale bounded");
	}

	/// 冒烟:抑制规则的全链路(truncated → 不捕)。
	#[test]
	#[ignore = "needs a desktop session"]
	fn suppression_gates_hold_on_a_real_snapshot() {
		let apps = crate::apps::list_apps();
		let Some(app) = apps.first() else { return };
		let snap = crate::snapshot::build_snapshot(app, &point_computer_core::types::SnapshotRequest::default())
			.expect("walk succeeds");
		let out = attach_image(snap.clone(), DEFAULT_SCREENSHOT_MAX_PX, DEFAULT_SCREENSHOT_JPEG_QUALITY);
		if snap.has_secure || snap.truncated || snap.depth_truncated || snap.app.window_id == 0 {
			assert!(out.image_path.is_empty(), "suppressed snapshots carry no image");
		} else {
			assert!(!out.image_path.is_empty(), "a clean window gets a screenshot");
			assert!(!out.image_jpeg.is_empty());
		}
	}
}
