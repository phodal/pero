# Pero 当前 GPUI 原生 WebView 与合成边界

核查日期：2026-10-30。仅只读检查源码与官方网页，未编译、未运行 UI、未重跑验收。Pero 工作树有并行改动；以下结论来自本次可见源码。外部 Kit checkout 干净，HEAD 为 `ec89cfc36404667b7947aeb3d40b1c2859d729dd`，与 Pero release 脚本固定版本相同。

## 当前到底采用了什么，缺口在哪里

### Takeaway
Pero 已采用 Rust GPUI 的现成 Wry 接入；优先考虑改善 GPUI 合成后端，而非换一个同样包装系统 WebView 的 crate。当前原生预览和 Electron 发行壳是两条路径。

### Cited Findings
- Pero 使用 `gpui-kit = "=0.8.1"`；native 依赖 `gpui-webview = 0.8.1`、重命名 `lb-wry = 0.53.3`。没有启用 `gpui-fast`，当前 Cargo.lock 也没有该包。构建脚本将 Kit/WebView 相关 crate patch 到 `PERO_GPUI_KIT_PATH`，默认 `/Users/phodal/test/gpui-kit`，因此不能只看 crates.io 版本号判断实现。— [workspace manifest](/Users/phodal/workspaces/pero/Cargo.toml:17)、[native dependencies](/Users/phodal/workspaces/pero/crates/pero-ui/Cargo.toml:40)、[path patch](/Users/phodal/workspaces/pero/scripts/lib/cargo.mjs:8)、[release pin](/Users/phodal/workspaces/pero/scripts/release/desktop.mjs:11)
- `NativeWebPage` 拥有 `Entity<WebView>`，设置 URL、navigation/page-load/title/new-window callbacks；拒绝非 HTTP(S)，新窗口改为当前页导航，没有注入 Host bridge。macOS 通过 WKWebView、Windows 通过 WebView2、Linux 通过 WebKitGTK 查询实际 back/forward 能力。— [mount](/Users/phodal/workspaces/pero/crates/pero-ui/src/native_web.rs:47)、[native history](/Users/phodal/workspaces/pero/crates/pero-ui/src/native_web.rs:103)
- Workspace 按 Web source ID 保留同一个 engine，关闭才从 map 移除。当前布局在 `covered` 时整体隐藏页面，未活动页也隐藏；窄窗打开 chat 时隐藏嵌入页。— [retention/close](/Users/phodal/workspaces/pero/crates/pero-ui/src/web_documents.rs:115)、[visibility reconciliation](/Users/phodal/workspaces/pero/crates/pero-ui/src/web_documents.rs:221)、[layout rule](/Users/phodal/workspaces/pero/crates/pero-ui/src/layout.rs:47)
- Native Linux 强制 X11，Windows 启动前设置 `GPUI_DISABLE_DIRECT_COMPOSITION=true`；这不是完整跨平台原生合成。— [native bootstrap](/Users/phodal/workspaces/pero/crates/pero-ui/src/native.rs:47)

### Inferences
- 现有覆盖层策略保证不被页面挡住，但打开 settings 等覆盖层时页面消失，不能等同于 WebView 与 GPUI 真正按层叠合成。
- 换成另一个基于 Wry 的 wrapper（包括历史 `gpui-wry` 名称）不会自动改变 WKWebView/WebView2/WebKitGTK 内核或 GPUI 平台窗口合成。

### Gaps
- 当前 generic Web source 不等于 native App platform parity；ADR 0007 的领域 App 面板仍采用 Electron 中的受管 iframe。— [App boundary](/Users/phodal/workspaces/pero/docs/adr/0007-local-app-platform.md:77)

## 同一个 Kit 有没有更好的合成路径

### Takeaway
有，而且 Pero 固定的 Kit checkout 已包含：同时启用 `gpui-kit/gpui-fast` 与 `gpui-webview/gpui-fast`，macOS/Linux 使用 composition surface，把 deferred GPUI overlays 置于页面上方，并支持原生容器局部裁剪。它仍是实验性、需运行验证的后端选择，不是现有 Pero 已获得的能力。

