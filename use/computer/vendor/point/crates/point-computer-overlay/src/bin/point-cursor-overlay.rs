//! 无特权 overlay helper:读 stdin 上的点列,画完即忘。
//!
//! 本刀不创建 OS 窗口(那需要平台 GUI 权,会把装饰进程变成第二条输入通道)。
//! 生产接线:父进程把已经算好的点列喂进来;本进程只验证协议并立刻回 `ok`。
//! 时长等待留在 driver 的 `wait_shown`;helper 不睡,避免双倍等待。
//! AppKit/Win32 皮肤是后续刀,翻转留在皮肤内。

use std::io::{self, BufRead, Write};

use point_computer_overlay::protocol;

fn main() {
	let stdin = io::stdin();
	let mut stdout = io::stdout();
	let mut pending = String::new();
	for line in stdin.lock().lines() {
		let Ok(line) = line else {
			break;
		};
		pending.push_str(&line);
		pending.push('\n');
		if protocol::decode(&pending).is_some() {
			pending.clear();
			let _ = writeln!(stdout, "ok");
			let _ = stdout.flush();
		}
	}
}
