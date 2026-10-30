---
kind: execution_plan
status: proposed
date: 2026-10-30
baseline: 0847ddc
---

# Windows Computer Use 本机交接

先读 [交接总表](computer-use-platform-handoff.md)。首个任务是验证并修复已有 v1，
不要求先移植 Cua 或扩展公开动作。Windows runner 编译/链接和纯准入已通过，
目前没有足以声明交互桌面输入已通过的证据。

## 所需机器与代码入口

使用已解锁的 Windows 10/11 普通用户会话，优先 x64，记录实际 build/架构。
准备 Node 22+、Rust stable/MSVC 与原生链接工具。自有 GUI fixture 可用 C#
WinForms 源码，由本机工具编译到临时目录；测试工具依赖不进入生产驱动。
服务会话、无显示设备和实际交互桌面分别记录结果。

- [平台包](../../use/computer/crates/computer-windows/src/desktop.rs)：UIA、窗口输入与启动。
- [profile](../../use/computer/crates/computer-windows/src/profile.rs)：当前允许的组合。
- [bridge](../../use/computer/crates/computer-windows/src/bridge.rs)：Point 与 Pero 的唯一值转换。
- [vendored Windows](../../use/computer/vendor/point/crates/point-computer-windows/src/lib.rs)：
  UIA、WGC/PrintWindow、按键/鼠标与停止相关原生代码。
- 新建 fixture 和 `tests/e2e/computer-windows.mjs`，沿用现有 NDJSON 与证据格式。

## 第一阶段：已有能力的实际效果

自有应用至少有按钮、Unicode 编辑框、可滚动区域、可拖动对象和独立 guard 窗口。
通过应用事件写出状态，同时读取真实前台/焦点和系统指针位置。
捕获路径诊断可在 Windows 包内的 opt-in integration test 检查原生 snapshot，
不为测试给模型协议增加原生句柄或私有诊断字段。

| 用例 | 应观察到什么 |
| --- | --- |
| 后台 element 单击 | UIA invoke 恰好改变一次计数；guard 和真光标不受影响 |
| 后台 pixel 点击、后台 text/key | 按当前 profile 拒绝，不向应用投递 |
| 前台 element/pixel 点击 | 命中选定窗口，左右中/单双三击的意义准确，遮挡不串到其他目标 |
| 前台 element text/key | 焦点为观察到的非安全 UIA 控件；Unicode/emoji 和选区效果可核对 |
| 前台 pixel text/key | 目前应拒绝，不能临时变成未验证的全局键盘输入 |
| 前台 scroll/drag | 120 像素/格的换算可解释；滚动内容和对象位置实际变化 |
| 截图 | 与窗口几何/DPI 一致，WGC 与 fallback 来源诊断真实；有唯一可识别内容 |
| stale/stop/restart | 旧观察、窗口替换与重启前句柄失效；重复 request ID 不重复应用效果 |

至少加入同 PID 两个相互覆盖的窗口、窗口移动/缩放、100%/150% scale、
多显示器与负坐标，再逐项登记实际覆盖。检查 HWND/几何转换在目标架构上的结果，
不要仅因为某个整型能编译就认定原生句柄或坐标转换正确。

安全字段或不完整 UIA 树按现有规则抑制图片与值。使用 fixture 的受控状态切换
验证该分支，不能把真实密码、用户屏幕或输入内容当测试数据保存。

## 拒绝、输入状态和停止

以普通用户为基线，测试更高完整性目标、不可交互 desktop、权限变化和应用退出。
[SendInput 受 UIPI 约束](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput)，
且 API 不会直接告诉调用方失败就是 UIPI；记录实际检查与结果，不能给所有失败编造原因。
已可能派发的失败保留 `unknown`。不得通过自动提权或切换 session 绕过拒绝。

在可观察到的拖拽/修饰键阶段触发停止，核对应用状态及按键/按钮释放情况；
需要夹具 readiness/事件信号，不靠 sleep 猜中断时点。
当前 Ctrl+Shift+Esc 与 Windows
[Task Manager 快捷键](https://support.microsoft.com/en-us/windows/experience/system-configuration-tools-in-windows)
重合，必须验证全局快捷键注册与实际停止效果，并提供有效的菜单/设置停止路径。

## PR 拆分与完成条件

1. **fixture/验收 PR**：基础测试只依赖本机交互会话，新增明确 opt-in 的 GUI 入口；
   常规单元测试和 hosted CI 保持可在非交互环境运行。
2. **具体修复 PR**：每个已复现行为单独修正；更新本平台 profile 和共享准入预期，
   不把未经实现的组合广告为支持。
3. **框架覆盖 PR**：WinForms 后补 WPF、Electron，再按机器条件扩 WinUI；
   每个框架留独立成功/拒绝行，不能从一个应用外推全部 Windows。
4. **新语义 API PR**：set-value、Toggle/Selection/Expand 等在 C1/C5 后实现。
   `type_text` 不得偷偷改为 ValuePattern 全量替换。

基础命令见总表；新 GUI 命令需在实现 PR 中定义并写入文档。
完成时附 commit、环境、能力表、请求/回执、截图哈希、应用状态、焦点/指针和清理结果，
更新 [fitness](../fitness/computer-use.md)。签名安装包、真实 Agent、RDP 断连/重连
另列验收，不能被编译成功或一次自有窗口运行替代。
