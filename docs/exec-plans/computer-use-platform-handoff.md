---
kind: execution_plan
status: proposed
date: 2026-10-30
baseline: 0847ddc
---

# Computer Use 平台实施交接

基线是 `master@0847ddc`，实现代码最后一次变化为 `168f6bc`。
[三平台 CI](https://github.com/phodal/pero/actions/runs/40991729096) 已通过；
macOS 有自有 AppKit 窗口效果证据，Linux 有 Xvfb/Tk 效果证据，Windows
仍缺交互桌面上的输入效果证据。完整记录见 [fitness](../fitness/computer-use.md)。
本文固定接手范围和验收要求，不把提案当作已实现能力。

## 交给哪个环境

| 工作 | 接手环境 | 计划 | 首个可交付结果 |
| --- | --- | --- | --- |
| macOS 补齐 | 可交互 macOS，能运行 AppKit/Electron | [macOS](computer-use-macos.md) | 现有输入边界回归，随后单独接入按值写入 |
| Windows 本机 | 已解锁 Windows 10/11 用户会话，优先 x64 | [Windows](computer-use-windows.md) | 自有 WinForms/WPF 应用的 UIA、截图、输入效果报告 |
| Linux 语义观察 | X11、会话 D-Bus、AT-SPI、GTK/Qt | [AT-SPI](computer-use-linux-atspi.md) | 窗口身份绑定的树、元素点击与安全字段拒绝 |
| Linux 原生 Wayland | 能交互授权的具体 compositor/portal 会话 | [Wayland](computer-use-linux-wayland.md) | 一个明确环境的 capture/input 或有依据的能力拒绝 |

Windows 可独立开始；Linux 先做 AT-SPI/X11，再接原生 Wayland。
如果两个 Linux 实现并行，分别新增 `accessibility/`、`wayland/` 模块，
由一位 Linux 集成负责人修改 `desktop.rs` 和 `profile.rs`，避免各自改装配规则。
VNC/隔离桌面是另一条执行环境工作，不是原生 Wayland 的替代验收。

## 现有文档 PR 怎么用

| 参考 | 用途 | 合并实施前要处理的内容 |
| --- | --- | --- |
| [#43 输入缺口](https://github.com/phodal/pero/pull/43) | move/hover、长按、应用范围、可选 focus/scroll-to | 新动作和 allowed-apps 仍是提案；标识与准入规则由共同契约负责人定义 |
| [#44 模型回路](https://github.com/phodal/pero/pull/44) | set-value、语义动作、截断树、应用定位与往返成本 | 观察复用、点击路由属于待决策略，不能直接覆盖 ADR 0016 |
| [#42 隔离桌面](https://github.com/phodal/pero/pull/42) | Linux X11 guest、生命周期与人工接管 | Guest 是 X11；宿主使用 Wayland 不构成原生 Wayland 输入证据 |
| [#45 VNC 边界](https://github.com/phodal/pero/pull/45) | framebuffer、像素操作与人工租约 | Desktop 目标和 VNC display 类型需要共同设计，不能塞进窗口适配器 |

以上 PR 在核对时仍未合入 `master`。本文引用其设计建议，不确认其中对其他
产品内部实现的推测。#43 倾向先加 hover，#44 倾向有真实用例后再加；
先保留决策门，不让不同平台各自定义同名但不同义的动作。

## 共同契约负责人持有的决策

公开值继续由 [TypeSpec](../../protocol/computer-use.tsp) 和
[`pero-contracts`](../../crates/pero-contracts/src/computer_use.rs) 维护。
每个决策应形成独立小 PR，更新 Rust、生成物、共享 corpus 和各平台预期拒绝。

| 门 | 决定什么 | 什么时候需要 |
| --- | --- | --- |
| C1 动作语义 | set-value、受限语义动作、move/hover/hold；语义 press 与鼠标 button/count 的区别 | 各平台扩展五种 v1 输入之前 |
| C2 应用范围 | typed selector、允许列表、平台解析后的应用身份；Host 保存与准入核心各自职责 | 采用 #43 的应用范围之前 |
| C3 观察生命周期 | AX-only/按需截图、子树扩展及局部 ID、是否允许某些元素动作复用观察 | 作为后续性能/树能力改进；不是现有平台验收的前置条件 |
| C4 目标范围 | 窗口与桌面的内部模型、几何与输入所有权 | Wayland monitor 或 VNC framebuffer 进入运行时之前 |
| C5 控件能力事实 | 把可写、可调用、可滚动等事实交给纯核心；避免依赖 AX/UIA 角色拼写 | AT-SPI 需要突破现有角色投影时 |

当前 `DesktopDriver` 的目标参数是 `Window`，runtime 过滤零 window ID，
并把每个目标写成 `kind: window`。公开类型已有 `desktop` 不代表内部已支持桌面。
不得伪造 PID/window ID 把共享显示器塞进窗口模型。
当前能力还在 runtime 构造时读取；授权/portal source 改变后的刷新或重启规则
也必须纳入 C4，并使旧引用失效。

v1 继续在每次尝试时消费观察，包括被拒绝的动作。采用 #44 的观察复用建议
需要单独修改 [ADR 0016](../adr/0016-computer-use-contract.md)，不能在某个 OS
适配器里静默保留旧句柄。像素始终是该次截图像素，不引入固定 1280×800 画布。

## 平台实现可以直接改什么

- 主范围是各自 `use/computer/crates/computer-{macos,windows,linux}/`，
  各自 fixture/e2e 和验收记录。装配依赖变更集中在 `use/computer/Cargo.toml`
  与 `src/main.rs`。不要向 core/runtime 引入平台 SDK。
- 驱动端口见 [DesktopDriver](../../use/computer/crates/computer-runtime/src/driver.rs)。
  平台保存自己的 opaque snapshot，公共引用由 Pero 发行，原生句柄留在适配器。
- 普通用户权限、后台输入、前台输入是不同验收场景；能力按
  action/delivery/addressing 广告。尚未实现的组合保留 `unsupported`。
- Host 继续拥有启用、会话授权、持久回执和证据；系统权限由人授予。
  现有原生源码已入仓，构建不得新增私有 Git 依赖。

基础检查在目标系统执行：

```sh
node scripts/build/computer.mjs --test
cargo clippy --manifest-path use/computer/Cargo.toml --locked --workspace --all-targets -- -D warnings
node scripts/build/computer.mjs
```

需要 Node 22+ 和 Rust stable，以及该平台的原生构建工具。
只有 Electron/真实 Agent 的后续验收才需要相应 npm 依赖、构建产物和登录条件。
每个平台先交当前 v1 的实机证据，再把新动作分到后续 PR。

## 统一交付证据

每次运行记录 commit、OS/架构、应用框架版本、显示会话、scale/monitor，
以及实际 capture/input 路径；portal/compositor 的名称和版本不能只由环境变量推断。
每个用例同时保留请求、回执和独立应用效果：计数器/字段/对象位置、焦点、鼠标位置。
截图只取测试目标，并保留 SHA-256；密码、授权令牌和用户输入不进入报告。

预期拒绝要检查应用与指针没有变化。发生部分输入或无法判断派发结果时保留
`unknown`，查询原 request ID，不自动重放。Stop/重启/目标替换后验证旧引用失效。
等待 readiness 行、文件效果或原生回调的有界条件，不能靠固定 sleep 猜输入已完成。

报告明确区分：构建/纯准入、虚拟显示、交互桌面、自有窗口、第三方应用、真实模型、
签名发行包。只做过某个应用或 compositor，就只登记该行通过。
平台实现 PR 附运行命令、环境和证据，再更新 [fitness](../fitness/computer-use.md)；
本 docs PR 不新增运行通过项。
