# 系统原生 WebView 与 GPUI 合成

## 是否有比当前 Wry 更适合 GPUI 的系统 WebView

### Takeaway
优先试验同一 `gpui-webview + lb-wry` 的 `gpui-fast` 合成路径。更换 Wry 包装通常不改变浏览器内核；但改用 GPUI 的 native composition 确实可能改善遮挡与裁剪，不能把所有原生 child-view 的限制一概而论。

### Cited Findings
- GPUI Kit 官方 v0.8.1 文档将集成标为 experimental；macOS 为 WKWebView、Windows 为 WebView2、Linux 为 WebKitGTK。`gpui-fast` 在 macOS/Linux 允许 deferred GPUI overlays 位于页面上方；Windows 仍是 child-view，示例还关闭 GPUI DirectComposition。— [官方 WebView 指南](https://gpui-kit.com/docs/webview/#platform-support)
- macOS 实现不是把网页截图上传纹理：它建立 `WindowCompositionSurface`，把同一个 WKWebView 重新挂到 surface 的 NSView；`set_geometry` 调整容器可见区域与页面偏移，保留完整 DOM viewport。— [v0.8.1 composition.rs L20–35、L73–95](https://github.com/longbridge/gpui-kit/blob/v0.8.1/crates/webview/src/composition.rs#L20-L95)
- 两个 crate 的 `gpui-fast` feature 必须一致；普通 gpui-pre 上原生页面盖住 popup/dialog/tooltip，局部裁剪也不跟随 GPUI content mask；合成建立失败会回退普通挂载。— [官方合成及布局说明](https://gpui-kit.com/docs/webview/#gpui-fast-native-composition)

### Inferences
- 对 Pero 最值得验证的变化是 GPUI 合成 backend，而非替换 Wry 包装。是否可低成本迁移，要由当前代码调查确认 GPUI crate 同源性、所有共享 UI crate 的 feature 统一，以及现有组件是否兼容。
- 这条路径维持系统引擎和相对较轻的交付方向，但没有实测包体、启动或内存数据，不能量化节省或性能提升。

### Gaps
- 本研究不运行 GUI。原生 overlay 的点击穿透、IME、键盘焦点、拖动分栏和多屏缩放仍须在实际 Pero 窗口验证；指南明确要求真实窗口验证。

## 跨平台边界和直接调用平台 API 能解决什么

### Takeaway
直接调用平台 API 能补齐特定功能，但不会自动获得统一的 GPUI 合成、事件与生命周期。Windows composition hosting 是实质不同的可行方向；Linux GPUI+WebKitGTK 原生 Wayland 仍是当前路线的明确缺口。

### Cited Findings
- Wry 要求已有 event loop 和 native window handle；Linux 非 GTK 壳还必须初始化 GTK 并推进 GTK event loop。`build_as_child` 支持 macOS/Windows/X11，Wry 自身的 Wayland 路线使用 GTK container，并不等同于嵌入 GPUI 的 Wayland window。— [Wry 官方 API：Child webviews 与 Platform Considerations](https://docs.rs/wry/latest/wry/)
- GPUI Kit 的 Linux adapter 明确拒绝非 X11 handle，并用 GPUI task 驱动 GTK；native composition surface 仍是 X11 child。— [v0.8.1 linux.rs L1–43、L53–73、L155–187](https://github.com/longbridge/gpui-kit/blob/v0.8.1/crates/webview/src/linux.rs#L1-L187)
- `objc2-web-kit::WKWebView` 是 NSView 子类，具有 `MainThreadOnly` 约束，不能 Send/Sync；直接使用它仍然是在操作同一个 Apple 引擎。— [WKWebView Rust bindings](https://docs.rs/objc2-web-kit/latest/objc2_web_kit/struct.WKWebView.html)
- Microsoft 的 `CreateCoreWebView2CompositionController` 为 visual hosting 建立 WebView，宿主提供 RootVisualTarget 并负责通过 `SendMouseInput`/`SendPointerInput` 转发输入；这与普通 child HWND hosting 不同。— [Microsoft 官方接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment3?view=webview2-1.0.4258.31#CreateCoreWebView2CompositionController)

### Inferences
- macOS 仅为绕过 Wry 而重写 objc2 adapter，收益不足；有具体缺失的 WKNavigationDelegate/WKUIDelegate 能力时，再在真实 seam 增补更合理。
- Windows 若必须让原生页面与 GPUI 任意交叠，可单独评估 CompositionController；它要求 compositor、输入、焦点和 accessibility 对接，不能视为替换一个 crate 即可完成。
- Linux 强制 X11/XWayland 影响整个 GPUI 应用，不只网页面板。若原生 Wayland 是硬要求，继续换 Wry wrapper 无法消除这个缺口。

### Gaps
- 没有证明 GPUI 当前 Windows compositor 已开放足够的 native visual seam；也没有提供可在 Pero 直接替换的成熟 Windows composition adapter。

## 受管 App 与通用网页、Tauri 替换如何判断

### Takeaway
受管 App 可围绕系统 WebView 设计有限协议；通用网页则需要更完整的浏览器行为。Tauri 2/Wry 不带来新引擎，Tauri 3 alpha 的 CEF 路线应单独评估成熟度与包体。

### Cited Findings
- Wry 有自定义协议、IPC、导航、新窗口、下载与权限 API，但 API 有平台差异；自定义 scheme 的 origin 在 macOS/Linux 与 Windows 不相同。此处查阅的是当前 Wry 0.57.1 文档，不能直接认定 Pero 固定的 lb-wry 0.53.3 全部具备相同能力。— [Wry WebViewBuilder](https://docs.rs/wry/latest/wry/struct.WebViewBuilder.html)
- GPUI wrapper 只接布局、focus 与 lifecycle；loading/policy/IPC 由应用配置 Wry callback。官方指出 `Finished` 不等于页面成功、load_url wrapper 丢弃即时 Result，输入和桥接需各自验证。— [官方事件与失败边界说明](https://gpui-kit.com/docs/webview/#loading-navigation-and-page-messages)
- Tauri 官方当前 3.0 alpha 文档明确说明：Tauri 2 使用 Wry；3 alpha 可选系统 Wry 或随应用分发 Chromium 的 CEF，后者包体更大、跨平台引擎版本一致。— [Tauri Webview Runtime](https://v3.tauri.app/develop/webview-runtime/)

### Inferences
- Pero App SDK 的 origin、会话、IPC 身份和权限应由既有 Host/App 边界持有；更换 WebView 不是重新设计一套授权的理由。具体 cookie/profile 隔离必须用当前 lb-wry 能力验收，不能因为都有 JS bridge 就宣称迁移完成。
- 如果目标是轻量原生科研 App 面板，先验证 gpui-fast+Wry；如果目标是复杂任意站点、统一 Chromium 行为，再比较已有 Electron 与 CEF。Tauri 是应用壳的迁移选项，不是 GPUI WebView 的直接升级件。

### Gaps
- 没有完成现有 App SDK 在 WKWebView、WebView2、WebKitGTK 上的端到端兼容验证，也没有验证登录、下载、媒体或跨站权限。
