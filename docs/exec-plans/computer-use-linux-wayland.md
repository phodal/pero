---
kind: execution_plan
status: proposed
date: 2026-10-30
baseline: 0847ddc
---

# Linux 原生 Wayland 驱动交接

先读 [交接总表](computer-use-platform-handoff.md)。基线在纯 Wayland 没有可用的
capture/input 后端；现有测试只在无 DISPLAY、声明 Wayland 元数据时验证拒绝。
能用 Xwayland 操作 X11 窗口，或在 Wayland 宿主显示 noVNC，都不是本任务通过。

## 先选一个真实环境

| Lane | 起步要求 | 当前状态 |
| --- | --- | --- |
| GNOME/portal | 记录 compositor、portal backend/version，实际查询共享与输入接口 | 待实施/实测 |
| Sway/wlroots | 查询可用协议及 portal 能力，明确 capture 与 input 的真实来源 | 待实施/实测 |
| KDE/Hyprland | 独立验证自己的版本/协议，不从前两条外推 | 未承诺覆盖 |

交互用户会话要能显示真实授权窗口。录下实际接口和 source/scale/rotation 事实，
不能仅凭 `XDG_CURRENT_DESKTOP` 或 `WAYLAND_DISPLAY` 宣告能力。
第一版只交一条有完整证据的 lane，其他环境保持可解释的拒绝。

## 先过 C4：目标范围与 trusted setup

现有 runtime 只保存 `Window`，过滤零 window ID，并固定输出 window 目标。
portal 如果只给 monitor/stream 而不给可靠窗口/PID 身份，必须先让共同模型支持
真正的 desktop/source 目标。公开枚举存在 `desktop` 不等于内部实现可用。
不能伪造 Window/PID，也不能把 monitor 输入叫作后台应用输入。

明确谁持有桌面输入、何时用户接管、何时使引用失效；与 #45 共用目标/租约定义，
平台适配器只执行获准的 capture/input。Source 改变、授权撤销、session 重建后，
必须换有效 basis；runtime 当前构造时缓存能力，更新或重启策略属于这个设计门。

状态查询是只读路径。Portal session 建立与用户选 source 应由可信 Desktop 操作
触发，不让模型调用 `status`/`act` 自动批准系统权限，也不把 portal token、FD、
对象路径或连接地址放进模型参数。需要新的私有 setup 通道时由共同负责人设计。

## 实现路径

主代码在 [computer-linux](../../use/computer/crates/computer-linux/src/desktop.rs) 的
新 `wayland/` 模块；X11 与 Wayland 按已初始化的后端选择，不在输入失败时隐式切换。
可参考 [Cua platform-linux](https://github.com/trycua/cua/tree/cbe3991f268c7e155bd028fbc9b449b40146cfe9/libs/cua-driver/rust/crates/platform-linux)
及 [SDK 接入评估](../design-docs/computer-use-cua-adapter.md)，固定 SDK 的桌面 Linux
注册需要 GNU 而非 musl。Cua 的环境服务、MCP 和权限系统不随原生适配一起迁入。

Portal 路线按实际支持的
[RemoteDesktop 接口](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)
建 session、选择 devices/source、由人授权，并配合 ScreenCast/PipeWire 捕获。
成功连上 EIS 后不混用 Notify 输入；capture 可用不等于 input 已获准。
不同 compositor 只按其真实接口实现，缺能力时返回原因。

几何转换由 snapshot 保存：实际 frame 像素尺寸、stream 逻辑尺寸、scale、rotation
和 source identity。输入使用同次截图像素再转换到该 stream；不采用固定画布。
先证明单 source，再测试多显示器/scale/rotation；变更几何后拒绝旧观察。

首个能力集是授权范围内的截图与显式前台像素输入。文本/按键映射要证明实际
键盘布局/Unicode 语义；无法表达时在部分写入前拒绝。没有 AT-SPI 能力时不广告
element 或 accessibility，也不从截图推断可编辑/安全字段事实。

## 验收

新增 opt-in `tests/e2e/computer-wayland.mjs`，在真实所选 compositor 上运行：

1. setup 前 `status` 不弹授权、capability 不虚报；人取消/拒绝授权可恢复。
2. 授权后的 capture 来自选定 source，独立水印/应用内容和几何可核对。
3. 点击、文本、和弦、滚动、拖拽分别改变自有应用状态；记录真实焦点、指针和对象位置。
4. source/布局/scale 改变后旧观察不能输入到另一处；授权撤销和 session 关闭有明确结果。
5. 部分输入/停止/连接中断保留 `unknown`，不盲重放；独立检查键/按钮状态。
6. 若实现桌面人工租约，人在持有时 Agent 输入被拒绝，归还后重新观察。

Fake portal/bus 可测试值转换和拒绝分支，但不能替代用户授权窗口、真实 frame 和
应用输入效果。证据记录 compositor/portal/input method 版本、source 范围、
截图哈希及独立应用状态；不要录入授权令牌或用户敏感输入。

保持已有 X11 源码隔离/原生效果测试绿色。按 source/capture、input、生命周期、
后续环境逐个 PR 合入，不为一次实现广告所有 Wayland compositor。

[#42](https://github.com/phodal/pero/pull/42) 的 Xvfb guest + noVNC 是隔离环境工作；
[#45](https://github.com/phodal/pero/pull/45) 的 RFB framebuffer 是另一种运行时。
可以复用其人工控制原则，但不能把这两条通过项登记为本机原生 Wayland 通过。
