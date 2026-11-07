---
kind: incident
status: active
github_issue: 168
github_state: OPEN
github_url: https://github.com/phodal/pero/issues/168
---

# Windows 新聊天弹出 Codex 终端、目录显示设备前缀

新建 Codex 会话时，npm 安装的原生 `codex.exe` 弹出终端窗口。Host 使用的
ACP Rust SDK 3.5.0 已给第一层进程设置 `CREATE_NO_WINDOW`，但安装的
Codex ACP 2.3.0 和 Codex CLI JS 入口后续调用 Node `spawn` 时未指定
`windowsHide`。第一层启动选项不会自动成为后续 Node 进程的启动策略。

聊天框选择 `F:\pero_test` 后显示 `\\?\F:\pero_test`。Host 的
`std::fs::canonicalize` 在 Windows 返回扩展路径，Composer 只按 `/` 提取
最后一段，未识别 Windows 分隔符，因此显示了整个内部路径。

修复范围：内置 Node adapter 的 Windows 子进程后台启动、Host 的工作目录
规范化回执，以及 Composer 的跨平台目录名显示。不变更会话、权限、执行或
取消所有者。使用现有 dunce 路径规范化，保留确实需要扩展路径的系统语义。

验证计划：真实 Windows 控制台可见性（含 Node 后代进程）；既有 ACP
连接/关闭/重连及打包、自定义覆盖；真实 Host 目录回执与 Electron Composer
显示。真实模型请求不作为本次验证前提。

## 修复与验证结果

验证基于 `185673fc` 加当前工作区未提交修改，平台为 Windows。

- 内置 Codex/Claude 的 Windows 配置通过 `NODE_OPTIONS` 预加载
  `packages/agent-runtime/windows-background.cjs`。它只在这些 Node Agent
  及其 Node 后代进程内给 `spawn` 指定 `windowsHide: true`，保留 pipes、
  参数及退出语义；打包同时携带该文件。自定义注册项保留覆盖优先级。
- Host 工作目录选择使用已安装的 dunce 规范化普通路径；确需扩展路径时由
  dunce 保留。共享 Composer 按 `/` 和 `\` 提取目录名。
- 独立编写的 `tests/runtime/agent-background.test.mjs` 在空预加载实现下
  实际观察到 `visible: true`，修复后直接/嵌套 Node 启动的原生控制台均为
  `visible: false`。另验证正常参数、stdout、退出码，以及 Node 支持的
  `spawn(command, undefined/null, options)` 选项保留。系统 Node 与
  Electron Node 模式均为 6 项测试/子测试通过。测试已接入两条 CI 工作流。
- Host 协议回归先失败并打印 `\\?\C:\...`，修复后通过；测试明确消费初始
  工作目录事件，随后检查用户选定目录回执。ACP 注册、连接和重连回归通过，
  既有 35 项 ACP 测试通过。
- Host、共享聊天 Wasm、Web、Desktop 构建通过；实际 adapter 打包 staging
  完成。正在运行的旧 Host exe 保留为 `pero-host.pre-background-path.exe`，
  新版已写回原启动路径，没有终止用户进程。
- Windows Electron / GPUI Wasm 实际运行检查通过：用真实目录按钮及受控
  `showOpenDialog` 回执选择临时目录，浅色显示 `pero_test`，悬浮提示为普通
  完整路径；切换含空格目录、取消、返回原目录、深色及 1086×738 渲染区域
  均已检查。截图与结果位于 `test-results/windows-chat/`，已关闭并清理本次
  隔离测试配置。覆盖现有工作区未提交修改与本次修复，非干净提交构建。

本次未发送真实模型请求，未检查 GPUI Native 或正式安装包；Electron 的原生
文件选择弹窗由受控回执替代。用户重启 Pero 后加载新版 Host 与界面。

## Upstream review

Tracked by [#168](https://github.com/phodal/pero/issues/168). The local fix is implemented; upstream acceptance is pending in the linked Draft PR. The PR branch contains only these Windows fixes and is based on upstream `f514d945`. Earlier verification described above used the original working tree; clean-branch checks are recorded separately in the PR.

## Clean upstream branch verification

Based on upstream `f514d945` with only this fix applied:

- `node --test tests/runtime/agent-background.test.mjs`: 6 tests/subtests passed on Windows.
- `node scripts/cargo.mjs test -p pero-runtime --test agent_registry`: parent passed; its isolated child harness runs the development, PATH, packaged, custom and missing-adapter cases.
- `node scripts/cargo.mjs test -p pero-runtime acp:: --lib`: 39 tests passed.
- `node scripts/cargo.mjs build -p pero-host`: passed using upstream's pinned GPUI Kit 0.9.0 checkout.
- `PERO_HOST_PATH=<isolated build>/debug/pero-host.exe node tests/contracts/host.mjs`: passed (43/113 declared event kinds exercised). Temporary test workspaces must be outside the repository's ignored `target/` tree, otherwise ignore-aware context search skips them.
- `npm run check`: attempted; TypeScript stopped because the clean worktree has no generated `web/src/reader-wasm/pero_reader_web` artifact. No full clean-branch Wasm/Native/package acceptance is claimed.
- Security scanner: compared every staged commit with a separate clean upstream `f514d945` worktree. No new findings. The scanner reports the same eight baseline repository-wide ignore/config findings on both trees; the tracked `.npmrc` contains only `install-links=true` and no credential. Unrelated ignore/Docker changes were excluded.

Existing screenshots above are from the original Windows Electron verification, not a claim of rerunning that surface on the newer upstream layout. Real provider requests remain unverified. Screenshots are submitted only with explicit permission for binary evidence files.
