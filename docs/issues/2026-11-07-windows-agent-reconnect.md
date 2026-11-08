---
kind: verification_report
github_issue: 168
github_state: CLOSED
github_url: https://github.com/phodal/pero/issues/168
---

# Windows 新聊天连接 Agent 报 os error 193

Canonical tracker: [Windows chat background/path incident](2026-11-07-windows-chat-background-path.md).
This report preserves the adapter reconnect investigation and verification evidence.

新聊天自动准备或点击“重新连接 Agent”时，Host 报
`Internal error: "%1 不是有效的 Win32 应用程序。（os error 193）"`。

开发模式的 Codex、Claude 注册项直接执行 `node_modules/.bin/` 下的无扩展名
npm shell shim。Windows CreateProcess 无法执行该脚本，发生错误的位置早于
ACP initialize，因此重连重复失败。使用 .NET ProcessStartInfo 直接执行当前
checkout 的 Codex shim 已复现同类平台错误。已安装依赖的 package.json 确认
两个 adapter 的 JavaScript 入口都是各包的 `dist/index.js`。

打包模式已有 `PERO_ADAPTER_NODE` 与 bundled adapter 启动路径。修复开发模式
为显式 Node 执行项目锁定依赖的 JS 入口；Electron 使用已有 `PERO_APP_NODE`，
独立 Host/Worker 使用 PATH 中的 Node。用户自定义注册项继续覆盖内置项。

回归范围：临时路径包含空格，两个内置 adapter 经真实 ACP fixture 连接、关闭、
重连，覆盖开发模式、PATH Node、打包模式与自定义覆盖；不调用模型服务。

## 修复与验证

- `crates/pero-runtime/src/acp/registry.rs` 显式使用 Node 执行 JS 入口，并保留
  adapter 入口缺失时的不可用状态。打包配置及自定义覆盖保留原有优先级。
  入口检查只处理单个绝对脚本参数；自定义 Node 启动参数不作为文件检查。
- 修复前，新增回归测试通过真实 ACP 启动复现完全相同的
  `Internal error: "%1 不是有效的 Win32 应用程序。 (os error 193)"`。
- `node scripts/cargo.mjs test -p pero-runtime --test agent_registry`：通过。
  一个父测试执行五种隔离环境，子测试由父测试运行，默认标记 ignored。
  自定义覆盖包含 `ELECTRON_RUN_AS_NODE=1` 和 `--no-warnings`，其可用性
  回归同样经过先失败、后通过的验证。
- `node scripts/cargo.mjs test -p pero-runtime acp:: --lib`：35 项通过。
- `node scripts/cargo.mjs build -p pero-host`：通过。旧 Host 正在运行导致首次
  构建无法覆盖 exe；将旧文件重命名为 `target/debug/pero-host.pre-agent-reconnect.exe`
  后已生成新版 `target/debug/pero-host.exe`，没有终止用户现有进程。
- 使用新版真实 Host、临时配置和 Electron Node 路径读取 Agent 列表：Codex、
  Claude 均可用，命令均为 Electron exe；实际 Codex adapter 的 `--version`
  在 Electron Node 模式返回 2.3.0。

当前用户进程仍运行旧 Host，重启 Pero 后加载修复。未验证真实模型请求、GUI
按钮点击或其他操作系统；fixture 回归验证的是启动、ACP 准备及重连链路。

## Upstream review

Tracked by [#168](https://github.com/phodal/pero/issues/168). The local fix is implemented; upstream acceptance is pending in the linked Draft PR. The PR branch contains only these Windows fixes and is based on upstream `f514d945`. Earlier verification described above used the original working tree; clean-branch checks are recorded separately in the PR.
