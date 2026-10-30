---
kind: execution_plan
status: proposed
date: 2026-10-30
baseline: 0847ddc
---

# macOS Computer Use 后续实施

先读 [交接总表](computer-use-platform-handoff.md)。原生链路已经跑通：自有 AppKit
窗口上的 AX 单击、Unicode、选区和弦、后台像素点击/滚动/拖拽、前台元素点击/拖拽、
guard 焦点保护、回执和 stop/restart 均有证据。它们不等于完整跨应用覆盖。

## 当前还差什么

| 优先级 | 缺口 | 实施入口与完成条件 |
| --- | --- | --- |
| P0 | 按钮/次数/投递与目标窗口一致性 | 先扩自有 fixture，再按实际失败修 native library；矩阵覆盖左/右/中、1/2/3 次、同 PID 双窗口重叠 |
| P1 | 按值替换和清空字段 | C1 后接入原生 `set_value`；只广告实际可写且非安全控件，验证不依赖键盘焦点 |
| P1 | 更多语义动作与状态 | C1/C5 后保留可调用/可写等事实；支持的动作由观察和能力约束，结果能解释实际执行路线 |
| P1 | 稳定应用选择 | C2 后加 bundle ID 等 typed selector；同名/本地化名称不再靠模糊名字猜 |
| P2 | 截断子树、按需截图、观察成本 | 先按 C3 定义索引/生命周期，防止局部编号误指另一个控件 |
| P2 | move/hover/长按、显式 focus/scroll-to | 先提供真实用例，按 C1 决定语义、单位和取消时的释放行为 |
| 发行 | 框架/系统版本/签名包覆盖 | AppKit 之外覆盖 SwiftUI、Electron/Web 内容；实际 OS 版本、CPU、DPI 和打包启动分别记结果 |

## 源码核对发现，不能直接写成实机结论

- [desktop.rs](../../use/computer/crates/computer-macos/src/desktop.rs) 只有后台单击
  调用 AX 阶梯；前台和多击用元素几何发送鼠标事件。右键的 AX 路线已有菜单阶梯，
  不能把它误报成普通左键 press。中键走哪条动作语义仍需要独立 fixture 验证。
- [window_input.rs](../../use/computer/crates/computer-macos/src/window_input.rs)
  的前台命中检查比较 PID，没有比较命中窗口与选定 window ID。
  同应用两个窗口覆盖时是否串到另一窗口，需要双窗口实测，再决定修复。
- [Point driver](../../use/computer/vendor/point/crates/point-computer-macos/src/driver.rs)
  已有 `set_value` / `perform_action`；v1 的五个输入没有这些入口。
  [bridge](../../use/computer/crates/computer-macos/src/bridge.rs) 只把 `AXPress`
  归为 invocable，公共投影还依赖 Button/Edit 等角色；只支持 `AXOpen` 的节点
  可能没有可用的语义操作广告。
- 当前 Swift fixture 的 drag 证据是事件回调计数；需增加真实对象位置变化，
  不能把回调直接等同于文档/应用完成了拖拽操作。

P0 交付要明确 expected success/refusal，并独立检查目标与 guard 的状态、
焦点、真光标、重复次数，以及窗口移动/缩放、sheet、遮挡和关闭后的拒绝。
这些案例通过后再扩新 API，避免把策略差异和已有路由问题混在一个 PR。

## 共享设计门与 PR 顺序

1. **原生回归 PR**：只改 macOS 包、Swift fixture/e2e 和证据。
   保留 [profile](../../use/computer/crates/computer-macos/src/profile.rs) 的准确广告；
   输入不支持时明确拒绝。
2. **Set-value 契约 PR**：TypeSpec/Rust/生成物/corpus 一次更新。
   replacement value 必须允许空串；现有 `ComputerText` 非空，不能直接复用。
   观察端读取真正的可写性；把语义替换和 `type_text` 的插入语义分开。
3. **macOS Set-value 实现 PR**：按观察锚点写值，验证清空、Unicode、焦点保持、
   secure/disabled/read-only 拒绝；Windows/Linux 暂不广告该新能力。
4. **语义动作与观察 PR**：分别处理 C1、C3、C5。原生动作词汇与执行结果需要明确的
   公共模型，不能直接从模型转发任意 AX 字符串，也不能本地添加生成类型外的字段。

[#44](https://github.com/phodal/pero/pull/44) 提出的前台/双击回到 AX 阶梯，
需要先和 `delivery`、鼠标 button/count 的定义协调。双击不能退化成重复 AXPress。
观察复用也不是当前已有行为；v1 仍然每次尝试都消费观察。

## 命令与后续验收

```sh
node scripts/build/computer.mjs --test
node scripts/build/computer.mjs
PERO_COMPUTER_NATIVE=1 PERO_COMPUTER_FOREGROUND=1 node tests/e2e/computer-native.mjs
```

窗口需处于可交互用户会话，并具有真实有效的 AX/屏幕录制权限；preflight 不能代替
观察与效果检查。添加新用例后记录原生事件、应用状态和截图；不要用返回值代替效果。

后续矩阵至少包含：AppKit、SwiftUI、Electron/Web 内容，多个窗口/弹出层，
Retina/多显示器与坐标原点，权限撤销、锁屏/解锁和输入中停止。
macOS 13 旧捕获路径与 14+ ScreenCaptureKit 分开；`minos 13.0` 只是链接元数据。
只在实际测试过的 Intel/Apple Silicon 和 OS 版本上登记通过。

签名包单独验证安装、权限归属、完整退出/重开、helper 签名及后台输入使用的
SkyLight SPI 可用性；遇到不可用应拒绝而不是偷偷切前台。
采用 Developer ID 分发时参考 Apple 的
[notarization 要求](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。
源码运行和临时 staging 不能代替这条发行验收。