### Cited Findings
- Kit feature 实际切换 GPUI backend；WebView feature 只启用 composition，二者不一致会编译报错。Kit 中 GPUI Fast 依赖版本为 `0.1.12`。— [Kit manifest](/Users/phodal/test/gpui-kit/crates/kit/Cargo.toml:18)、[backend deps](/Users/phodal/test/gpui-kit/Cargo.toml:68)、[public guide](https://gpui-kit.com/docs/webview/)
- 当前 pinned WebView 源码在 macOS 使用 `window.enable_window_composition()`、创建 native surface 并将 WKWebView reparent 到它；geometry 同时维护完整 DOM viewport 和可见 clip。Linux feature 分支也创建 composition surface；Windows 没有对应 feature 分支。— [macOS composition](/Users/phodal/test/gpui-kit/crates/webview/src/composition.rs:22)、[current source](https://github.com/longbridge/gpui-kit/blob/ec89cfc36404667b7947aeb3d40b1c2859d729dd/crates/webview/src/lib.rs#L131)、[geometry](https://github.com/longbridge/gpui-kit/blob/ec89cfc36404667b7947aeb3d40b1c2859d729dd/crates/webview/src/lib.rs#L178)
- 无 composition 时原生 child 会盖住同一区域 GPUI overlays，局部裁剪仍显示完整 bounds；composition 创建失败会记录日志并保留旧 attachment。Linux 仍仅 X11/XWayland；GTK 不能直接嵌入非自身持有的 Wayland surface。— [source declaration](https://github.com/longbridge/gpui-kit/blob/ec89cfc36404667b7947aeb3d40b1c2859d729dd/crates/webview/src/lib.rs#L55)、[Linux hosting](/Users/phodal/test/gpui-kit/crates/webview/src/linux.rs:1)
- 窗口合成解决层序与裁剪，并不把 WebView 变成 GPUI 绘制的普通 Element；WebView 仍收 native browser input，hide 请求 focus_parent，生命周期受 Entity 及 Rc handles 共同影响。— [visibility/focus source](https://github.com/longbridge/gpui-kit/blob/ec89cfc36404667b7947aeb3d40b1c2859d729dd/crates/webview/src/lib.rs#L239)、[owned handle](https://github.com/longbridge/gpui-kit/blob/ec89cfc36404667b7947aeb3d40b1c2859d729dd/crates/webview/src/lib.rs#L40)
- Zed #62379 本次网页显示 Open，其正文当前声称覆盖 macOS、Windows、Linux Wayland/X11；Kit 文档旧的 PR 说明仍写 Linux 不在范围内，两者存在漂移。不能将该 Open PR 的目标写成 Pero/Kit 已交付能力。— [upstream PR](https://github.com/zed-industries/zed/pull/62379)

### Inferences
- 最优先 spike 是 native-only 启用 GPUI Fast composition，保留 Kit/Wry、source identity 和 Host 权威；先验证可见窗口 overlay、输入法、拖拽 resize、Retina、Web→GPUI 的 Cmd-L/Tab 焦点与 close/reopen，再决定迁移。它是 GPUI backend 迁移，不能说只加一个 feature 就无需适配。
- Pero 另有 GPUI Wasm 与 `gpui-pre-web` IME 补丁；评估时应保持 Wasm 路径独立，检查共享 feature 解析和类型一致性，避免将 native spike 扩展成整套 Electron/Wasm 迁移。

### Gaps
- 没有本次运行证据，不能给成功率、性能数字或工期承诺；Windows composition 在 Kit 当前路径仍缺失。

## 已有验收能支持怎样的推荐

### Takeaway
已有记录支持“原生页面引擎确实运行并能保留状态”，不足以支持“原生交互和 compositing 已达到可发行水平”。换方案的首要验收必须是可见 native window 的真实交互。

### Cited Findings
- 仓库记录 2026-10-30 hidden macOS Wry suite 已通过 DOM、无 Host bridge、保留表单/history、两 native child 的活动/遮挡 visibility 及 teardown。hidden GPUI 不 paint，因此探针手动驱动同一布局边界，receipt 明确 `visual_acceptance:false`。— [acceptance record](/Users/phodal/workspaces/pero/docs/fitness/web-documents.md:70)、[probe actual checks](/Users/phodal/workspaces/pero/crates/pero-ui/src/native_web_probe.rs:238)、[receipt declaration](/Users/phodal/workspaces/pero/crates/pero-ui/src/native_web_probe.rs:304)
- open boundaries 包括 native Cmd-L/focus、合成截图、Windows/Linux runtime、installed package、弹窗/下载 UI、权限 prompts、重启恢复。Native page Finished 只表示 render completion，不能当 HTTP 2xx；非 HTTP(S) subframe 导航也不在 accepted coverage。— [remaining scope](/Users/phodal/workspaces/pero/docs/fitness/web-documents.md:85)

### Inferences
- 推荐顺序：现有 Wry + native GPUI Fast composition spike → 若必须固定 Chromium 行为才评估 CEF/Chromium。不要因为当前 hidden probe 通过就直接去掉 covered-hide 策略并宣称体验完成。

### Gaps
- 未发现本次可用 native visual acceptance 证据；本研究遵守只读要求，没有重跑 tests。
